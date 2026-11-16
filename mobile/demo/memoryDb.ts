import type { LocalDb, SqlParams, SqlValue } from "../src/db/localDb";

/**
 * The browser demo's LocalDb: an in-memory store behind the same interface as ExpoSqliteDb, so
 * the app's own repositories (PhotoRepo, the unsent-items count, the migrations) run unchanged.
 * State lasts until the page is reloaded.
 *
 * It is NOT a general SQL engine. It understands the small dialect the app uses: CREATE TABLE
 * and INDEX, INSERT (OR IGNORE, ON CONFLICT DO UPDATE), SELECT (columns, `*`, COUNT(*), WHERE with
 * AND/OR and comparisons, ORDER BY, a UNION of selects as a source), UPDATE, DELETE and the
 * PRAGMAs. Anything else throws "not supported", so a new kind of statement in the app fails
 * loudly in the demo's parity test instead of silently misbehaving.
 */

type Row = Record<string, SqlValue>;
interface Table {
  columns: string[];
  defaults: Record<string, SqlValue>;
  primaryKey: string[];
  /** Columns that must not be NULL once defaults are applied. */
  notNull: string[];
  /** CHECK (col IN (...)) constraints. */
  allowed: Record<string, SqlValue[]>;
  rows: Row[];
}
type Snapshot = { tables: Record<string, Table>; userVersion: number };

// ---- tokens ----------------------------------------------------------------------------------
type Token = { kind: "word" | "num" | "str" | "param" | "op" | "punct"; text: string };

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const re = /\s+|('(?:[^']|'')*')|(\?\d*)|(-?\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)|(<>|<=|>=|!=|[=<>+\-*])|([(),;])/gy;
  let pos = 0;
  while (pos < sql.length) {
    re.lastIndex = pos;
    const m = re.exec(sql);
    if (!m) throw new Error(`MemoryDb: cannot read SQL near "${sql.slice(pos, pos + 20)}"`);
    pos = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ kind: "str", text: m[1].slice(1, -1).replace(/''/g, "'") });
    else if (m[2] !== undefined) tokens.push({ kind: "param", text: m[2] });
    else if (m[3] !== undefined) tokens.push({ kind: "num", text: m[3] });
    else if (m[4] !== undefined) tokens.push({ kind: "word", text: m[4] });
    else if (m[5] !== undefined) tokens.push({ kind: "op", text: m[5] });
    else if (m[6] !== undefined) tokens.push({ kind: "punct", text: m[6] });
  }
  return tokens;
}

class Cursor {
  private i = 0;
  private next = 0;
  constructor(
    readonly tokens: Token[],
    private readonly params: SqlParams,
  ) {}
  peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }
  take(): Token {
    const t = this.tokens[this.i++];
    if (!t) throw new Error("MemoryDb: unexpected end of statement");
    return t;
  }
  /** True (and consumes) when the next tokens are these keywords, case-insensitively. */
  accept(...words: string[]): boolean {
    for (let k = 0; k < words.length; k++) if (this.peek(k)?.text.toUpperCase() !== words[k]) return false;
    this.i += words.length;
    return true;
  }
  expect(...words: string[]): void {
    if (!this.accept(...words)) throw new Error(`MemoryDb: expected ${words.join(" ")} near "${this.peek()?.text ?? "end"}"`);
  }
  ident(): string {
    const t = this.take();
    if (t.kind !== "word") throw new Error(`MemoryDb: expected a name, got "${t.text}"`);
    return t.text;
  }
  param(token: Token): SqlValue {
    if (token.text === "?") {
      const v = this.params[this.next++];
      return v === undefined ? null : v;
    }
    const v = this.params[Number(token.text.slice(1)) - 1];
    return v === undefined ? null : v;
  }
}

// ---- expressions -----------------------------------------------------------------------------
type Expr = (row: Row, excluded?: Row) => SqlValue | boolean;

function parseOperand(c: Cursor): Expr {
  const t = c.take();
  if (t.kind === "punct" && t.text === "(") {
    const e = parseOr(c);
    c.expect(")");
    return e;
  }
  let base: Expr;
  if (t.kind === "param") {
    const v = c.param(t);
    base = () => v;
  } else if (t.kind === "str") base = () => t.text;
  else if (t.kind === "num") base = () => Number(t.text);
  else if (t.kind === "word" && t.text.toUpperCase() === "NULL") base = () => null;
  else if (t.kind === "word") {
    const isExcluded = t.text.startsWith("excluded.");
    const name = isExcluded ? t.text.slice("excluded.".length) : t.text;
    base = (row, excluded) => (isExcluded ? (excluded?.[name] ?? null) : (row[name] ?? null));
  } else throw new Error(`MemoryDb: unexpected "${t.text}"`);
  const op = c.peek();
  if (op?.kind === "op" && (op.text === "+" || op.text === "-")) {
    c.take();
    const rhs = parseOperand(c);
    return (row, excluded) => Number(base(row, excluded)) + (op.text === "+" ? 1 : -1) * Number(rhs(row, excluded));
  }
  return base;
}

function parseComparison(c: Cursor): Expr {
  const left = parseOperand(c);
  const t = c.peek();
  if (t?.kind === "op" && ["=", "<>", "!=", ">", "<", ">=", "<="].includes(t.text)) {
    c.take();
    const right = parseOperand(c);
    return (row) => {
      const a = left(row) as string | number | boolean | null | Uint8Array;
      const b = right(row) as string | number | boolean | null | Uint8Array;
      if (a === null || b === null) return false; // SQL: a comparison with NULL is never true
      switch (t.text) {
        case "=":
          return a === b;
        case "<>":
        case "!=":
          return a !== b;
        case ">":
          return (a as number) > (b as number);
        case "<":
          return (a as number) < (b as number);
        case ">=":
          return (a as number) >= (b as number);
        default:
          return (a as number) <= (b as number);
      }
    };
  }
  return left;
}

function parseAnd(c: Cursor): Expr {
  let e = parseComparison(c);
  while (c.accept("AND")) {
    const l = e;
    const r = parseComparison(c);
    e = (row) => Boolean(l(row)) && Boolean(r(row));
  }
  return e;
}

function parseOr(c: Cursor): Expr {
  let e = parseAnd(c);
  while (c.accept("OR")) {
    const l = e;
    const r = parseAnd(c);
    e = (row) => Boolean(l(row)) || Boolean(r(row));
  }
  return e;
}

const compareValues = (a: SqlValue, b: SqlValue) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : (a as number) < (b as number) ? -1 : 1);

export class MemoryDb implements LocalDb {
  private tables: Record<string, Table> = {};
  private userVersion = 0;
  private snapshots: Snapshot[] = [];

  private table(name: string): Table {
    const t = this.tables[name.toLowerCase()];
    if (!t) throw new Error(`MemoryDb: no such table ${name}`);
    return t;
  }

  exec(sql: string): void {
    const c = new Cursor(tokenize(sql), []);
    // Several statements may be given at once.
    while (c.peek()) this.statement(sql, c, true);
  }

  run(sql: string, params: SqlParams = []): { changes: number } {
    const c = new Cursor(tokenize(sql), params);
    return { changes: this.statement(sql, c, false).changes };
  }

  get<T>(sql: string, params: SqlParams = []): T | undefined {
    return this.all<T>(sql, params)[0];
  }

  all<T>(sql: string, params: SqlParams = []): T[] {
    const c = new Cursor(tokenize(sql), params);
    if (c.peek()?.text.toUpperCase() === "PRAGMA") {
      c.take();
      const name = c.ident();
      if (name.toLowerCase() === "user_version") return [{ user_version: this.userVersion } as T];
      return [];
    }
    c.expect("SELECT");
    const rows = this.select(c);
    return rows as T[];
  }

  transaction<T>(fn: () => T): T {
    this.snapshots.push(this.snapshot());
    try {
      const result = fn();
      this.snapshots.pop();
      return result;
    } catch (error) {
      this.restore(this.snapshots.pop()!);
      throw error;
    }
  }

  close(): void {
    // Nothing to release.
  }

  private snapshot(): Snapshot {
    return { tables: structuredClone(this.tables), userVersion: this.userVersion };
  }
  private restore(s: Snapshot) {
    this.tables = s.tables;
    this.userVersion = s.userVersion;
  }

  // ---- statements ----------------------------------------------------------------------------
  private statement(sql: string, c: Cursor, allowMany: boolean): { changes: number } {
    const first = c.take().text.toUpperCase();
    let changes = 0;
    if (first === "PRAGMA") {
      const name = c.ident().toLowerCase();
      if (c.accept("=")) {
        const value = c.take();
        if (name === "user_version") this.userVersion = Number(value.text);
      }
    } else if (first === "CREATE") this.create(sql, c);
    else if (first === "INSERT") changes = this.insert(c);
    else if (first === "UPDATE") changes = this.update(c);
    else if (first === "DELETE") changes = this.delete(c);
    else if (first === "SELECT") this.select(c);
    else throw new Error(`MemoryDb: ${first} is not supported`);
    while (c.accept(";")) {
      /* statement separator */
    }
    if (!allowMany && c.peek()) throw new Error(`MemoryDb: unexpected "${c.peek()!.text}"`);
    return { changes };
  }

  private create(sql: string, c: Cursor) {
    if (c.accept("INDEX") || c.accept("UNIQUE", "INDEX")) {
      while (c.peek() && c.peek()!.text !== ";") c.take(); // reads are scans: indexes change nothing
      return;
    }
    c.expect("TABLE");
    const name = c.ident().toLowerCase();
    const open = sql.indexOf("(");
    const close = sql.lastIndexOf(")");
    const parts: string[] = [];
    let depth = 0;
    let start = open + 1;
    for (let i = open + 1; i < close; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") depth--;
      else if (sql[i] === "," && depth === 0) {
        parts.push(sql.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(sql.slice(start, close));
    const table: Table = { columns: [], defaults: {}, primaryKey: [], notNull: [], allowed: {}, rows: [] };
    for (const raw of parts) {
      const part = raw.trim().replace(/\s+/g, " ");
      const tableKey = /^PRIMARY KEY \(([^)]+)\)/i.exec(part);
      if (tableKey) {
        table.primaryKey = tableKey[1]!.split(",").map((s) => s.trim());
        continue;
      }
      if (/^(CHECK|UNIQUE|FOREIGN|CONSTRAINT)\b/i.test(part)) continue;
      const column = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(part)![1]!;
      table.columns.push(column);
      if (/\bNOT NULL\b/i.test(part)) table.notNull.push(column);
      for (const check of part.matchAll(/CHECK \(([A-Za-z_]+) IN \(([^)]*)\)\)/gi)) {
        table.allowed[check[1]!] = check[2]!.split(",").map((v) => {
          const lit = v.trim();
          return lit.startsWith("'") ? lit.slice(1, -1) : Number(lit);
        });
      }
      if (/\bPRIMARY KEY\b/i.test(part)) table.primaryKey = [column];
      const def = /\bDEFAULT\s+('(?:[^']|'')*'|-?\d+(?:\.\d+)?|NULL)/i.exec(part);
      if (def) {
        const lit = def[1]!;
        table.defaults[column] = lit.toUpperCase() === "NULL" ? null : lit.startsWith("'") ? lit.slice(1, -1).replace(/''/g, "'") : Number(lit);
      }
    }
    this.tables[name] = table;
    while (c.peek()) c.take(); // the column list was read from the raw text
  }

  private insert(c: Cursor): number {
    const ignore = c.accept("OR", "IGNORE");
    c.expect("INTO");
    const table = this.table(c.ident());
    c.expect("(");
    const cols: string[] = [];
    do cols.push(c.ident());
    while (c.accept(","));
    c.expect(")");
    c.expect("VALUES");
    c.expect("(");
    const values: SqlValue[] = [];
    do values.push(parseOperand(c)({}) as SqlValue);
    while (c.accept(","));
    c.expect(")");
    if (cols.length !== values.length) throw new Error("MemoryDb: column and value counts differ");
    const row: Row = {};
    for (const col of table.columns) row[col] = table.defaults[col] ?? null;
    cols.forEach((col, i) => {
      if (!table.columns.includes(col)) throw new Error(`MemoryDb: no such column ${col}`);
      row[col] = values[i]!;
    });
    let upsert: [string, Expr][] | undefined;
    if (c.accept("ON", "CONFLICT")) {
      c.expect("(");
      do c.ident();
      while (c.accept(","));
      c.expect(")");
      c.expect("DO", "UPDATE", "SET");
      upsert = this.parseSet(c);
    }
    const same = (r: Row) => table.primaryKey.length > 0 && table.primaryKey.every((k) => r[k] === row[k]);
    const existing = table.rows.find(same);
    if (existing) {
      if (ignore) return 0;
      if (!upsert) throw new Error("MemoryDb: UNIQUE constraint failed");
      const next = upsert.map(([col, e]) => [col, e(existing, row) as SqlValue] as const);
      for (const [col, v] of next) existing[col] = v;
      return 1;
    }
    this.validate(table, row);
    table.rows.push(row);
    return 1;
  }

  private validate(table: Table, row: Row) {
    for (const col of [...table.notNull, ...table.primaryKey]) {
      if (row[col] === null) throw new Error(`MemoryDb: NOT NULL constraint failed: ${col}`);
    }
    for (const [col, allowed] of Object.entries(table.allowed)) {
      if (row[col] !== null && !allowed.includes(row[col]!)) throw new Error(`MemoryDb: CHECK constraint failed: ${col}`);
    }
  }

  private parseSet(c: Cursor): [string, Expr][] {
    const assignments: [string, Expr][] = [];
    do {
      const col = c.ident();
      c.expect("=");
      assignments.push([col, parseOperand(c)]);
    } while (c.accept(","));
    return assignments;
  }

  private where(c: Cursor): Expr {
    return c.accept("WHERE") ? parseOr(c) : () => true;
  }

  private update(c: Cursor): number {
    const table = this.table(c.ident());
    c.expect("SET");
    const assignments = this.parseSet(c);
    const where = this.where(c);
    let n = 0;
    for (const row of table.rows) {
      if (!where(row)) continue;
      const next = { ...row };
      for (const [col, e] of assignments) next[col] = e(row) as SqlValue;
      this.validate(table, next);
      Object.assign(row, next);
      n++;
    }
    return n;
  }

  private delete(c: Cursor): number {
    c.expect("FROM");
    const table = this.table(c.ident());
    const where = this.where(c);
    const keep = table.rows.filter((r) => !where(r));
    const n = table.rows.length - keep.length;
    table.rows = keep;
    return n;
  }

  /** SELECT (the keyword is already consumed). Returns plain row objects. */
  private select(c: Cursor): Row[] {
    const projection: { name: string; expr?: Expr; count?: boolean }[] = [];
    let star = false;
    do {
      if (c.accept("*")) star = true;
      else if (c.peek()?.text.toUpperCase() === "COUNT") {
        c.take();
        c.expect("(");
        c.expect("*");
        c.expect(")");
        c.expect("AS");
        projection.push({ name: c.ident(), count: true });
      } else {
        const expr = parseOperand(c);
        const bare = c.peek(-1)!.text; // a plain column keeps its own name
        const name = c.accept("AS") ? c.ident() : bare;
        projection.push({ name, expr });
      }
    } while (c.accept(","));
    c.expect("FROM");
    let source: Row[];
    if (c.accept("(")) {
      // FROM ( SELECT ... UNION SELECT ... ): distinct rows of the pieces.
      const seen = new Set<string>();
      source = [];
      do {
        c.expect("SELECT");
        for (const r of this.select(c)) {
          const key = JSON.stringify(r);
          if (!seen.has(key)) {
            seen.add(key);
            source.push(r);
          }
        }
      } while (c.accept("UNION"));
      c.expect(")");
    } else {
      const table = this.table(c.ident());
      const where = this.where(c);
      source = table.rows.filter((r) => where(r));
    }
    const order: string[] = [];
    if (c.accept("ORDER", "BY")) {
      do order.push(c.ident());
      while (c.accept(","));
    }
    if (order.length > 0) source = [...source].sort((a, b) => order.reduce((d, k) => d || compareValues(a[k] ?? null, b[k] ?? null), 0));
    if (projection.some((p) => p.count)) {
      const p = projection.find((x) => x.count)!;
      return [{ [p.name]: source.length }];
    }
    if (star) return source.map((r) => ({ ...r }));
    return source.map((r) => Object.fromEntries(projection.map((p) => [p.name, p.expr!(r) as SqlValue])));
  }
}

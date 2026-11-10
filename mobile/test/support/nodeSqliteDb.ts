import { SqlDb, type SqlParams } from "../../src/db/localDb";
import { applyPragmas, migrate } from "../../src/db/migrations";

// node:sqlite is a scheme-only built-in; Jest's resolver does not list it, so ask Node directly.
type NodeSqlite = typeof import("node:sqlite");
const sqlite = (process as unknown as { getBuiltinModule(id: string): unknown }).getBuiltinModule("node:sqlite") as NodeSqlite;

type Bind = import("node:sqlite").SQLInputValue[];

/** LocalDb over Node's built-in SQLite: the very same SQL the phone runs, testable without a device. */
export class NodeSqliteDb extends SqlDb {
  readonly db: InstanceType<NodeSqlite["DatabaseSync"]>;
  constructor(path = ":memory:") {
    super();
    this.db = new sqlite.DatabaseSync(path);
  }
  protected rawExec(sql: string) {
    this.db.exec(sql);
  }
  protected rawRun(sql: string, params: SqlParams) {
    return { changes: Number(this.db.prepare(sql).run(...(params as unknown as Bind)).changes) };
  }
  protected rawGet<T>(sql: string, params: SqlParams) {
    return this.db.prepare(sql).get(...(params as unknown as Bind)) as T | undefined;
  }
  protected rawAll<T>(sql: string, params: SqlParams) {
    return this.db.prepare(sql).all(...(params as unknown as Bind)) as T[];
  }
  close() {
    this.db.close();
  }
}

/** A migrated database, in memory or in a file. */
export function openTestDb(path = ":memory:"): NodeSqliteDb {
  const db = new NodeSqliteDb(path);
  applyPragmas(db);
  migrate(db);
  return db;
}

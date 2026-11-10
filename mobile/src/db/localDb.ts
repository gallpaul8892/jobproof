/**
 * LocalDb: the one door to the phone's SQLite (design 3.3, T-003e Patterns). The app uses
 * ExpoSqliteDb over expo-sqlite; Jest runs the very same SQL through NodeSqliteDb over node:sqlite,
 * so the durability rules can be tested without a device.
 *
 * Synchronous on purpose: a transaction is then a plain function call that cannot interleave
 * with other JavaScript, which is what makes "write the row and the draft together" simple to
 * reason about.
 */
export type SqlValue = string | number | null | Uint8Array;
export type SqlParams = readonly SqlValue[];

export interface LocalDb {
  /** Runs one or more statements with no parameters (DDL, PRAGMA). */
  exec(sql: string): void;
  /** One INSERT, UPDATE or DELETE. */
  run(sql: string, params?: SqlParams): { changes: number };
  get<T>(sql: string, params?: SqlParams): T | undefined;
  all<T>(sql: string, params?: SqlParams): T[];
  /**
   * Runs `fn` atomically: all of its writes commit together or none do. Nested calls become
   * savepoints, so a failure inside only undoes the inner part. Whatever `fn` throws is rethrown.
   */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** Shared transaction logic over the three primitives each driver supplies. */
export abstract class SqlDb implements LocalDb {
  private depth = 0;

  protected abstract rawExec(sql: string): void;
  protected abstract rawRun(sql: string, params: SqlParams): { changes: number };
  protected abstract rawGet<T>(sql: string, params: SqlParams): T | undefined;
  protected abstract rawAll<T>(sql: string, params: SqlParams): T[];
  abstract close(): void;

  exec(sql: string): void {
    this.rawExec(sql);
  }
  run(sql: string, params: SqlParams = []) {
    return this.rawRun(sql, params);
  }
  get<T>(sql: string, params: SqlParams = []) {
    return this.rawGet<T>(sql, params);
  }
  all<T>(sql: string, params: SqlParams = []) {
    return this.rawAll<T>(sql, params);
  }

  transaction<T>(fn: () => T): T {
    const outer = this.depth === 0;
    const name = `sp_${this.depth}`;
    this.rawExec(outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const result = fn();
      this.depth -= 1;
      this.rawExec(outer ? "COMMIT" : `RELEASE ${name}`);
      return result;
    } catch (error) {
      this.depth -= 1;
      try {
        this.rawExec(outer ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
      } catch {
        // The original failure is the one worth reporting.
      }
      throw error;
    }
  }
}

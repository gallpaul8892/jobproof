import { openDatabaseSync, type SQLiteBindParams, type SQLiteDatabase } from "expo-sqlite";
import { SqlDb, type SqlParams } from "./localDb";
import { applyPragmas, migrate } from "./migrations";

export const DB_NAME = "jobproof.db";

/** LocalDb over expo-sqlite's synchronous API. Park it behind `openLocalDb()`; nothing else imports expo-sqlite for work data. */
export class ExpoSqliteDb extends SqlDb {
  constructor(private readonly db: SQLiteDatabase) {
    super();
  }
  protected rawExec(sql: string) {
    this.db.execSync(sql);
  }
  protected rawRun(sql: string, params: SqlParams) {
    return { changes: this.db.runSync(sql, params as SQLiteBindParams).changes };
  }
  protected rawGet<T>(sql: string, params: SqlParams) {
    return this.db.getFirstSync<T>(sql, params as SQLiteBindParams) ?? undefined;
  }
  protected rawAll<T>(sql: string, params: SqlParams) {
    return this.db.getAllSync<T>(sql, params as SQLiteBindParams);
  }
  close() {
    this.db.closeSync();
  }
}

/** Opens `jobproof.db`, applies the durability pragmas and migrates to the newest schema. */
export function openLocalDb(name: string = DB_NAME): ExpoSqliteDb {
  const db = new ExpoSqliteDb(openDatabaseSync(name));
  applyPragmas(db);
  migrate(db);
  return db;
}

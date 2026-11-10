import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeSqliteDb, openTestDb } from "../../test/support/nodeSqliteDb";
import { LATEST_VERSION, applyPragmas, migrate, schemaVersion } from "./migrations";

const cols = (db: NodeSqliteDb, table: string) => db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

describe("migration v1 (design 3.3)", () => {
  it("creates the four tables and sets user_version", () => {
    const db = openTestDb();
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((t) => t.name);
    expect(tables).toEqual(["checklist_states", "drafts", "photos", "sync_meta"]);
    expect(schemaVersion(db)).toBe(LATEST_VERSION);
  });

  it("puts owner_user_id on every work table", () => {
    const db = openTestDb();
    for (const t of ["drafts", "checklist_states", "photos"]) expect(cols(db, t)).toContain("owner_user_id");
  });

  it("has every column the later tickets need (rev pairs, evidence, upload copy, sync state)", () => {
    const db = openTestDb();
    expect(cols(db, "photos")).toEqual(
      expect.arrayContaining([
        "id", "job_id", "stage", "checklist_item_id", "caption", "meta_rev", "meta_synced_rev", "source", "taken_at", "taken_at_source",
        "latitude", "longitude", "accuracy_m", "location_source", "original_path", "original_width", "original_height", "original_bytes",
        "original_sha256", "upload_path", "upload_width", "upload_height", "upload_bytes", "upload_sha256", "sync_state", "attempts",
        "next_attempt_at", "last_error_code", "deleted", "created_at", "recovered", "thumb_path",
      ]),
    );
    expect(cols(db, "drafts")).toEqual(
      expect.arrayContaining(["notes", "notes_rev", "notes_synced_rev", "sign_off_json", "sign_off_rev", "sign_off_synced_rev", "local_state", "submission_id", "device_submitted_at", "last_error_code"]),
    );
    expect(cols(db, "checklist_states")).toEqual(expect.arrayContaining(["item_id", "status", "note", "rev", "synced_rev"]));
  });

  it("is idempotent and does nothing the second time", () => {
    const db = openTestDb();
    db.run("INSERT INTO sync_meta (key, value) VALUES ('k', 'v')");
    expect(migrate(db)).toBe(LATEST_VERSION);
    expect(db.get("SELECT value FROM sync_meta WHERE key = 'k'")).toEqual({ value: "v" });
  });

  it("refuses to open a database written by a newer app instead of altering it", () => {
    const db = new NodeSqliteDb();
    db.exec(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(/newer/);
  });

  it("rejects values outside the allowed stages and states", () => {
    const db = openTestDb();
    const insert = (stage: string, state = "saved") =>
      db.run(
        "INSERT INTO photos (id, owner_user_id, job_id, stage, source, taken_at, taken_at_source, original_path, sync_state, created_at) VALUES ('p', 'u', 'j', ?, 'camera', 't', 'device_clock', 'x', ?, 't')",
        [stage, state],
      );
    expect(() => insert("middle")).toThrow();
    expect(() => insert("before", "lost")).toThrow();
    expect(insert("before").changes).toBe(1);
  });
});

describe("durability settings", () => {
  let dir: string;
  beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobproof-db-"))));
  afterEach(() => {
    const file = path.join(dir, "jobproof.db");
    for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    fs.rmdirSync(dir);
  });

  it("uses WAL, synchronous=FULL and foreign keys on", () => {
    const db = new NodeSqliteDb(path.join(dir, "jobproof.db"));
    applyPragmas(db);
    expect(db.get<{ journal_mode: string }>("PRAGMA journal_mode")?.journal_mode).toBe("wal");
    expect(db.get<{ synchronous: number }>("PRAGMA synchronous")?.synchronous).toBe(2); // 2 = FULL
    expect(db.get<{ foreign_keys: number }>("PRAGMA foreign_keys")?.foreign_keys).toBe(1);
    db.close();
  });
});

describe("transactions", () => {
  it("commit together or not at all", () => {
    const db = openTestDb();
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO sync_meta VALUES ('a', '1')");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.get("SELECT 1 AS x FROM sync_meta WHERE key = 'a'")).toBeUndefined();
  });

  it("a failed inner step undoes only itself", () => {
    const db = openTestDb();
    db.transaction(() => {
      db.run("INSERT INTO sync_meta VALUES ('outer', '1')");
      expect(() =>
        db.transaction(() => {
          db.run("INSERT INTO sync_meta VALUES ('inner', '1')");
          throw new Error("inner");
        }),
      ).toThrow("inner");
    });
    expect(db.all<{ key: string }>("SELECT key FROM sync_meta").map((r) => r.key)).toEqual(["outer"]);
  });

  it("returns the function's value", () => {
    expect(openTestDb().transaction(() => 42)).toBe(42);
  });
});

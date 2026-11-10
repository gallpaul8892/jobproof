import type { LocalDb } from "./localDb";

/**
 * Durability and integrity settings (design 3.3). `synchronous=FULL` with WAL means a photo row
 * that has been committed survives the battery dying a moment later (T-003i scenario 10).
 * Not run inside a transaction: journal_mode cannot change within one.
 */
export function applyPragmas(db: LocalDb): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA foreign_keys = ON");
}

export interface Migration {
  version: number;
  statements: string[];
}

/**
 * v1 (T-003e): every table the epic needs, so later tickets add behaviour, not schema. Every
 * work table carries owner_user_id and is only read by user (Q13, T-003b scenario 10).
 *
 * Added to the design's column list, on purpose: photos.recovered (orphan files found at start,
 * T-003e) and photos.thumb_path (cached preview, derived and rebuildable). There is no
 * orientation column: the camera's pixels are stored as produced and never rewritten.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE drafts (
        owner_user_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        notes TEXT,
        notes_rev INTEGER NOT NULL DEFAULT 0,
        notes_synced_rev INTEGER NOT NULL DEFAULT 0,
        sign_off_json TEXT,
        sign_off_rev INTEGER NOT NULL DEFAULT 0,
        sign_off_synced_rev INTEGER NOT NULL DEFAULT 0,
        local_state TEXT NOT NULL DEFAULT 'draft'
          CHECK (local_state IN ('draft','submit_queued','submitted','rejected')),
        submission_id TEXT,
        device_submitted_at TEXT,
        last_error_code TEXT,
        PRIMARY KEY (owner_user_id, job_id)
      )`,
      `CREATE TABLE checklist_states (
        owner_user_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        note TEXT,
        rev INTEGER NOT NULL DEFAULT 0,
        synced_rev INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (owner_user_id, job_id, item_id)
      )`,
      `CREATE TABLE photos (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        stage TEXT NOT NULL CHECK (stage IN ('before','during','after')),
        checklist_item_id TEXT,
        caption TEXT,
        meta_rev INTEGER NOT NULL DEFAULT 1,
        meta_synced_rev INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL CHECK (source IN ('camera','gallery')),
        taken_at TEXT NOT NULL,
        taken_at_source TEXT NOT NULL CHECK (taken_at_source IN ('device_clock','file_metadata','added_time')),
        latitude REAL,
        longitude REAL,
        accuracy_m REAL,
        location_source TEXT,
        original_path TEXT NOT NULL,
        original_width INTEGER,
        original_height INTEGER,
        original_bytes INTEGER,
        original_sha256 TEXT,
        upload_path TEXT,
        upload_width INTEGER,
        upload_height INTEGER,
        upload_bytes INTEGER,
        upload_sha256 TEXT,
        sync_state TEXT NOT NULL DEFAULT 'saved'
          CHECK (sync_state IN ('saved','registered','sent','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error_code TEXT,
        deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
        created_at TEXT NOT NULL,
        recovered INTEGER NOT NULL DEFAULT 0 CHECK (recovered IN (0,1)),
        thumb_path TEXT
      )`,
      `CREATE INDEX photos_by_job ON photos (owner_user_id, job_id, deleted, taken_at)`,
      `CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function schemaVersion(db: LocalDb): number {
  return db.get<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0;
}

/**
 * Brings the database to the newest schema. Each step and its `user_version` bump commit
 * together, so a kill part-way leaves the old version and the step simply runs again. A database
 * from a NEWER app is left alone and reported: never downgrade work data.
 */
export function migrate(db: LocalDb): number {
  const current = schemaVersion(db);
  if (current > LATEST_VERSION) throw new Error(`Database schema ${current} is newer than this app understands (${LATEST_VERSION}).`);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      for (const sql of m.statements) db.exec(sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return schemaVersion(db);
}

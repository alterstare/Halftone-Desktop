// Ordered schema migrations (CLAUDE.md §4). Never edit a shipped entry — append
// a new one. `user_version` holds the number of applied migrations.
import type Database from 'better-sqlite3'

export const MIGRATIONS: string[] = [
  // v1 — settings + undo log. Library tables come with Phase 1.
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );

  CREATE TABLE action_log (
    id INTEGER PRIMARY KEY,
    action_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0
  );
  `,
  // v2 — library (Phase 1). Tracks are rebuilt on every scan; listening
  // progress is keyed by the track group so it survives rescans and version
  // switches.
  `
  CREATE TABLE works (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    root TEXT NOT NULL,
    code TEXT,
    title TEXT NOT NULL,
    cover_path TEXT,
    images_json TEXT NOT NULL DEFAULT '[]',
    mojibake INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    scanned_at INTEGER NOT NULL,
    last_played_at INTEGER,
    last_group TEXT,
    se_pref TEXT,
    edition TEXT
  );

  CREATE TABLE tracks (
    id INTEGER PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    ext TEXT NOT NULL,
    kind TEXT NOT NULL,
    role TEXT NOT NULL,
    edition TEXT NOT NULL DEFAULT '',
    edition_key TEXT NOT NULL DEFAULT '',
    se TEXT NOT NULL,
    format_dir TEXT NOT NULL DEFAULT '',
    group_key TEXT NOT NULL,
    sort INTEGER NOT NULL,
    duration REAL,
    bitrate INTEGER,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    mojibake INTEGER NOT NULL DEFAULT 0,
    rel_dir TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX tracks_work ON tracks(work_id);

  CREATE TABLE progress (
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    group_key TEXT NOT NULL,
    position REAL NOT NULL DEFAULT 0,
    duration REAL,
    played_at INTEGER NOT NULL,
    PRIMARY KEY (work_id, group_key)
  );
  `,
  // v3 — library like Halftone / Sorta (즐겨찾기, 별점, 그룹) + subtitles
  // (Phase 2): files found next to each track, and per-track subtitle offset.
  `
  ALTER TABLE works ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE works ADD COLUMN rank INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE work_groups (
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (work_id, group_id)
  );

  ALTER TABLE tracks ADD COLUMN subs_json TEXT NOT NULL DEFAULT '[]';

  CREATE TABLE track_prefs (
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    group_key TEXT NOT NULL,
    sub_offset REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (work_id, group_key)
  );
  `,
  // v4 — file tools (Phase 3): a record of changes that can't be undone in
  // the app (wav sent to the recycle bin), shown with the undoable ones.
  `
  CREATE TABLE file_history (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  // v5 — 작품 정보 from DLsite (by work code): title, circle, voice actors.
  `
  ALTER TABLE works ADD COLUMN dl_title TEXT;
  ALTER TABLE works ADD COLUMN dl_circle TEXT;
  ALTER TABLE works ADD COLUMN dl_voices TEXT;
  ALTER TABLE works ADD COLUMN dl_at INTEGER;
  `,
  // v6 — DLsite cover image, saved in the data folder (covers/<code>.jpg).
  `
  ALTER TABLE works ADD COLUMN dl_cover TEXT;
  `,
  // v7 — 북마크: named points in a track (by track group, like progress).
  `
  CREATE TABLE bookmarks (
    id INTEGER PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    group_key TEXT NOT NULL,
    position REAL NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX bookmarks_work ON bookmarks(work_id);
  `,
  // v8 — Phase 5/6: engine results cached by key (a chunk of a track's audio,
  // a translation batch …), the glossary, translated names.
  `
  CREATE TABLE jobs (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    engine TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE glossary (
    id INTEGER PRIMARY KEY,
    work_id INTEGER REFERENCES works(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    target TEXT NOT NULL
  );
  CREATE INDEX glossary_work ON glossary(work_id);
  CREATE TABLE names (
    path TEXT PRIMARY KEY,
    translated TEXT NOT NULL,
    engine TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // v9: subtitles made or edited in the program live here (not next to the
  // audio); 파일 정리 › 자막 › 폴더 변경 exports them as files
  `
  CREATE TABLE app_subs (
    track_path TEXT NOT NULL,
    lang TEXT NOT NULL,
    vtt TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (track_path, lang)
  );
  `,
  // v10: 원래 이름 기록 — each work's names as first seen and its Japanese
  // subtitles (core/originals.ts)
  `
  CREATE TABLE originals (
    work_id INTEGER PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // v11: DLsite tags (장르) — [{ko, ja}]
  `
  ALTER TABLE works ADD COLUMN dl_tags TEXT;
  `,
  // v12: the release language DLsite gives ('ja' | 'ko-sub' | 'ko-voice')
  `
  ALTER TABLE works ADD COLUMN dl_lang TEXT;
  `,
  // v13: what the work folder holds (scripts / subtitles by language, found at
  // scan) and DLsite's age rating ('r18' | 'general')
  `
  ALTER TABLE works ADD COLUMN content_json TEXT;
  ALTER TABLE works ADD COLUMN dl_age TEXT;
  `
]

export function schemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

// Apply every pending migration, each in its own transaction.
export function migrate(db: Database.Database): number {
  let v = schemaVersion(db)
  for (; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v]
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return v
}

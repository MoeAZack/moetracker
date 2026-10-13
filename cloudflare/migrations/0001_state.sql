CREATE TABLE IF NOT EXISTS tracker_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  active_revision TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tracker_revisions (
  revision_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (revision_id, ordinal)
);
CREATE INDEX IF NOT EXISTS tracker_revisions_created ON tracker_revisions(created_at);

CREATE TABLE IF NOT EXISTS tracker_committed_revisions (
  revision_id TEXT PRIMARY KEY,
  committed_at TEXT NOT NULL
);

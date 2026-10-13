CREATE TABLE IF NOT EXISTS tracker_committed_revisions (
  revision_id TEXT PRIMARY KEY,
  committed_at TEXT NOT NULL
);

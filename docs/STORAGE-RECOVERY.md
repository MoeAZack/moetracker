# Storage and private recovery contract

Status: implemented and locally testable; **not deployment-ready until the selected blob backend is proven in the target runtime**.

Firestore stores schema-v2 immutable revisions. Growth collections (`matches`, `playerStats`, `seasonArchives`, `replayIntake`, and `engineAdapters`) are encoded into bounded entity/container documents. Staging batches are planned by encoded bytes, not only operation count, and stop at 7 MiB to leave margin below Firestore's 10 MiB commit limit. A staged revision becomes visible only when a transaction advances the active-revision pointer with the expected prior version. First boot and legacy conversion use the same pointer transaction; ordinary writes without a revision are rejected. State with a newer schema is refused.

The JSON development backend keeps one file for convenience, but applies the same schema validation, conservative 840 KiB per-entity limit (800 KiB for a season archive), 64 MiB database limit, optimistic revision check, fsync, and atomic rename.

`POST /api/backup` remains a shareable, secret-stripped export. It is not a disaster-recovery artifact. Importing one uses the current optimistic revision, creates a private pre-import snapshot, preserves access identities, and explicitly clears replay/adaptor evidence that would otherwise be stale. Private recovery backups are created only by the CRON-secret route or internal functions. Each private backup has a versioned manifest, a checksum-bound complete state snapshot, and an inventory of replay blobs. Raw `.vrf` files are never embedded. Restore validates everything, supports dry-run, creates a private pre-restore snapshot, and replaces the complete state so omissions are deletions. Dry-run reports metadata validity separately from blob completeness; an incomplete inventory is not restore-ready and blocks an actual restore. No public HTTP restore route exists.

Replay files use verified content-addressed publication. The local backend prefers an exclusive hardlink, with an owned, expiring publication lock + sibling copy + fsync + hash verification + rename fallback for filesystems without hardlinks. Expired locks are recovered under a separate cleanup guard; live foreign locks are preserved. `REPLAY_STORAGE_BACKEND=filesystem` is the only enabled backend. GCS FUSE is still a filesystem mount and is not claimed to provide object conditional-create semantics. A real object backend must implement provider-native generation/precondition checks and pass collision, corruption, and durability acceptance before deployment.

Parser work is coordinated by persisted leases containing owner, expiry, heartbeat, and fence. Another instance may recover only an expired lease. On startup, an unexpired foreign lease arms a wakeup for its expiry, so recovery does not depend on another request or queue event. Completion/failure updates are ignored unless owner and fence still match.

Operational acceptance before production:

- Run private-backup dry-run and complete replacement restore against the target Firestore project.
- Reconcile every replay metadata row with the selected durable blob backend.
- Prove object publication semantics if replacing the filesystem backend.
- Configure lifecycle cleanup for inactive Firestore revisions after the recovery window.

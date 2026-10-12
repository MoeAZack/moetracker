import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFirestoreDocuments, encodeFirestoreDocuments, ensureStorageSchema, estimatedFirestoreWriteBytes, FIRESTORE_BATCH_SAFE_BYTES, MAX_ENTITY_BYTES, planFirestoreWriteBatches, planRevisionActivation, STORAGE_SCHEMA_VERSION, validateTrackerState } from '../lib/storageSchema';
import { DurableFilesystemReplayStorage } from '../lib/replayIntakeSafety';
import { replayIntakeInternals } from '../lib/routes/replayIntake';
import { assertSeasonArchivesStorageSize } from '../lib/roster';

const tempDirs: string[] = [];
afterEach(async () => { delete process.env.DB_PATH; delete process.env.REPLAY_STORAGE_DIR; delete process.env.PRIVATE_BACKUP_DIR; vi.resetModules(); await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });

function state() {
  return ensureStorageSchema({ settings: {}, matches: [], playerStats: [], seasonArchives: [], replayIntake: { schemaVersion: 4, devices: {}, blobs: {}, associations: {}, parserJobs: {}, reviews: {} }, engineAdapters: { replay: {}, ratings: { records: {} } } });
}

describe('schema-v2 Firestore codec', () => {
  it('splits a representative aggregate over 1 MiB into bounded documents and round-trips', () => {
    const input = state();
    input.matches = Array.from({ length: 12 }, (_, index) => ({ id: `m${index}`, notes: 'x'.repeat(100_000) }));
    expect(Buffer.byteLength(JSON.stringify(input.matches))).toBeGreaterThan(1024 * 1024);
    const encoded = encodeFirestoreDocuments(input);
    expect(encoded.filter(doc => doc.payload.topKey === 'matches').length).toBe(13);
    expect(Math.max(...encoded.map(doc => Buffer.byteLength(JSON.stringify(doc.payload))))).toBeLessThan(1024 * 1024);
    expect(decodeFirestoreDocuments(encoded).matches).toEqual(input.matches);
    input.seasonArchives = Array.from({ length: 4 }, (_, index) => ({ id: `s${index}`, snapshot: 'y'.repeat(300_000) }));
    expect(() => assertSeasonArchivesStorageSize(input.seasonArchives)).not.toThrow();
    expect(encodeFirestoreDocuments(input).filter(doc => doc.payload.topKey === 'seasonArchives')).toHaveLength(5);
  });

  it('rejects a too-large entity and a newer schema', () => {
    const input = state(); input.matches = [{ id: 'oversized', notes: 'x'.repeat(MAX_ENTITY_BYTES + 1000) }];
    expect(() => encodeFirestoreDocuments(input)).toThrow(/entity limit/);
    expect(() => ensureStorageSchema({ _storage: { schemaVersion: STORAGE_SCHEMA_VERSION + 1 } })).toThrow(/newer/);
  });

  it('allows exactly one transactional cold-start activation', () => {
    const winnerVersion = planRevisionActivation(null, undefined, 'initialize');
    expect(winnerVersion).toBe(1);
    expect(() => planRevisionActivation(winnerVersion, undefined, 'initialize')).toThrow(/concurrently/);
    expect(() => planRevisionActivation(winnerVersion, undefined, 'ordinary')).toThrow(/revision|changed/);
  });

  it('keeps 20 near-limit entities below the Firestore 10 MiB commit boundary', () => {
    const input = state(); input.matches = Array.from({ length: 20 }, (_, index) => ({ id: `large-${index}`, notes: 'n'.repeat(800_000) }));
    const documents = encodeFirestoreDocuments(input); const revisionId = 'r'.repeat(36);
    const batches = planFirestoreWriteBatches(documents, revisionId);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) expect(batch.reduce((sum, document) => sum + estimatedFirestoreWriteBytes(document, revisionId), 0)).toBeLessThanOrEqual(FIRESTORE_BATCH_SAFE_BYTES);
  });

  it.each([
    [{ settings: null }, /settings/],
    [{ rounds: {} }, /rounds/],
    [{ schedule: 'bad' }, /schedule/],
    [{ authKeys: {} }, /authKeys/],
    [{ goals: {} }, /goals/],
  ])('rejects structurally invalid core state %#', (invalid, message) => {
    expect(() => validateTrackerState(invalid)).toThrow(message);
  });
});

describe('persisted parser lease fencing', () => {
  const job = () => ({ id: 'j1', sha256: 'a'.repeat(64), requestedBy: 'coach', status: 'queued', sourceDeviceIds: ['d1'], createdAt: '2026-01-01T00:00:00.000Z', startedAt: null, completedAt: null, parser: { name: 'vrfkit', version: '0.2.5' }, reviewStatus: 'review-required' });
  it('allows one owner, preserves a live lease across restart, and recovers only expiry', () => {
    const store: any = { parserJobs: { j1: job() } };
    const first = replayIntakeInternals.claimParserLease(store, 'instance-a', Date.now());
    const expiresAt = Date.parse(first!.job.lease.expiresAt);
    expect(first?.job.lease.owner).toBe('instance-a');
    expect(replayIntakeInternals.claimParserLease(store, 'instance-b', Date.now())).toBeNull();
    expect(replayIntakeInternals.recoverExpiredParserLeases(store, Date.now())).toBe(0);
    expect(replayIntakeInternals.recoverExpiredParserLeases(store, expiresAt + 1)).toBe(1);
    const second = replayIntakeInternals.claimParserLease(store, 'instance-b', expiresAt + 2);
    expect(second?.job.lease.owner).toBe('instance-b');
    expect(second!.fence).toBeGreaterThan(first!.fence);
    expect(replayIntakeInternals.leaseMatches(second?.job, 'instance-a', first!.fence)).toBe(false);
  });

  it('arms a deterministic startup wakeup for an unexpired foreign lease', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now(); const store: any = { parserJobs: { j1: job() } };
      replayIntakeInternals.claimParserLease(store, 'foreign-instance', now);
      const callback = vi.fn(); const delay = replayIntakeInternals.nextParserLeaseRecoveryDelay(store, now)!;
      replayIntakeInternals.scheduleParserLeaseRecovery(store, callback, now);
      vi.advanceTimersByTime(delay - 1); expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1); expect(callback).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});

describe('durable replay publication', () => {
  it('publishes and verifies through the no-hardlink fallback', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-')); tempDirs.push(dir);
    const temp = path.join(dir, 'upload'); const final = path.join(dir, 'objects', 'blob.vrf'); const body = Buffer.from('verified replay bytes');
    await fs.writeFile(temp, body); const hash = crypto.createHash('sha256').update(body).digest('hex');
    const operations: any = { ...fs, link: async () => { throw Object.assign(new Error('no hardlinks'), { code: 'ENOTSUP' }); } };
    const storage = new DurableFilesystemReplayStorage(operations);
    await expect(storage.publishVerified(temp, final, hash, body.length)).resolves.toBe(true);
    await expect(storage.verify(final, hash, body.length)).resolves.toBe(true);
  });

  it('fails closed on corruption and copy failure without publishing a final object', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-')); tempDirs.push(dir);
    const temp = path.join(dir, 'upload'); const final = path.join(dir, 'objects', 'blob.vrf'); await fs.writeFile(temp, 'bad');
    const storage = new DurableFilesystemReplayStorage();
    await expect(storage.publishVerified(temp, final, '0'.repeat(64), 3)).rejects.toMatchObject({ status: 422 });
    await expect(fs.stat(final)).rejects.toMatchObject({ code: 'ENOENT' });
    const good = Buffer.from('good'); await fs.writeFile(temp, good); const hash = crypto.createHash('sha256').update(good).digest('hex');
    const failing: any = { ...fs,
      link: async () => { throw Object.assign(new Error('no hardlinks'), { code: 'ENOTSUP' }); },
      copyFile: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
    };
    await expect(new DurableFilesystemReplayStorage(failing).publishVerified(temp, final, hash, good.length)).rejects.toMatchObject({ code: 'ENOSPC' });
    await expect(fs.stat(final)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(temp)).resolves.toEqual(good);
  });

  it('recovers an expired owned publication lock but preserves a live foreign lock', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-lock-')); tempDirs.push(dir);
    const final = path.join(dir, 'objects', 'blob.vrf'); const lock = `${final}.publish.lock`; await fs.mkdir(path.dirname(final), { recursive: true });
    const body = Buffer.from('lock recovery'); const hash = crypto.createHash('sha256').update(body).digest('hex');
    const operations: any = { ...fs, link: async () => { throw Object.assign(new Error('no hardlinks'), { code: 'ENOTSUP' }); } };
    const storage = new DurableFilesystemReplayStorage(operations);
    await fs.writeFile(lock, JSON.stringify({ owner: 'dead-owner', expiresAt: new Date(Date.now() - 1_000).toISOString() }));
    const first = path.join(dir, 'first.upload'); await fs.writeFile(first, body);
    await expect(storage.publishVerified(first, final, hash, body.length)).resolves.toBe(true);
    await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.rm(final); await fs.writeFile(lock, JSON.stringify({ owner: 'live-owner', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    const second = path.join(dir, 'second.upload'); await fs.writeFile(second, body);
    await expect(storage.publishVerified(second, final, hash, body.length)).rejects.toMatchObject({ status: 423, code: 'REPLAY_PUBLICATION_LOCKED' });
    expect(JSON.parse(await fs.readFile(lock, 'utf8')).owner).toBe('live-owner');
  });
});

describe('private backup and exact restore', () => {
  it('validates checksums, supports dry-run, snapshots before replacement, and deletes omissions', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-backup-')); tempDirs.push(dir);
    vi.resetModules();
    process.env.DB_PATH = path.join(dir, 'db.json'); process.env.REPLAY_STORAGE_DIR = path.join(dir, 'replays'); process.env.PRIVATE_BACKUP_DIR = path.join(dir, 'backups');
    const { readDB, saveDB } = await import('../lib/store');
    const db = await readDB(); db.matches = [{ id: 'kept' }]; db.playerStats = [{ id: 'omitted-later', matchId: 'kept' }]; await saveDB(db);
    const backup = await import('../lib/privateBackup');
    const made = await backup.createPrivateBackup({ reason: 'test' });
    expect(made.manifest.replayBlobs).toMatchObject({ embedded: false });
    const changed = await readDB(); changed.matches.push({ id: 'delete-on-restore' }); changed.playerStats = []; await saveDB(changed);
    await expect(backup.restorePrivateBackup(made.directory, { dryRun: true })).resolves.toMatchObject({ dryRun: true, metadataValid: true, blobInventoryComplete: true, readyForRestore: true });
    await expect(backup.restorePrivateBackup(made.directory)).resolves.toMatchObject({ restored: true, completeReplacement: true });
    const restored = await readDB(); expect(restored.matches).toEqual([{ id: 'kept' }]); expect(restored.playerStats).toEqual([{ id: 'omitted-later', matchId: 'kept' }]);
    const statePath = path.join(made.directory, 'state.json'); await fs.appendFile(statePath, 'corrupt');
    await expect(backup.validatePrivateBackup(made.directory)).rejects.toThrow(/checksum/);
    await expect(backup.restorePrivateBackup(made.directory, { dryRun: true })).resolves.toMatchObject({ metadataValid: false, blobInventoryComplete: null, readyForRestore: false });
  });

  it('separates valid backup metadata from an incomplete replay blob inventory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-backup-blobs-')); tempDirs.push(dir); vi.resetModules();
    process.env.DB_PATH = path.join(dir, 'db.json'); process.env.REPLAY_STORAGE_DIR = path.join(dir, 'replays'); process.env.PRIVATE_BACKUP_DIR = path.join(dir, 'backups');
    const { readDB, saveDB } = await import('../lib/store'); const backup = await import('../lib/privateBackup');
    const db = await readDB(); db.replayIntake = { schemaVersion: 4, devices: {}, associations: {}, parserJobs: {}, reviews: {}, blobs: { ['a'.repeat(64)]: { sha256: 'a'.repeat(64), size: 3 } } }; await saveDB(db);
    const made = await backup.createPrivateBackup({ reason: 'missing-blob-test' });
    await expect(backup.restorePrivateBackup(made.directory, { dryRun: true })).resolves.toMatchObject({ metadataValid: true, blobInventoryComplete: false, readyForRestore: false, blobStatus: { missing: ['a'.repeat(64)] } });
    await expect(backup.restorePrivateBackup(made.directory)).rejects.toMatchObject({ status: 409 });
    await expect(backup.reconcileReplayBlobInventory()).resolves.toMatchObject({ checked: 1, healthy: 0, missing: ['a'.repeat(64)] });
  });
});

describe('shareable import safety', () => {
  it('clears stale private evidence and still uses the read revision', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-import-')); tempDirs.push(dir); vi.resetModules();
    process.env.DB_PATH = path.join(dir, 'db.json');
    const { readDB, saveDB } = await import('../lib/store'); const { prepareShareableImport } = await import('../lib/routes/extras');
    const seeded = await readDB(); seeded.replayIntake = { blobs: { stale: true } }; seeded.engineAdapters = { replay: { stale: true } }; seeded.authKeys = [{ id: 'keep-access' }]; await saveDB(seeded);
    const importing = await readDB();
    prepareShareableImport(importing, { settings: {}, matches: [{ id: 'imported' }], playerStats: [], rounds: [], schedule: [], goals: [], replayIntake: { attacker: true }, engineAdapters: { attacker: true } });
    expect(importing).not.toHaveProperty('replayIntake'); expect(importing).not.toHaveProperty('engineAdapters'); expect(importing.authKeys).toEqual([{ id: 'keep-access' }]);
    const winner = await readDB(); winner.matches = [{ id: 'concurrent' }]; await saveDB(winner);
    await expect(saveDB(importing)).rejects.toMatchObject({ status: 409 });
  });
});

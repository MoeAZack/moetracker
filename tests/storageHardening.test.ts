import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFirestoreDocuments, encodeFirestoreDocuments, ensureStorageSchema, MAX_ENTITY_BYTES, planRevisionActivation, STORAGE_SCHEMA_VERSION } from '../lib/storageSchema';
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
});

describe('private backup and exact restore', () => {
  it('validates checksums, supports dry-run, snapshots before replacement, and deletes omissions', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-backup-')); tempDirs.push(dir);
    vi.resetModules();
    process.env.DB_PATH = path.join(dir, 'db.json'); process.env.REPLAY_STORAGE_DIR = path.join(dir, 'replays'); process.env.PRIVATE_BACKUP_DIR = path.join(dir, 'backups');
    const { readDB, saveDB } = await import('../lib/store');
    const db = await readDB(); db.matches = [{ id: 'kept' }]; db.playerStats = [{ id: 'omitted-later', matchId: 'kept' }];
    db.replayIntake = { schemaVersion: 4, devices: {}, associations: {}, parserJobs: {}, reviews: {}, blobs: { ['a'.repeat(64)]: { sha256: 'a'.repeat(64), size: 3 } } };
    await saveDB(db);
    const backup = await import('../lib/privateBackup');
    const made = await backup.createPrivateBackup({ reason: 'test' });
    expect(made.manifest.replayBlobs).toMatchObject({ embedded: false });
    await expect(backup.reconcileReplayBlobInventory()).resolves.toMatchObject({ checked: 1, healthy: 0, missing: ['a'.repeat(64)] });
    const changed = await readDB(); changed.matches.push({ id: 'delete-on-restore' }); changed.playerStats = []; await saveDB(changed);
    await expect(backup.restorePrivateBackup(made.directory, { dryRun: true })).resolves.toMatchObject({ dryRun: true, valid: true });
    await expect(backup.restorePrivateBackup(made.directory)).resolves.toMatchObject({ restored: true, completeReplacement: true });
    const restored = await readDB(); expect(restored.matches).toEqual([{ id: 'kept' }]); expect(restored.playerStats).toEqual([{ id: 'omitted-later', matchId: 'kept' }]);
    const statePath = path.join(made.directory, 'state.json'); await fs.appendFile(statePath, 'corrupt');
    await expect(backup.validatePrivateBackup(made.directory)).rejects.toThrow(/checksum/);
  });
});

import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';

const DAILY_BYTES = Number(process.env.REPLAY_DAILY_BYTES || 8 * 1024 * 1024 * 1024);
const DAILY_FILES = Number(process.env.REPLAY_DAILY_FILES || 30);
const MAX_CONCURRENT_UPLOADS = Number(process.env.REPLAY_MAX_CONCURRENT_UPLOADS || 4);
const MAX_DEVICE_CONCURRENT_UPLOADS = Number(process.env.REPLAY_MAX_DEVICE_CONCURRENT_UPLOADS || 2);
const inFlightByDevice = new Map<string, { files: number; bytes: number }>();
let inFlightTotal = 0;

const safeEqual = (left: string, right: string) => left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));

export function reserveReplayUpload(deviceId: string, bytes: number, committedFiles: number, committedBytes: number, countsTowardDaily = true) {
  const current = inFlightByDevice.get(deviceId) || { files: 0, bytes: 0 };
  if (inFlightTotal >= MAX_CONCURRENT_UPLOADS) return { ok: false as const, status: 503, error: 'Replay intake is at its bounded concurrent upload limit.' };
  if (current.files >= MAX_DEVICE_CONCURRENT_UPLOADS || committedFiles + current.files + (countsTowardDaily ? 1 : 0) > DAILY_FILES || committedBytes + current.bytes + (countsTowardDaily ? bytes : 0) > DAILY_BYTES) return { ok: false as const, status: 429, error: 'This device reached its replay intake quota.' };
  inFlightTotal += 1; inFlightByDevice.set(deviceId, { files: current.files + 1, bytes: current.bytes + bytes }); let released = false;
  return { ok: true as const, release: () => {
    if (released) return; released = true; inFlightTotal -= 1;
    const latest = inFlightByDevice.get(deviceId); if (!latest || latest.files <= 1) inFlightByDevice.delete(deviceId); else inFlightByDevice.set(deviceId, { files: latest.files - 1, bytes: latest.bytes - bytes });
  } };
}

async function sha256File(file: string) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(); } }));
  return hash.digest('hex');
}

export interface ReplayBlobStorage {
  publishVerified(tempPath: string, finalPath: string, expectedHash: string, expectedSize: number): Promise<boolean>;
  verify(finalPath: string, expectedHash: string, expectedSize: number): Promise<boolean>;
}

export class DurableFilesystemReplayStorage implements ReplayBlobStorage {
  constructor(private readonly operations: Pick<typeof fsp, 'link' | 'rm' | 'stat' | 'copyFile' | 'rename' | 'open' | 'mkdir' | 'readFile'> = fsp) {}

  private lockTtlMs() {
    const configured = Number(process.env.REPLAY_PUBLICATION_LOCK_TTL_MS);
    return Number.isSafeInteger(configured) && configured >= 5_000 && configured <= 24 * 60 * 60 * 1000 ? configured : 60 * 60 * 1000;
  }

  private async acquirePublicationLock(lockPath: string) {
    const owner = `${process.pid}:${crypto.randomUUID()}`;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const now = Date.now();
      try {
        const handle = await this.operations.open(lockPath, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ owner, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + this.lockTtlMs()).toISOString() })); await handle.sync(); }
        finally { await handle.close(); }
        return owner;
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error;
        const record = await this.operations.readFile(lockPath, 'utf8').then(text => JSON.parse(text)).catch(() => null);
        const stat = await this.operations.stat(lockPath).catch(() => null);
        const expiry = Date.parse(record?.expiresAt || '') || ((stat?.mtimeMs || now) + this.lockTtlMs());
        if (expiry > now) throw Object.assign(new Error('Private replay publication is already owned by another writer.'), { status: 423, code: 'REPLAY_PUBLICATION_LOCKED' });
        // Serialize stale-lock cleanup so two contenders cannot delete a newly
        // acquired publication lock after both observed the same expired owner.
        const recoveryPath = `${lockPath}.recovery`;
        let recovery: Awaited<ReturnType<typeof fsp.open>> | null = null;
        try {
          recovery = await this.operations.open(recoveryPath, 'wx', 0o600) as Awaited<ReturnType<typeof fsp.open>>;
          const latest = await this.operations.readFile(lockPath, 'utf8').then(text => JSON.parse(text)).catch(() => null);
          const latestStat = await this.operations.stat(lockPath).catch(() => null);
          const latestExpiry = Date.parse(latest?.expiresAt || '') || ((latestStat?.mtimeMs || now) + this.lockTtlMs());
          if (latestStat && latestExpiry <= Date.now()) await this.operations.rm(lockPath, { force: true });
        } catch (recoveryError: any) {
          if (recoveryError?.code === 'EEXIST') throw Object.assign(new Error('Another writer is recovering a stale replay publication lock.'), { status: 423, code: 'REPLAY_PUBLICATION_LOCKED' });
          throw recoveryError;
        } finally {
          if (recovery) await recovery.close().catch(() => {});
          if (recovery) await this.operations.rm(recoveryPath, { force: true }).catch(() => {});
        }
      }
    }
    throw Object.assign(new Error('Stale replay publication lock could not be recovered.'), { status: 423, code: 'REPLAY_PUBLICATION_LOCKED' });
  }

  private async releasePublicationLock(lockPath: string, owner: string) {
    const record = await this.operations.readFile(lockPath, 'utf8').then(text => JSON.parse(text)).catch(() => null);
    if (record?.owner === owner) await this.operations.rm(lockPath, { force: true });
  }

  private async refreshPublicationLock(lockPath: string, owner: string) {
    const record = await this.operations.readFile(lockPath, 'utf8').then(text => JSON.parse(text)).catch(() => null);
    if (record?.owner !== owner) return false;
    const handle = await this.operations.open(lockPath, 'r+');
    try {
      await handle.truncate(0);
      await handle.writeFile(JSON.stringify({ owner, createdAt: record.createdAt, expiresAt: new Date(Date.now() + this.lockTtlMs()).toISOString() }));
      await handle.sync();
    } finally { await handle.close(); }
    return true;
  }

  async verify(finalPath: string, expectedHash: string, expectedSize: number) {
    const stat = await this.operations.stat(finalPath).catch(() => null);
    if (!stat?.isFile() || stat.size !== expectedSize) return false;
    return safeEqual(await sha256File(finalPath), expectedHash);
  }

  async publishVerified(tempPath: string, finalPath: string, expectedHash: string, expectedSize: number) {
    if (!await this.verify(tempPath, expectedHash, expectedSize)) throw Object.assign(new Error('Private replay staging object failed integrity verification.'), { status: 422 });
    await this.operations.mkdir(path.dirname(finalPath), { recursive: true });
    try {
      await this.operations.link(tempPath, finalPath);
      if (!await this.verify(finalPath, expectedHash, expectedSize)) throw new Error('Published replay failed post-publication verification.');
      await this.operations.rm(tempPath, { force: true }); return true;
    } catch (error: any) {
      if (error?.code === 'EEXIST') {
        if (!await this.verify(finalPath, expectedHash, expectedSize)) throw Object.assign(new Error('Private replay destination conflicts with the verified upload.'), { status: 409 });
        await this.operations.rm(tempPath, { force: true }); return false;
      }
      if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EINVAL'].includes(error?.code)) throw error;
    }

    // Filesystems and mounted object stores may not support hardlinks. Cooperating
    // writers use an exclusive lock, copy to a sibling staging file, fsync, verify,
    // and only then rename it into place. No partial final object is advertised.
    const lockPath = `${finalPath}.publish.lock`; const stagePath = `${finalPath}.${crypto.randomBytes(12).toString('hex')}.publish`;
    let lockOwner: string | null = null; let lockHeartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      lockOwner = await this.acquirePublicationLock(lockPath);
      const heartbeatMs = Math.max(1_000, Math.floor(this.lockTtlMs() / 3));
      lockHeartbeat = setInterval(() => { void this.refreshPublicationLock(lockPath, lockOwner!).catch(() => {}); }, heartbeatMs); lockHeartbeat.unref?.();
      if (await this.verify(finalPath, expectedHash, expectedSize)) { await this.operations.rm(tempPath, { force: true }); return false; }
      const existing = await this.operations.stat(finalPath).catch(() => null);
      if (existing) throw Object.assign(new Error('Private replay destination conflicts with the verified upload.'), { status: 409 });
      await this.operations.copyFile(tempPath, stagePath, fs.constants.COPYFILE_EXCL);
      const staged = await this.operations.open(stagePath, 'r+'); try { await staged.sync(); } finally { await staged.close(); }
      if (!await this.verify(stagePath, expectedHash, expectedSize)) throw new Error('Copied replay failed integrity verification.');
      await this.operations.rename(stagePath, finalPath);
      if (!await this.verify(finalPath, expectedHash, expectedSize)) throw new Error('Published replay failed post-publication verification.');
      await this.operations.rm(tempPath, { force: true }); return true;
    } finally {
      if (lockHeartbeat) clearInterval(lockHeartbeat);
      await this.operations.rm(stagePath, { force: true }).catch(() => {});
      if (lockOwner) await this.releasePublicationLock(lockPath, lockOwner).catch(() => {});
    }
  }
}

export function createReplayBlobStorage() {
  const backend = process.env.REPLAY_STORAGE_BACKEND || 'filesystem';
  if (backend !== 'filesystem') throw new Error('Object replay storage is gated until a real conditional-create backend is configured; GCS FUSE alone is not accepted as object-store proof.');
  return new DurableFilesystemReplayStorage();
}

export async function publishVerifiedReplayTemp(tempPath: string, finalPath: string, expectedHash: string, expectedSize: number) {
  return createReplayBlobStorage().publishVerified(tempPath, finalPath, expectedHash, expectedSize);
}

export { sha256File as sha256ReplayFile };

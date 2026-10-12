import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { readDB, saveDB, DB_PATH } from '../store';

const REPLAY_TYPE = 'application/vnd.valorant.replay';
const MAX_REPLAY_BYTES = Number(process.env.REPLAY_MAX_BYTES || 2 * 1024 * 1024 * 1024);
const MAX_UPLOAD_MS = Number(process.env.REPLAY_UPLOAD_TIMEOUT_MS || 10 * 60 * 1000);
const DEVICE_TTL_MS = Number(process.env.REPLAY_DEVICE_TTL_MS || 90 * 24 * 60 * 60 * 1000);
const DAILY_BYTES = Number(process.env.REPLAY_DAILY_BYTES || 8 * 1024 * 1024 * 1024);
const DAILY_FILES = Number(process.env.REPLAY_DAILY_FILES || 30);
const PRIVATE_DIR = path.resolve(process.env.REPLAY_STORAGE_DIR || path.join(path.dirname(DB_PATH), 'private-replays'));
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const uploadLocks = new Map<string, Promise<void>>();

function assertPrivateStorageRoot() {
  for (const relative of ['dist', 'fb-public', 'public']) {
    const staticRoot = path.resolve(process.cwd(), relative); const relation = path.relative(staticRoot, PRIVATE_DIR);
    if (!relation || (!relation.startsWith('..') && !path.isAbsolute(relation))) throw new Error('REPLAY_STORAGE_DIR must be outside static/frontend asset directories.');
  }
}

type Actor = { role: 'coach' | 'player'; username: string; playerId?: string; actorId: string };
type DeviceRecord = {
  id: string; name: string; tokenHash: string; credentialVersion: number;
  owner: { actorId: string; role: 'coach' | 'player'; playerId: string | null };
  createdAt: string; expiresAt: string; revokedAt: string | null; lastSeenAt: string | null;
};

function replayStore(db: any) {
  db.replayIntake ||= { schemaVersion: 1, devices: {}, uploads: {} };
  db.replayIntake.devices ||= {};
  db.replayIntake.uploads ||= {};
  return db.replayIntake as { schemaVersion: number; devices: Record<string, DeviceRecord>; uploads: Record<string, any> };
}

const tokenHash = (token: string) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

function actor(req: Request): Actor { return (req as any).user as Actor; }
function devicePublic(device: DeviceRecord) {
  return {
    id: device.id, name: device.name, owner: device.owner, createdAt: device.createdAt,
    expiresAt: device.expiresAt, revokedAt: device.revokedAt, lastSeenAt: device.lastSeenAt,
    status: device.revokedAt ? 'revoked' : Date.parse(device.expiresAt) <= Date.now() ? 'expired' : 'active',
  };
}

function cleanDeviceName(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean.length >= 2 && clean.length <= 80 && /^[\p{L}\p{N} ._()'-]+$/u.test(clean) ? clean : null;
}

function cleanReplayName(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = path.basename(value.trim());
  if (clean !== value.trim() || clean.length < 5 || clean.length > 180 || !/^[A-Za-z0-9 ._()-]+\.vrf$/i.test(clean)) return null;
  return clean;
}

function privateReplayPath(hash: string) {
  const target = path.resolve(PRIVATE_DIR, hash.slice(0, 2), `${hash}.vrf`);
  if (!target.startsWith(`${PRIVATE_DIR}${path.sep}`)) throw new Error('Replay storage path escaped its private root.');
  return target;
}

async function acquireUploadLock(hash: string) {
  const prior = uploadLocks.get(hash) || Promise.resolve(); let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; }); const tail = prior.then(() => current); uploadLocks.set(hash, tail);
  await prior;
  return () => { release(); if (uploadLocks.get(hash) === tail) uploadLocks.delete(hash); };
}

async function authenticateDevice(req: Request) {
  const id = String(req.header('x-device-id') || '');
  const token = String(req.header('x-device-token') || '');
  if (!DEVICE_ID.test(id) || token.length < 43 || token.length > 256) return null;
  const db = await readDB(); const store = replayStore(db); const device = store.devices[id];
  if (!device || device.revokedAt || Date.parse(device.expiresAt) <= Date.now() || !safeEqual(device.tokenHash, tokenHash(token))) return null;
  return { db, store, device };
}

function uploadPublic(record: any) {
  return {
    id: record.id, sha256: record.sha256, size: record.size, originalName: record.originalName,
    deviceId: record.deviceId, owner: record.owner, receivedAt: record.receivedAt,
    uploadStatus: 'stored-private', parserStatus: record.parserStatus || 'unavailable',
    reviewStatus: record.reviewStatus || 'review-required', matchId: record.matchId || null,
  };
}

/** Register before the normal session middleware: this endpoint authenticates a scoped device credential. */
export function registerReplayDeviceUploadRoute(app: Express) {
  assertPrivateStorageRoot();
  app.put('/api/replay-intake/uploads/:sha256', async (req, res) => {
    let tempPath: string | null = null; let releaseLock: (() => void) | null = null;
    const deadline = setTimeout(() => req.destroy(new Error('Replay upload timed out.')), MAX_UPLOAD_MS);
    try {
      if (req.header('content-type') !== REPLAY_TYPE) return res.status(415).json({ error: `Content-Type must be ${REPLAY_TYPE}.` });
      const expectedHash = String(req.params.sha256 || '').toLowerCase();
      const originalName = cleanReplayName(req.header('x-replay-filename'));
      const length = Number(req.header('content-length'));
      if (!HEX_SHA256.test(expectedHash) || !originalName) return res.status(400).json({ error: 'A valid SHA-256 URL and sanitized .vrf filename are required.' });
      if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_REPLAY_BYTES) return res.status(413).json({ error: 'Replay size is missing or outside the configured limit.' });
      releaseLock = await acquireUploadLock(expectedHash);

      const authenticated = await authenticateDevice(req);
      if (!authenticated) return res.status(401).json({ error: 'Device credential is invalid, expired, or revoked.' });
      const { db, store, device } = authenticated;
      const existing = store.uploads[expectedHash];
      if (existing) {
        req.resume();
        if (existing.size !== length) return res.status(409).json({ error: 'The replay hash already exists with conflicting metadata.' });
        return res.status(200).json({ ...uploadPublic(existing), idempotent: true });
      }

      const day = new Date().toISOString().slice(0, 10);
      const today = Object.values(store.uploads).filter((item: any) => item.deviceId === device.id && String(item.receivedAt).startsWith(day));
      if (today.length >= DAILY_FILES || today.reduce((sum: number, item: any) => sum + Number(item.size || 0), 0) + length > DAILY_BYTES) {
        return res.status(429).json({ error: 'This device reached its daily private replay intake quota.' });
      }

      const finalPath = privateReplayPath(expectedHash);
      await fsp.mkdir(path.dirname(finalPath), { recursive: true });
      tempPath = `${finalPath}.${crypto.randomBytes(12).toString('hex')}.upload`;
      const hasher = crypto.createHash('sha256'); let received = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > length || received > MAX_REPLAY_BYTES) return callback(new Error('Replay exceeded its declared or configured size.'));
          hasher.update(chunk); callback(null, chunk);
        },
      });
      await pipeline(req, meter, fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
      if (received !== length) throw Object.assign(new Error('Replay upload length did not match Content-Length.'), { status: 400 });
      const actualHash = hasher.digest('hex');
      if (!safeEqual(expectedHash, actualHash)) throw Object.assign(new Error('Replay SHA-256 verification failed.'), { status: 422 });
      await fsp.rename(tempPath, finalPath); tempPath = null;

      const now = new Date().toISOString();
      const record = {
        id: crypto.randomUUID(), sha256: actualHash, size: received, originalName,
        deviceId: device.id, owner: device.owner, receivedAt: now,
        parserStatus: 'unavailable', reviewStatus: 'review-required', matchId: null,
      };
      store.uploads[actualHash] = record; device.lastSeenAt = now;
      try { await saveDB(db); }
      catch (error) { await fsp.rm(finalPath, { force: true }); throw error; }
      return res.status(201).json(uploadPublic(record));
    } catch (error: any) {
      if (!res.headersSent) res.status(error?.status || (error?.code === 'ECONNRESET' ? 408 : 400)).json({ error: error?.message || 'Replay upload failed.' });
    } finally {
      clearTimeout(deadline);
      if (tempPath) await fsp.rm(tempPath, { force: true }).catch(() => {});
      releaseLock?.();
    }
  });
}

/** Session-authenticated enrollment, revocation, and private status views. */
export function registerReplayDeviceRoutes(app: Express) {
  app.post('/api/replay-intake/devices/enroll', async (req, res) => {
    try {
      const user = actor(req); const name = cleanDeviceName(req.body?.name);
      if (!name) return res.status(400).json({ error: 'Device name must be 2–80 safe characters.' });
      const requestedPlayerId = typeof req.body?.playerId === 'string' ? req.body.playerId : null;
      if (user.role === 'player' && (!user.playerId || (requestedPlayerId && requestedPlayerId !== user.playerId))) return res.status(403).json({ error: 'Players may enroll only a device linked to their own roster identity.' });
      const ownerPlayerId = user.role === 'player' ? user.playerId! : requestedPlayerId;
      const db = await readDB();
      if (ownerPlayerId && !(db.rosterPlayers || []).some((item: any) => item.id === ownerPlayerId && !item.retiredAt)) return res.status(400).json({ error: 'Device owner must be an active roster player.' });
      const store = replayStore(db); const id = crypto.randomBytes(18).toString('base64url'); const token = crypto.randomBytes(32).toString('base64url'); const now = new Date();
      const device: DeviceRecord = {
        id, name, tokenHash: tokenHash(token), credentialVersion: 1,
        owner: { actorId: user.actorId, role: user.role, playerId: ownerPlayerId || null },
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + DEVICE_TTL_MS).toISOString(), revokedAt: null, lastSeenAt: null,
      };
      store.devices[id] = device; await saveDB(db);
      res.status(201).json({ device: devicePublic(device), credential: { token, shownOnce: true, storage: 'windows-dpapi-required' } });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/replay-intake/devices', async (req, res) => {
    try {
      const user = actor(req); const db = await readDB(); const store = replayStore(db);
      const visible = Object.values(store.devices).filter(device => user.role === 'coach' || (device.owner.actorId === user.actorId && device.owner.playerId === user.playerId));
      res.json(visible.map(devicePublic));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/replay-intake/devices/revoke', async (req, res) => {
    try {
      const user = actor(req); const id = String(req.body?.deviceId || ''); const db = await readDB(); const store = replayStore(db); const device = store.devices[id];
      if (!device) return res.status(404).json({ error: 'Device not found.' });
      const ownsDevice = device.owner.actorId === user.actorId && device.owner.playerId === (user.playerId || null);
      if (user.role !== 'coach' && !ownsDevice) return res.status(403).json({ error: 'Players may revoke only their own device.' });
      if (!device.revokedAt) { device.revokedAt = new Date().toISOString(); device.credentialVersion += 1; await saveDB(db); }
      res.json(devicePublic(device));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/replay-intake/uploads', async (req, res) => {
    try {
      const user = actor(req); const db = await readDB(); const store = replayStore(db);
      const visible = Object.values(store.uploads).filter((item: any) => user.role === 'coach' || (item.owner?.actorId === user.actorId && item.owner?.playerId === user.playerId));
      res.json(visible.map(uploadPublic));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });
}

export const replayIntakeInternals = { REPLAY_TYPE, cleanReplayName, privateReplayPath, tokenHash };

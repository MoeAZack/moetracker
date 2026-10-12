import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { readDB, saveDB, DB_PATH } from '../store';
import { publishVerifiedReplayTemp, reserveReplayUpload, sha256ReplayFile } from '../replayIntakeSafety';
import { buildReplayOpeningReviewDraft } from '../replayOpeningEngine';
import { loadVrfkitPipelineConfig, runVrfkitReplayPipeline } from '../vrfkitReplayPipeline';

const REPLAY_TYPE = 'application/vnd.valorant.replay';
const MAX_REPLAY_BYTES = Number(process.env.REPLAY_MAX_BYTES || 2 * 1024 * 1024 * 1024);
const MAX_UPLOAD_MS = Number(process.env.REPLAY_UPLOAD_TIMEOUT_MS || 10 * 60 * 1000);
const DEVICE_TTL_MS = Number(process.env.REPLAY_DEVICE_TTL_MS || 90 * 24 * 60 * 60 * 1000);
const PRIVATE_DIR = path.resolve(process.env.REPLAY_STORAGE_DIR || path.join(path.dirname(DB_PATH), 'private-replays'));
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const uploadLocks = new Map<string, Promise<void>>();
const parserSchedulerActive = new Set<string>();
let parserSchedulerPumping = false;

function boundedEnvInteger(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

function parserLimits() {
  return {
    concurrent: boundedEnvInteger('VRFKIT_MAX_CONCURRENT_JOBS', 1, 4),
    queued: boundedEnvInteger('VRFKIT_MAX_QUEUED_JOBS', 8, 32),
    perActor: boundedEnvInteger('VRFKIT_MAX_ACTOR_ACTIVE_JOBS', 2, 8),
    perDevice: boundedEnvInteger('VRFKIT_MAX_DEVICE_ACTIVE_JOBS', 2, 8),
    retained: boundedEnvInteger('VRFKIT_RETAINED_JOB_COUNT', 100, 500),
    retentionMs: boundedEnvInteger('VRFKIT_JOB_RETENTION_MS', 30 * 24 * 60 * 60 * 1000, 180 * 24 * 60 * 60 * 1000),
    evidenceBytes: boundedEnvInteger('VRFKIT_MAX_RETAINED_EVIDENCE_BYTES', 4 * 1024 * 1024, 8 * 1024 * 1024),
  };
}

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

type ReplayBlob = { sha256: string; size: number; storedAt: string; parserStatus: 'unavailable' | 'pending' | 'parsed-review-required' | 'failed'; parserJobId?: string | null; reviewStatus: 'review-required'; matchId: string | null };
type ReplayAssociation = { id: string; sha256: string; size: number; originalName: string; deviceId: string; owner: DeviceRecord['owner']; receivedAt: string };
type ReplayParserJob = {
  id: string; sha256: string; requestedBy: string; status: 'queued' | 'running' | 'completed' | 'failed';
  sourceDeviceIds: string[];
  createdAt: string; startedAt: string | null; completedAt: string | null;
  parser: { name: 'vrfkit'; version: '0.2.5' }; reviewStatus: 'review-required';
  result?: { scoreboard: any; reviewDraft: any; diagnostics: any };
  failure?: { code: string; message: string };
};
type ReplayStore = { schemaVersion: number; devices: Record<string, DeviceRecord>; blobs: Record<string, ReplayBlob>; associations: Record<string, ReplayAssociation>; parserJobs: Record<string, ReplayParserJob>; uploads?: Record<string, any> };

function associationKey(deviceId: string, hash: string) { return crypto.createHash('sha256').update(`${deviceId}\0${hash}`).digest('hex'); }
function newDeviceId() { return `d_${crypto.randomBytes(18).toString('base64url')}`; }

function replayStore(db: any) {
  db.replayIntake ||= { schemaVersion: 3, devices: {}, blobs: {}, associations: {}, parserJobs: {} };
  db.replayIntake.devices ||= {};
  db.replayIntake.blobs ||= {};
  db.replayIntake.associations ||= {};
  db.replayIntake.parserJobs ||= {};
  // One-time in-memory migration from the first local-only schema. Responses never read legacy records directly.
  for (const [hash, record] of Object.entries(db.replayIntake.uploads || {}) as Array<[string, any]>) {
    db.replayIntake.blobs[hash] ||= { sha256: hash, size: record.size, storedAt: record.receivedAt, parserStatus: record.parserStatus || 'unavailable', reviewStatus: 'review-required', matchId: record.matchId || null };
    if (record.deviceId) db.replayIntake.associations[associationKey(record.deviceId, hash)] ||= { id: record.id, sha256: hash, size: record.size, originalName: record.originalName, deviceId: record.deviceId, owner: record.owner, receivedAt: record.receivedAt };
  }
  delete db.replayIntake.uploads;
  db.replayIntake.schemaVersion = 3;
  return db.replayIntake as ReplayStore;
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

function uploadPublic(record: ReplayAssociation, blob: ReplayBlob) {
  return {
    id: record.id, sha256: record.sha256, size: record.size, originalName: record.originalName,
    deviceId: record.deviceId, owner: record.owner, receivedAt: record.receivedAt,
    uploadStatus: 'stored-private', parserStatus: blob.parserStatus || 'unavailable',
    reviewStatus: blob.reviewStatus || 'review-required', matchId: blob.matchId || null,
  };
}

function parserJobPublic(job: ReplayParserJob) {
  return {
    id: job.id, sha256: job.sha256, status: job.status, createdAt: job.createdAt,
    startedAt: job.startedAt, completedAt: job.completedAt, parser: job.parser,
    reviewStatus: job.reviewStatus, ...(job.result ? { result: job.result } : {}),
    ...(job.failure ? { failure: job.failure } : {}),
  };
}

function actorCanSeeReplay(user: Actor, store: ReplayStore, sha256: string) {
  return user.role === 'coach' || Object.values(store.associations).some(item => item.sha256 === sha256
    && item.owner.actorId === user.actorId && item.owner.playerId === (user.playerId || null));
}

function parserFailure(error: any) {
  const message = String(error?.message || '');
  if (error?.code === 'parser-unavailable') return { code: 'parser-unavailable', message: 'The pinned replay parser is not configured on this server.' };
  if (message.includes('SHA-256')) return { code: 'integrity-check-failed', message: 'Replay parsing stopped because an integrity check failed.' };
  if (message.includes('timed out')) return { code: 'parser-timeout', message: 'Replay parsing exceeded the configured time limit.' };
  if (message.includes('size limit') || message.includes('file-count') || message.includes('evidence limit')) return { code: 'parser-output-limit', message: 'Replay parsing exceeded a configured output limit.' };
  return { code: 'parser-failed', message: 'Replay parsing failed. Review private server diagnostics.' };
}

function pruneParserJobs(store: ReplayStore, nowMs = Date.now()) {
  let changed = false;
  const limits = parserLimits();
  const terminal = Object.values(store.parserJobs).filter(job => ['completed', 'failed'].includes(job.status))
    .sort((left, right) => (Date.parse(right.completedAt || right.createdAt) - Date.parse(left.completedAt || left.createdAt)) || right.id.localeCompare(left.id));
  const keep = new Set(terminal.slice(0, limits.retained).filter(job => nowMs - Date.parse(job.completedAt || job.createdAt) <= limits.retentionMs).map(job => job.id));
  for (const job of terminal) {
    if (keep.has(job.id)) continue;
    delete store.parserJobs[job.id];
    changed = true;
    const blob = store.blobs[job.sha256];
    if (blob?.parserJobId === job.id) blob.parserJobId = null;
  }
  return changed;
}

function parserAdmission(store: ReplayStore, requestedBy: string, sourceDeviceIds: string[]) {
  const limits = parserLimits();
  const admitted = Object.values(store.parserJobs).filter(job => ['queued', 'running'].includes(job.status));
  if (admitted.filter(job => job.status === 'queued').length >= limits.queued) return { ok: false as const, error: 'The private parser queue is full.' };
  if (admitted.filter(job => job.requestedBy === requestedBy).length >= limits.perActor) return { ok: false as const, error: 'This coach has reached the active parser-job limit.' };
  if (sourceDeviceIds.some(deviceId => admitted.filter(job => (job.sourceDeviceIds || []).includes(deviceId)).length >= limits.perDevice)) {
    return { ok: false as const, error: 'A source device has reached the active parser-job limit.' };
  }
  return { ok: true as const };
}

function nextParserJobs(store: ReplayStore, activeIds: Set<string>, capacity: number) {
  return Object.values(store.parserJobs).filter(job => job.status === 'queued' && !activeIds.has(job.id))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, capacity));
}

async function executeParserJob(jobId: string, sha256: string) {
  try {
    let db = await readDB(); let store = replayStore(db); const job = store.parserJobs[jobId];
    if (!job || job.status !== 'queued') return;
    job.status = 'running'; job.startedAt = new Date().toISOString(); await saveDB(db);
    const config = loadVrfkitPipelineConfig(PRIVATE_DIR);
    const parsed = await runVrfkitReplayPipeline(privateReplayPath(sha256), sha256, config);
    const reviewDraft = buildReplayOpeningReviewDraft(parsed.result.parserInput);
    db = await readDB(); store = replayStore(db); const current = store.parserJobs[jobId]; const blob = store.blobs[sha256];
    if (!current || !blob) throw new Error('Replay parser job lost its private intake record.');
    const retained = { scoreboard: parsed.result.scoreboard, reviewDraft, diagnostics: parsed.result.diagnostics };
    if (Buffer.byteLength(JSON.stringify(retained)) > parserLimits().evidenceBytes) throw new Error('Normalized replay evidence exceeded its retained evidence limit.');
    current.status = 'completed'; current.completedAt = new Date().toISOString(); current.result = retained;
    blob.parserStatus = 'parsed-review-required'; blob.reviewStatus = 'review-required'; blob.parserJobId = jobId;
    pruneParserJobs(store);
    await saveDB(db);
  } catch (error: any) {
    console.error('[replay-parser] private job failed:', error?.message || error);
    try {
      const db = await readDB(); const store = replayStore(db); const job = store.parserJobs[jobId]; const blob = store.blobs[sha256];
      if (job) { job.status = 'failed'; job.completedAt = new Date().toISOString(); job.failure = parserFailure(error); }
      if (blob) { blob.parserStatus = 'failed'; blob.parserJobId = jobId; }
      pruneParserJobs(store);
      await saveDB(db);
    } catch (persistError: any) { console.error('[replay-parser] could not persist private failure state:', persistError?.message || persistError); }
  }
}

function requestParserPump() { setImmediate(() => { void pumpParserQueue(); }); }

async function pumpParserQueue() {
  if (parserSchedulerPumping) return;
  parserSchedulerPumping = true;
  try {
    while (parserSchedulerActive.size < parserLimits().concurrent) {
      const db = await readDB(); const store = replayStore(db);
      const next = nextParserJobs(store, parserSchedulerActive, 1)[0];
      if (!next) break;
      parserSchedulerActive.add(next.id);
      void executeParserJob(next.id, next.sha256).finally(() => {
        parserSchedulerActive.delete(next.id);
        requestParserPump();
      });
    }
  } finally { parserSchedulerPumping = false; }
}

async function recoverParserQueue() {
  const db = await readDB(); const store = replayStore(db); let changed = false;
  for (const job of Object.values(store.parserJobs)) {
    if (job.status !== 'running') continue;
    job.status = 'failed'; job.completedAt = new Date().toISOString();
    job.failure = { code: 'parser-interrupted', message: 'Replay parsing was interrupted before completion.' };
    const blob = store.blobs[job.sha256]; if (blob?.parserJobId === job.id) blob.parserStatus = 'failed';
    changed = true;
  }
  changed = pruneParserJobs(store) || changed;
  if (changed) await saveDB(db);
  if (Object.values(store.parserJobs).some(job => job.status === 'queued')) requestParserPump();
}

/** Register before the normal session middleware: this endpoint authenticates a scoped device credential. */
export function registerReplayDeviceUploadRoute(app: Express) {
  assertPrivateStorageRoot();
  app.put('/api/replay-intake/uploads/:sha256', async (req, res) => {
    let tempPath: string | null = null; let releaseLock: (() => void) | null = null; let releaseReservation: (() => void) | null = null;
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
      const ownKey = associationKey(device.id, expectedHash); const ownAssociation = store.associations[ownKey]; const existingBlob = store.blobs[expectedHash];
      const day = new Date().toISOString().slice(0, 10);
      const today = Object.values(store.associations).filter(item => item.deviceId === device.id && String(item.receivedAt).startsWith(day));
      const reservation = reserveReplayUpload(device.id, length, today.length, today.reduce((sum, item) => sum + Number(item.size || 0), 0), !ownAssociation);
      if (!reservation.ok) return res.status(reservation.status).json({ error: reservation.error });
      releaseReservation = reservation.release;

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
      if (existingBlob) {
        if (existingBlob.size !== received) throw Object.assign(new Error('The replay hash already exists with conflicting metadata.'), { status: 409 });
        const storedFile = await fsp.stat(finalPath).catch(() => null);
        if (!storedFile || storedFile.size !== received) throw Object.assign(new Error('Private replay blob is unavailable or inconsistent.'), { status: 409 });
        const storedHash = await sha256ReplayFile(finalPath);
        if (!safeEqual(storedHash, expectedHash)) throw Object.assign(new Error('Private replay blob failed integrity verification.'), { status: 409 });
        await fsp.rm(tempPath, { force: true }); tempPath = null;
        if (ownAssociation) return res.status(200).json({ ...uploadPublic(ownAssociation, existingBlob), idempotent: true });
        const now = new Date().toISOString(); const association: ReplayAssociation = { id: crypto.randomUUID(), sha256: actualHash, size: received, originalName, deviceId: device.id, owner: device.owner, receivedAt: now };
        store.associations[ownKey] = association; device.lastSeenAt = now; await saveDB(db);
        return res.status(201).json({ ...uploadPublic(association, existingBlob), deduplicated: true });
      }
      await publishVerifiedReplayTemp(tempPath, finalPath, expectedHash, received); tempPath = null;

      const now = new Date().toISOString();
      const blob: ReplayBlob = { sha256: actualHash, size: received, storedAt: now, parserStatus: 'unavailable', reviewStatus: 'review-required', matchId: null };
      const association: ReplayAssociation = { id: crypto.randomUUID(), sha256: actualHash, size: received, originalName, deviceId: device.id, owner: device.owner, receivedAt: now };
      store.blobs[actualHash] = blob; store.associations[ownKey] = association; device.lastSeenAt = now;
      // A failed metadata write deliberately leaves a verified hash-named orphan. A retry validates and reuses it;
      // deleting here could race another process that already associated the same global blob.
      await saveDB(db);
      return res.status(201).json(uploadPublic(association, blob));
    } catch (error: any) {
      if (!res.headersSent) res.status(error?.status || (error?.code === 'ECONNRESET' ? 408 : 400)).json({ error: error?.message || 'Replay upload failed.' });
    } finally {
      clearTimeout(deadline);
      if (tempPath) await fsp.rm(tempPath, { force: true }).catch(() => {});
      releaseReservation?.();
      releaseLock?.();
    }
  });
}

/** Session-authenticated enrollment, revocation, and private status views. */
export async function registerReplayDeviceRoutes(app: Express) {
  app.post('/api/replay-intake/devices/enroll', async (req, res) => {
    try {
      const user = actor(req); const name = cleanDeviceName(req.body?.name);
      if (!name) return res.status(400).json({ error: 'Device name must be 2–80 safe characters.' });
      const requestedPlayerId = typeof req.body?.playerId === 'string' ? req.body.playerId : null;
      if (user.role === 'player' && (!user.playerId || (requestedPlayerId && requestedPlayerId !== user.playerId))) return res.status(403).json({ error: 'Players may enroll only a device linked to their own roster identity.' });
      const ownerPlayerId = user.role === 'player' ? user.playerId! : requestedPlayerId;
      const db = await readDB();
      if (ownerPlayerId && !(db.rosterPlayers || []).some((item: any) => item.id === ownerPlayerId && !item.retiredAt)) return res.status(400).json({ error: 'Device owner must be an active roster player.' });
      const store = replayStore(db); const id = newDeviceId(); const token = crypto.randomBytes(32).toString('base64url'); const now = new Date();
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
      const visible = Object.values(store.associations).filter(item => user.role === 'coach' || (item.owner?.actorId === user.actorId && item.owner?.playerId === user.playerId));
      res.json(visible.flatMap(item => store.blobs[item.sha256] ? [uploadPublic(item, store.blobs[item.sha256])] : []));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/replay-intake/uploads/:sha256/parse', async (req, res) => {
    try {
      const user = actor(req);
      if (user.role !== 'coach') return res.status(403).json({ error: 'Only a coach can start replay parsing.' });
      const sha256 = String(req.params.sha256 || '').toLowerCase();
      if (!HEX_SHA256.test(sha256)) return res.status(400).json({ error: 'Replay SHA-256 is invalid.' });
      // Configuration is checked before recording a job. Upload remains safe and parser-free by default.
      loadVrfkitPipelineConfig(PRIVATE_DIR);
      const db = await readDB(); const store = replayStore(db); const blob = store.blobs[sha256];
      if (!blob) return res.status(404).json({ error: 'Private replay not found.' });
      const active = Object.values(store.parserJobs).find(job => job.sha256 === sha256 && ['queued', 'running'].includes(job.status));
      if (active) return res.status(409).json({ error: 'This replay already has an active parser job.', job: parserJobPublic(active) });
      const sourceDeviceIds = [...new Set(Object.values(store.associations).filter(item => item.sha256 === sha256).map(item => item.deviceId))].sort();
      if (!sourceDeviceIds.length) return res.status(409).json({ error: 'Replay has no private device association.' });
      const admission = parserAdmission(store, user.actorId, sourceDeviceIds);
      if (!admission.ok) return res.status(429).json({ error: admission.error });
      const now = new Date().toISOString();
      const job: ReplayParserJob = {
        id: crypto.randomUUID(), sha256, requestedBy: user.actorId, sourceDeviceIds, status: 'queued',
        createdAt: now, startedAt: null, completedAt: null,
        parser: { name: 'vrfkit', version: '0.2.5' }, reviewStatus: 'review-required',
      };
      store.parserJobs[job.id] = job; blob.parserStatus = 'pending'; blob.parserJobId = job.id; await saveDB(db);
      res.status(202).json(parserJobPublic(job));
      requestParserPump();
    } catch (error: any) {
      const failure = parserFailure(error);
      res.status(failure.code === 'parser-unavailable' ? 503 : 400).json({ error: failure.message, code: failure.code });
    }
  });

  app.get('/api/replay-intake/uploads/:sha256/parser', async (req, res) => {
    try {
      const user = actor(req); const sha256 = String(req.params.sha256 || '').toLowerCase();
      if (!HEX_SHA256.test(sha256)) return res.status(400).json({ error: 'Replay SHA-256 is invalid.' });
      const db = await readDB(); const store = replayStore(db); const blob = store.blobs[sha256];
      if (!blob || !actorCanSeeReplay(user, store, sha256)) return res.status(404).json({ error: 'Private replay not found.' });
      const job = blob.parserJobId ? store.parserJobs[blob.parserJobId] : null;
      res.json(job ? parserJobPublic(job) : { sha256, status: blob.parserStatus, reviewStatus: blob.reviewStatus, parser: { name: 'vrfkit', version: '0.2.5' } });
    } catch (error: any) { res.status(500).json({ error: 'Replay parser status is unavailable.' }); }
  });

  await recoverParserQueue();
}

export const replayIntakeInternals = {
  REPLAY_TYPE, cleanReplayName, privateReplayPath, tokenHash, associationKey,
  parserLimits, pruneParserJobs, parserAdmission, nextParserJobs, newDeviceId, DEVICE_ID,
};

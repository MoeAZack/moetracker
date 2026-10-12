import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localEvidenceDigest } from '../lib/replayEvidence';
import { VRFKIT_PIN } from '../lib/vrfkitReplayPipeline';

const adminKey = 'replay-admin-secret-at-least-24-characters';
const jwtSecret = 'replay-session-secret-at-least-24-characters';
const playerKey = 'replay-player-key';
let tempDir: string; let dbPath: string; let replayDir: string; let server: Server | undefined; let origin: string;

async function jsonRequest(route: string, token?: string, body?: unknown) {
  return fetch(`${origin}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(key: string) { const response = await jsonRequest('/api/login-key', undefined, { key }); expect(response.status).toBe(200); return (await response.json()).key as string; }
function evidenceEnvelope(sha256: string, size: number, deviceId: string) {
  const available = (value: number) => ({ value, status: 'available', source: 'device-fixture', confidence: 1 });
  const normalized: any = { schemaVersion: 1, parserInput: { parser: { name: 'vrfkit', version: VRFKIT_PIN.version }, provenance: { replaySha256: sha256 }, file: { format: 'vrf', support: 'supported' }, identities: [{ playerId: 'a', teamId: 'red' }], summary: { roundCount: 1, finalScore: { teamA: 1, teamB: 0 }, players: [] }, rounds: [{ roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: ['a'], participantCoverage: { status: 'complete', expectedPlayerCount: 1 }, winnerTeamId: 'red', events: [] }], capabilities: [] }, scoreboard: { reviewRequired: true, evidenceCoverage: { status: 'complete', reason: null }, map: { value: null, status: 'unavailable', source: 'fixture', confidence: null }, durationMs: available(1), finalScore: { teamA: { teamId: 'red', score: available(1) }, teamB: { teamId: 'blue', score: available(0) } }, players: [], unavailableFields: [] }, diagnostics: { replaySha256: sha256, binarySha256: VRFKIT_PIN.windowsX64ExeSha256, binaryVersion: VRFKIT_PIN.version, binaryCommit: VRFKIT_PIN.commit, manifestSha256: 'f'.repeat(64), replayBuild: null, outputFileCount: 1, outputBytes: 1, identityMappingComplete: true, duplicateActorMappings: 0, duplicatePawnMappings: 0 } };
  const base: any = { schemaVersion: 1, source: { sha256, size, originalName: `${sha256.slice(0, 8)}.vrf`, deviceId }, parser: { name: 'vrfkit', version: VRFKIT_PIN.version, binarySha256: VRFKIT_PIN.windowsX64ExeSha256, binaryCommit: VRFKIT_PIN.commit }, normalized };
  return { ...base, evidenceSha256: localEvidenceDigest(base) };
}

beforeEach(async () => {
  vi.resetModules(); tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-replay-intake-')); dbPath = path.join(tempDir, 'db.json'); replayDir = path.join(tempDir, 'private');
  for (const [key, value] of Object.entries({ NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath, REPLAY_STORAGE_DIR: replayDir, REPLAY_LEGACY_RAW_UPLOAD_ENABLED: 'true', REPLAY_DAILY_FILES: '1', VRFKIT_RETAINED_JOB_COUNT: '1', ADMIN_PASSWORD: adminKey, JWT_SECRET: jwtSecret, GOOGLE_CLIENT_ID: '' })) vi.stubEnv(key, value);
  await fs.writeFile(dbPath, JSON.stringify({
    settings: {}, matches: [], seasonArchives: [], rosterPlayers: [{ id: 'p1', displayName: 'Player One', retiredAt: null }],
    authKeys: [{ id: 'player-key', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), label: 'Player One', role: 'player', playerId: 'p1' }], allowedUsers: [],
  }));
  const { createApp } = await import('../server'); const app = await createApp(false);
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined; }
  vi.unstubAllEnvs(); vi.resetModules(); if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('private replay intake', () => {
  it('applies daily device bounds to local evidence and prunes retained completed evidence jobs', async () => {
    const coach = await login(adminKey);
    const first = await (await jsonRequest('/api/replay-intake/devices/enroll', coach, { name: 'Evidence PC 1' })).json();
    const second = await (await jsonRequest('/api/replay-intake/devices/enroll', coach, { name: 'Evidence PC 2' })).json();
    const submit = (device: any, sha: string) => fetch(`${origin}/api/replay-intake/evidence/${sha}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': device.device.id, 'X-Device-Token': device.credential.token }, body: JSON.stringify(evidenceEnvelope(sha, 100, device.device.id)) });
    expect((await submit(first, '1'.repeat(64))).status).toBe(201);
    expect((await submit(first, '2'.repeat(64))).status).toBe(429);
    expect((await submit(second, '3'.repeat(64))).status).toBe(201);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(Object.keys(stored.replayIntake.parserJobs)).toHaveLength(1);
    expect(Object.values(stored.replayIntake.parserJobs)[0]).toMatchObject({ sha256: '3'.repeat(64), status: 'completed' });
  });

  it('always generates valid alphabetic-prefixed IDs and uses them for repeated enrollments', async () => {
    const { replayIntakeInternals } = await import('../lib/routes/replayIntake');
    const receiptStore: any = { rawReceipts: { upload: { uploadId: 'upload', deviceId: 'device-a', response: { id: 'job-1', status: 'queued' }, createdAt: new Date().toISOString() } } };
    expect(replayIntakeInternals.priorRawFinalizeReceipt(receiptStore, 'upload', 'device-a')).toEqual({ ok: true, response: { id: 'job-1', status: 'queued' } });
    expect(replayIntakeInternals.priorRawFinalizeReceipt(receiptStore, 'upload', 'device-b')).toEqual({ ok: false });
    for (let index = 0; index < 2_048; index += 1) {
      const id = replayIntakeInternals.newDeviceId();
      expect(id).toMatch(replayIntakeInternals.DEVICE_ID);
      expect(id.startsWith('d_')).toBe(true);
    }
    const coach = await login(adminKey);
    for (let index = 0; index < 16; index += 1) {
      const response = await jsonRequest('/api/replay-intake/devices/enroll', coach, { name: `Coach PC ${index}` });
      expect(response.status).toBe(201);
      expect((await response.json()).device.id).toMatch(/^d_[A-Za-z0-9_-]{24}$/);
    }
  });

  it('binds a player enrollment to that player and never persists the raw credential', async () => {
    const player = await login(playerKey);
    const denied = await jsonRequest('/api/replay-intake/devices/enroll', player, { name: 'My PC', playerId: 'someone-else' }); expect(denied.status).toBe(403);
    const response = await jsonRequest('/api/replay-intake/devices/enroll', player, { name: 'My PC', playerId: 'p1' }); expect(response.status).toBe(201);
    const body = await response.json(); expect(body.credential.token).toHaveLength(43); expect(body.device.owner).toEqual({ role: 'player', playerId: 'p1' }); expect(JSON.stringify(body.device)).not.toContain('key:player-key');
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8')); const device = stored.replayIntake.devices[body.device.id];
    expect(device.tokenHash).toBe(crypto.createHash('sha256').update(body.credential.token).digest('hex')); expect(JSON.stringify(stored)).not.toContain(body.credential.token);
  });

  it('streams a verified replay to private hash storage, deduplicates it, and exposes no storage path', async () => {
    const coach = await login(adminKey); const enrollment = await (await jsonRequest('/api/replay-intake/devices/enroll', coach, { name: 'Coach PC', playerId: 'p1' })).json();
    const replay = Buffer.from('safe synthetic vrf test bytes'); const hash = crypto.createHash('sha256').update(replay).digest('hex');
    const headers = { 'Content-Type': 'application/vnd.valorant.replay', 'Content-Length': String(replay.length), 'X-Replay-Filename': 'match_1.vrf', 'X-Device-Id': enrollment.device.id, 'X-Device-Token': enrollment.credential.token };
    const first = await fetch(`${origin}/api/replay-intake/uploads/${hash}`, { method: 'PUT', headers, body: replay }); expect(first.status).toBe(201); const receipt = await first.json();
    expect(receipt).toMatchObject({ sha256: hash, size: replay.length, uploadStatus: 'stored-private', parserStatus: 'unavailable', reviewStatus: 'review-required' }); expect(receipt).not.toHaveProperty('path');
    expect(await fs.readFile(path.join(replayDir, hash.slice(0, 2), `${hash}.vrf`))).toEqual(replay);
    const duplicate = await fetch(`${origin}/api/replay-intake/uploads/${hash}`, { method: 'PUT', headers, body: replay }); expect(duplicate.status).toBe(200); expect((await duplicate.json()).idempotent).toBe(true);
    const listed = await (await jsonRequest('/api/replay-intake/uploads', coach)).json(); expect(listed).toHaveLength(1); expect(JSON.stringify(listed)).not.toContain(replayDir);
  });

  it('serializes concurrent duplicate uploads into one database record and one private file', async () => {
    const coach = await login(adminKey); const enrollment = await (await jsonRequest('/api/replay-intake/devices/enroll', coach, { name: 'Concurrent PC' })).json();
    const replay = Buffer.alloc(256 * 1024, 7); const hash = crypto.createHash('sha256').update(replay).digest('hex');
    const headers = { 'Content-Type': 'application/vnd.valorant.replay', 'Content-Length': String(replay.length), 'X-Replay-Filename': 'concurrent.vrf', 'X-Device-Id': enrollment.device.id, 'X-Device-Token': enrollment.credential.token };
    const responses = await Promise.all([1, 2].map(() => fetch(`${origin}/api/replay-intake/uploads/${hash}`, { method: 'PUT', headers, body: replay })));
    expect(responses.map(item => item.status).sort()).toEqual([200, 201]);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8')); expect(Object.keys(stored.replayIntake.blobs)).toEqual([hash]); expect(Object.keys(stored.replayIntake.associations)).toHaveLength(1);
    const files = await fs.readdir(path.join(replayDir, hash.slice(0, 2))); expect(files).toEqual([`${hash}.vrf`]);
  });

  it('blocks player devices from the explicitly gated legacy raw migration route', async () => {
    const player = await login(playerKey); const coach = await login(adminKey);
    const playerDevice = await (await jsonRequest('/api/replay-intake/devices/enroll', player, { name: 'Player PC', playerId: 'p1' })).json();
    const coachDevice = await (await jsonRequest('/api/replay-intake/devices/enroll', coach, { name: 'Coach PC' })).json();
    const replay = Buffer.from('same replay submitted by two devices'); const hash = crypto.createHash('sha256').update(replay).digest('hex');
    const send = (enrollment: any, filename: string) => fetch(`${origin}/api/replay-intake/uploads/${hash}`, { method: 'PUT', headers: { 'Content-Type': 'application/vnd.valorant.replay', 'Content-Length': String(replay.length), 'X-Replay-Filename': filename, 'X-Device-Id': enrollment.device.id, 'X-Device-Token': enrollment.credential.token }, body: replay });
    expect((await send(playerDevice, 'player-copy.vrf')).status).toBe(403);
    const secondResponse = await send(coachDevice, 'coach-copy.vrf'); const second = await secondResponse.json();
    expect(secondResponse.status).toBe(201); expect(second).toMatchObject({ deviceId: coachDevice.device.id, originalName: 'coach-copy.vrf' }); expect(second).not.toHaveProperty('owner');
    const playerList = await (await jsonRequest('/api/replay-intake/uploads', player)).json(); expect(playerList).toHaveLength(0);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8')); expect(Object.keys(stored.replayIntake.blobs)).toEqual([hash]); expect(Object.keys(stored.replayIntake.associations)).toHaveLength(1);
  });

  it('returns gone without reading legacy raw bytes when the migration gate is disabled', async () => {
    vi.stubEnv('REPLAY_LEGACY_RAW_UPLOAD_ENABLED', 'false');
    const replay = Buffer.from('must not be proxied'); const hash = crypto.createHash('sha256').update(replay).digest('hex');
    expect((await fetch(`${origin}/api/replay-intake/uploads/${hash}`, { method: 'PUT', headers: { 'Content-Type': 'application/vnd.valorant.replay', 'Content-Length': String(replay.length), 'X-Replay-Filename': 'match.vrf' }, body: replay })).status).toBe(410);
  });

  it('rejects wrong type, bad hash, unsafe names, and revoked credentials', async () => {
    const coach = await login(adminKey); const enrollment = await (await jsonRequest('/api/replay-intake/devices/enroll', coach, { name: 'Coach PC' })).json(); const replay = Buffer.from('test'); const hash = crypto.createHash('sha256').update(replay).digest('hex');
    const base = { 'Content-Length': String(replay.length), 'X-Device-Id': enrollment.device.id, 'X-Device-Token': enrollment.credential.token };
    expect((await fetch(`${origin}/api/replay-intake/uploads/${hash}`, { method: 'PUT', headers: { ...base, 'Content-Type': 'application/octet-stream', 'X-Replay-Filename': 'match.vrf' }, body: replay })).status).toBe(415);
    expect((await fetch(`${origin}/api/replay-intake/uploads/${'0'.repeat(64)}`, { method: 'PUT', headers: { ...base, 'Content-Type': 'application/vnd.valorant.replay', 'X-Replay-Filename': 'match.vrf' }, body: replay })).status).toBe(422);
    expect((await fetch(`${origin}/api/replay-intake/uploads/${hash}`, { method: 'PUT', headers: { ...base, 'Content-Type': 'application/vnd.valorant.replay', 'X-Replay-Filename': 'match.vrf' }, body: replay })).status).toBe(201);
    expect((await fetch(`${origin}/api/replay-intake/uploads/${hash}`, { method: 'PUT', headers: { ...base, 'Content-Type': 'application/vnd.valorant.replay', 'X-Replay-Filename': '../match.vrf' }, body: replay })).status).toBe(400);
    expect((await jsonRequest('/api/replay-intake/devices/revoke', coach, { deviceId: enrollment.device.id })).status).toBe(200);
    expect((await fetch(`${origin}/api/replay-intake/uploads/${hash}`, { method: 'PUT', headers: { ...base, 'Content-Type': 'application/vnd.valorant.replay', 'X-Replay-Filename': 'match.vrf' }, body: replay })).status).toBe(401);
  });

  it('never auto-parses an upload, limits parser triggers to coaches, and fails closed when the pin is not configured', async () => {
    const player = await login(playerKey); const coach = await login(adminKey);
    const enrollment = await (await jsonRequest('/api/replay-intake/devices/enroll', coach, { name: 'Parser PC' })).json();
    const replay = Buffer.from('parser gate fixture'); const hash = crypto.createHash('sha256').update(replay).digest('hex');
    const upload = await fetch(`${origin}/api/replay-intake/uploads/${hash}`, { method: 'PUT', headers: {
      'Content-Type': 'application/vnd.valorant.replay', 'Content-Length': String(replay.length), 'X-Replay-Filename': 'parser.vrf',
      'X-Device-Id': enrollment.device.id, 'X-Device-Token': enrollment.credential.token,
    }, body: replay });
    expect(upload.status).toBe(201); expect((await upload.json()).parserStatus).toBe('unavailable');
    expect((await jsonRequest(`/api/replay-intake/uploads/${hash}/parse`, player, {})).status).toBe(403);
    const unavailable = await jsonRequest(`/api/replay-intake/uploads/${hash}/parse`, coach, {});
    expect(unavailable.status).toBe(503); expect(await unavailable.json()).toMatchObject({ code: 'parser-unavailable' });
    const status = await jsonRequest(`/api/replay-intake/uploads/${hash}/parser`, coach);
    expect(status.status).toBe(200); expect(await status.json()).toMatchObject({ status: 'unavailable', reviewStatus: 'review-required' });
  });

  it('bounds global scheduling plus actor/device admission and prunes retained terminal evidence deterministically', async () => {
    const { replayIntakeInternals } = await import('../lib/routes/replayIntake');
    const job = (id: string, status: string, requestedBy = 'coach-a', sourceDeviceIds = ['device-a'], completedAt: string | null = null) => ({
      id, sha256: id.padEnd(64, '0'), requestedBy, sourceDeviceIds, status,
      createdAt: `2026-01-0${id === 'a' ? 1 : 2}T00:00:00.000Z`, startedAt: null, completedAt,
      parser: { name: 'vrfkit', version: '0.2.5' }, reviewStatus: 'review-required',
    });
    const store: any = { parserJobs: { a: job('a', 'queued'), b: job('b', 'queued', 'coach-b', ['device-b']) }, blobs: {
      [job('a', 'queued').sha256]: { parserJobId: 'a' }, [job('b', 'queued').sha256]: { parserJobId: 'b' },
    } };
    expect(replayIntakeInternals.nextParserJobs(store, new Set(), 1).map((item: any) => item.id)).toEqual(['a']);
    vi.stubEnv('VRFKIT_MAX_QUEUED_JOBS', '2');
    expect(replayIntakeInternals.parserAdmission(store, 'coach-c', ['device-c'])).toMatchObject({ ok: false, error: expect.stringContaining('queue') });
    vi.stubEnv('VRFKIT_MAX_QUEUED_JOBS', '8'); vi.stubEnv('VRFKIT_MAX_ACTOR_ACTIVE_JOBS', '1');
    expect(replayIntakeInternals.parserAdmission(store, 'coach-a', ['device-c'])).toMatchObject({ ok: false, error: expect.stringContaining('coach') });
    vi.stubEnv('VRFKIT_MAX_ACTOR_ACTIVE_JOBS', '8'); vi.stubEnv('VRFKIT_MAX_DEVICE_ACTIVE_JOBS', '1');
    expect(replayIntakeInternals.parserAdmission(store, 'coach-c', ['device-a'])).toMatchObject({ ok: false, error: expect.stringContaining('device') });

    store.parserJobs.a = job('a', 'completed', 'coach-a', ['device-a'], '2026-01-01T00:00:00.000Z');
    store.parserJobs.b = job('b', 'completed', 'coach-b', ['device-b'], '2026-01-02T00:00:00.000Z');
    vi.stubEnv('VRFKIT_RETAINED_JOB_COUNT', '1'); vi.stubEnv('VRFKIT_JOB_RETENTION_MS', String(180 * 24 * 60 * 60 * 1000));
    replayIntakeInternals.pruneParserJobs(store, Date.parse('2026-01-03T00:00:00.000Z'));
    expect(Object.keys(store.parserJobs)).toEqual(['b']);
    expect(store.blobs[job('a', 'queued').sha256].parserJobId).toBeNull();
  });
});

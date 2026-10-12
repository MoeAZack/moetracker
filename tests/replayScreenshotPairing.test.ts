import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildScreenshotReviewDraft } from '../lib/entryEngine';
import { pairReplayScreenshots, screenshotAdmission, validatePairingImage } from '../lib/replayScreenshotPairing';
import { localEvidenceDigest } from '../lib/replayEvidence';
import { VRFKIT_PIN } from '../lib/vrfkitReplayPipeline';

const mocked = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('../lib/clients', () => ({ ai: { models: { generateContent: mocked.generate } } }));
const hash = 'a'.repeat(64);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]).toString('base64');
const raw = () => ({ map: 'Haven', ourScore: 13, theirScore: 9, confident: false, players: Array.from({ length: 10 }, (_, i) => ({ name: `Screenshot player ${i}`, agent: 'Cypher', kills: 10 + i, deaths: i, assists: 3 + i })) });
const available = (value: string | number) => ({ value, status: 'available', source: 'synthetic fixture', confidence: 1 });
function board() { return { reviewRequired: true, evidenceCoverage: { status: 'complete', reason: null }, map: available('Haven'), durationMs: available(1000), finalScore: { teamA: { teamId: 'red', score: available(9) }, teamB: { teamId: 'blue', score: available(13) } }, players: raw().players.map((p, i) => ({ playerId: `parser-${i}`, teamId: i < 5 ? 'red' : 'blue', displayName: { value: null, status: 'unavailable', source: 'fixture', confidence: null }, kills: available(p.kills), deaths: available(p.deaths), assists: available(p.assists), firstBloods: available(0), firstDeaths: available(0), plants: available(0), defuses: available(0) })), unavailableFields: [] }; }
function storeFixture() {
  return { screenshots: { screenshot: { id: 'screenshot', deviceId: 'device-12345678', createdBy: 'coach', imageSha256: 'c'.repeat(64), createdAt: new Date().toISOString(), status: 'pending', reviewRequired: true, draft: buildScreenshotReviewDraft(raw(), { model: 'mock', capturedAt: new Date().toISOString(), rosterPlayers: [] }), replaySha256: null, suggestions: [], reason: '' } }, associations: { first: { deviceId: 'device-12345678', sha256: hash } }, blobs: { [hash]: { ingestionMode: 'local-evidence', parserJobId: 'job' } }, parserJobs: { job: { status: 'completed', sourceDeviceIds: ['device-12345678'], result: { scoreboard: board() } } } } as any;
}

describe('strict screenshot pairing', () => {
  it('links one complete exact match without changing raw evidence or selecting roster identities', () => {
    const store = storeFixture(); const before = structuredClone(store.parserJobs); pairReplayScreenshots(store);
    expect(store.screenshots.screenshot).toMatchObject({ status: 'linked', replaySha256: hash, reviewRequired: true });
    expect(store.screenshots.screenshot.suggestions).toHaveLength(10);
    expect(store.screenshots.screenshot.suggestions[0]).toEqual({ parserPlayerId: 'parser-0', displayName: 'Screenshot player 0', rosterPlayerId: null });
    expect(store.parserJobs).toEqual(before);
  });
  it.each([[12, 12], [14, 10], [18, 12]])('pairs a fixed-round practice ending %i–%i without a first-to-13 assumption', (ours, theirs) => {
    const store = storeFixture(); store.screenshots.screenshot.draft.match.ourScore = ours; store.screenshots.screenshot.draft.match.theirScore = theirs;
    store.parserJobs.job.result.scoreboard.finalScore.teamA.score.value = ours; store.parserJobs.job.result.scoreboard.finalScore.teamB.score.value = theirs;
    store.parserJobs.job.result.reviewDraft = { rounds: Array.from({ length: ours + theirs }, (_, i) => ({ roundNumber: i + 1 })) };
    pairReplayScreenshots(store); expect(store.screenshots.screenshot.status).toBe('linked'); expect(store.parserJobs.job.result.reviewDraft.rounds).toHaveLength(ours + theirs);
  });
  it('refuses multiple matching replays and removes a previously unique suggestion when ambiguity arrives', () => {
    const store = storeFixture(); pairReplayScreenshots(store);
    store.associations.second = { deviceId: 'device-12345678', sha256: 'b'.repeat(64) }; store.blobs['b'.repeat(64)] = { ingestionMode: 'local-evidence', parserJobId: 'second' }; store.parserJobs.second = structuredClone(store.parserJobs.job);
    pairReplayScreenshots(store); expect(store.screenshots.screenshot).toMatchObject({ status: 'ambiguous', suggestions: [], replaySha256: null });
  });
  it.each(['device', 'map', 'score', 'row', 'incomplete', 'raw-mode'])('does not pair a wrong %s', mismatch => {
    const store = storeFixture(); const b = store.parserJobs.job.result.scoreboard;
    if (mismatch === 'device') store.associations.first.deviceId = 'another-device';
    if (mismatch === 'map') b.map.value = 'Ascent';
    if (mismatch === 'score') b.finalScore.teamA.score.value = 10;
    if (mismatch === 'row') b.players[0].kills.value++;
    if (mismatch === 'incomplete') b.players[0].kills.status = 'unavailable';
    if (mismatch === 'raw-mode') store.blobs[hash].ingestionMode = 'coach-raw';
    pairReplayScreenshots(store); expect(store.screenshots.screenshot).toMatchObject({ status: 'pending', suggestions: [] });
  });
  it('rejects duplicate KDA and missing rows instead of assigning names by position', () => {
    const store = storeFixture(); store.screenshots.screenshot.draft.stats[1] = { ...store.screenshots.screenshot.draft.stats[0], extractedName: 'Different name' };
    pairReplayScreenshots(store); expect(store.screenshots.screenshot.status).toBe('ambiguous');
    store.screenshots.screenshot.draft.stats.pop(); pairReplayScreenshots(store); expect(store.screenshots.screenshot.status).toBe('incomplete');
  });
  it('marks conflicting name extractions ambiguous without mutating accepted overlays', () => {
    const store = storeFixture(); store.screenshots.other = structuredClone(store.screenshots.screenshot); store.screenshots.other.id = 'other'; store.screenshots.other.draft.stats[0].extractedName = 'Other';
    store.reviews = { [hash]: { status: 'accepted', mappings: [{ displayName: 'Coach confirmed' }] } }; const accepted = structuredClone(store.reviews);
    pairReplayScreenshots(store); expect(Object.values(store.screenshots).every((item: any) => item.status === 'ambiguous' && !item.suggestions.length)).toBe(true); expect(store.reviews).toEqual(accepted);
  });
  it('bounds image and record admission', () => {
    expect(() => validatePairingImage({ deviceId: 'device-12345678', mediaType: 'image/png', base64: Buffer.from('not an image').toString('base64') })).toThrow();
    expect(() => validatePairingImage({ deviceId: 'device-12345678', mediaType: 'image/png', base64: 'a'.repeat(7_000_000) })).toThrow();
    const record = storeFixture().screenshots.screenshot;
    expect(() => screenshotAdmission({ screenshots: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, record])) }, record.deviceId, 'coach')).toThrow(/capacity/);
  });
});

let temporary: string; let dbPath: string; let server: Server | undefined; let origin: string;
const admin = 'screenshot-admin-secret-at-least-24-characters';
async function request(route: string, token?: string, body?: any) { return fetch(`${origin}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
async function login(key = admin) { const response = await request('/api/login-key', undefined, { key }); expect(response.status).toBe(200); return (await response.json()).key; }
function envelope(deviceId: string) {
  const normalized: any = { schemaVersion: 1, scoreboard: board(), parserInput: { parser: { name: 'vrfkit', version: VRFKIT_PIN.version }, provenance: { replaySha256: hash }, file: { format: 'vrf', support: 'supported' }, identities: board().players.map(p => ({ playerId: p.playerId, teamId: p.teamId })), summary: { roundCount: 22, finalScore: { teamA: 9, teamB: 13 }, players: [] }, rounds: [], capabilities: [] }, diagnostics: { replaySha256: hash, binarySha256: VRFKIT_PIN.windowsX64ExeSha256, binaryVersion: VRFKIT_PIN.version, binaryCommit: VRFKIT_PIN.commit, manifestSha256: 'f'.repeat(64), replayBuild: null, outputFileCount: 1, outputBytes: 1, identityMappingComplete: true, duplicateActorMappings: 0, duplicatePawnMappings: 0 } };
  const base: any = { schemaVersion: 1, source: { sha256: hash, size: 100, originalName: 'fixture.vrf', deviceId }, parser: { name: 'vrfkit', version: VRFKIT_PIN.version, binarySha256: VRFKIT_PIN.windowsX64ExeSha256, binaryCommit: VRFKIT_PIN.commit }, normalized };
  return { ...base, evidenceSha256: localEvidenceDigest(base) };
}
describe('screenshot-first authenticated workflow', () => {
  beforeEach(async () => {
    vi.resetModules(); temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-pairing-')); dbPath = path.join(temporary, 'db.json');
    for (const [key, value] of Object.entries({ NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath, REPLAY_STORAGE_DIR: path.join(temporary, 'private'), ADMIN_PASSWORD: admin, JWT_SECRET: 'screenshot-session-secret-at-least-24-characters', GOOGLE_CLIENT_ID: '', REPLAY_GCS_RAW_ENABLED: 'false' })) vi.stubEnv(key, value);
    await fs.writeFile(dbPath, JSON.stringify({ settings: { players: [] }, matches: [], seasonArchives: [], rosterPlayers: [{ id: 'p1', displayName: 'Player' }], authKeys: [{ id: 'player-key', keyHash: crypto.createHash('sha256').update('player-key').digest('hex'), label: 'Player', role: 'player', playerId: 'p1' }], allowedUsers: [] }));
    mocked.generate.mockReset(); mocked.generate.mockResolvedValue({ text: JSON.stringify({ ...raw(), base64: png, players: raw().players.map(p => ({ ...p, rawMetrics: { base64: png } })) }) });
    const { createApp } = await import('../server'); const app = await createApp(false); server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; } vi.unstubAllEnvs(); vi.resetModules(); await fs.rm(temporary, { recursive: true, force: true }); });
  it.each([true, false])('pairs screenshot with %s future evidence via the ordinary device endpoint, retains no image, and deduplicates', async future => {
    const coach = await login(); const device = await (await request('/api/replay-intake/devices/enroll', coach, { name: 'Fixture PC' })).json();
    const submitEvidence = () => fetch(`${origin}/api/replay-intake/evidence/${hash}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': device.device.id, 'X-Device-Token': device.credential.token }, body: JSON.stringify(envelope(device.device.id)) });
    if (!future) expect((await submitEvidence()).status).toBe(201);
    const body = { deviceId: device.device.id, base64: png, mediaType: 'image/png' };
    const response = await request('/api/replay-intake/screenshots', coach, body); expect(response.status).toBe(201); expect((await response.json()).status).toBe(future ? 'pending' : 'linked');
    if (future) expect((await submitEvidence()).status).toBe(201);
    const pairs = await (await request('/api/replay-intake/screenshots', coach)).json(); expect(pairs).toHaveLength(1); expect(pairs[0]).toMatchObject({ status: 'linked', replaySha256: hash, reviewRequired: true }); expect(pairs[0].suggestions).toHaveLength(10); expect(pairs[0]).not.toHaveProperty('createdBy');
    const before = await fs.readFile(dbPath, 'utf8'); expect(before).not.toContain(png); expect(before).not.toContain('rawMetrics'); expect(before).not.toContain('"base64"');
    expect((await request('/api/replay-intake/screenshots', coach, body)).status).toBe(200); expect(mocked.generate).toHaveBeenCalledTimes(1);
    const detail = await (await request(`/api/replay-intake/uploads/${hash}/parser`, coach)).json(); expect(detail.screenshotPairings).toHaveLength(1); expect(detail.review).toBeNull();
    if (future) {
      const { readDB, saveDB } = await import('../lib/store'); const db = await readDB();
      db.matches = [{ id: 'paired-match', date: '2026-10-12', map: 'Haven', opponent: 'Match-scoped opponent', type: 'Scrim' }];
      db.rosterPlayers.push(...Array.from({ length: 5 }, (_, i) => ({ id: `roster-${i + 5}`, displayName: `Roster ${i + 5}` })));
      await saveDB(db);
      const mappings = pairs[0].suggestions.map((row: any) => ({ ...row, rosterPlayerId: Number(row.parserPlayerId.split('-')[1]) >= 5 ? `roster-${row.parserPlayerId.split('-')[1]}` : null }));
      const review = await request(`/api/replay-intake/uploads/${hash}/review`, coach, { expectedRevision: 0, requestId: 'pair-review', matchId: 'paired-match', teamId: 'blue', mappings }); expect(review.status).toBe(200);
      const acceptance = { expectedRevision: 1, requestId: 'pair-accept', confirmed: true };
      expect((await request(`/api/replay-intake/uploads/${hash}/accept`, coach, acceptance)).status).toBe(200);
      const accepted = await readDB(); expect(accepted.playerStats).toHaveLength(5); expect(accepted.engineAdapters.replay['paired-match'].provenance.screenshotLinks).toEqual([{ id: pairs[0].id, imageSha256: pairs[0].imageSha256, replaySha256: hash }]);
      expect((await request(`/api/replay-intake/uploads/${hash}/accept`, coach, acceptance)).status).toBe(200); expect((await readDB()).playerStats).toEqual(accepted.playerStats);
    }
    const player = await login('player-key'); expect((await request('/api/replay-intake/screenshots', player)).status).toBe(403); expect((await request('/api/replay-intake/screenshots', player, body)).status).toBe(403);
    const publicData = await (await request('/api/data', coach)).json(); expect(publicData).not.toHaveProperty('replayIntake');
  });
  it('rejects unknown/revoked devices before OCR and rejects malformed extraction without persisting', async () => {
    const coach = await login(); const body = { deviceId: 'unknown-device', base64: png, mediaType: 'image/png' }; expect((await request('/api/replay-intake/screenshots', coach, body)).status).toBe(409); expect(mocked.generate).not.toHaveBeenCalled();
    const device = await (await request('/api/replay-intake/devices/enroll', coach, { name: 'Fixture PC' })).json(); mocked.generate.mockResolvedValue({ text: JSON.stringify({ players: [{ name: 'X', kills: -1 }] }) });
    expect((await request('/api/replay-intake/screenshots', coach, { ...body, deviceId: device.device.id })).status).toBe(422); expect(await (await request('/api/replay-intake/screenshots', coach)).json()).toEqual([]);
    await request('/api/replay-intake/devices/revoke', coach, { deviceId: device.device.id });
    expect((await request('/api/replay-intake/screenshots', coach, { ...body, deviceId: device.device.id })).status).toBe(409);
  });
  it('accepts a sanitized browser-local OCR draft without uploading image bytes or calling Gemini', async () => {
    const coach = await login(); const device = await (await request('/api/replay-intake/devices/enroll', coach, { name: 'Local OCR PC' })).json();
    const response = await request('/api/replay-intake/screenshots/local', coach, { deviceId: device.device.id, imageSha256: 'd'.repeat(64), capturedAt: '2026-10-12T20:00:00.000Z', extraction: raw() });
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ deviceId: device.device.id, imageSha256: 'd'.repeat(64), status: 'pending' });
    expect(mocked.generate).not.toHaveBeenCalled();
    const persisted = await fs.readFile(dbPath, 'utf8'); expect(persisted).not.toContain(png); expect(persisted).toContain('tesseract-local');
    const unsafe = raw() as any; unsafe.players[0].rawMetrics = { base64: 'PRIVATE_IMAGE_PAYLOAD' };
    expect((await request('/api/replay-intake/screenshots/local', coach, { deviceId: device.device.id, imageSha256: 'e'.repeat(64), capturedAt: '2026-10-12T20:00:00.000Z', extraction: unsafe })).status).toBe(400);
    expect(await fs.readFile(dbPath, 'utf8')).not.toContain('PRIVATE_IMAGE_PAYLOAD');
  });
});

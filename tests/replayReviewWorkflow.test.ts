import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminKey = 'review-admin-secret-at-least-24-characters';
const playerKey = 'review-player-secret';
const sha256 = 'a'.repeat(64);
let tempDir: string; let dbPath: string; let server: Server | undefined; let origin: string;

const value = (entry: number | string) => ({ value: entry, status: 'available', source: 'synthetic-redacted-fixture', confidence: 1 });
const players = [
  { playerId: 'raw-a', teamId: 'team-us', displayName: value('Player A'), kills: value(2), deaths: value(0), assists: value(1), firstBloods: value(1), firstDeaths: value(0), plants: value(1), defuses: value(0) },
  { playerId: 'raw-b', teamId: 'team-us', displayName: value('Player B'), kills: value(1), deaths: value(1), assists: value(2), firstBloods: value(0), firstDeaths: value(1), plants: value(0), defuses: value(1) },
  { playerId: 'raw-x', teamId: 'team-them', displayName: value('Opponent X'), kills: value(1), deaths: value(2), assists: value(0), firstBloods: value(0), firstDeaths: value(1), plants: value(0), defuses: value(0) },
  { playerId: 'raw-y', teamId: 'team-them', displayName: value('Opponent Y'), kills: value(0), deaths: value(1), assists: value(0), firstBloods: value(0), firstDeaths: value(0), plants: value(0), defuses: value(0) },
];
const reviewDraft = {
  contractVersion: 1, status: 'review-required', reviewRequired: true, writable: false,
  parser: { name: 'vrfkit', version: '0.2.5' }, provenance: { replaySha256: sha256 }, file: { format: 'vrf', support: 'supported' }, crossChecks: [],
  rounds: [{ roundNumber: 1, status: 'resolved', firstKillPlayerId: 'raw-a', firstDeathPlayerId: 'raw-x', sourceEventId: 'e1', reason: null, excludedEventCount: 0 }],
  coverage: { playedRounds: 1, resolvedRounds: 1, unknownRounds: 0, resolvedPercent: 100, unknownReasons: {} },
  playerTotals: players.map(item => ({ playerId: item.playerId, observedFirstKills: evidence(item.firstBloods), observedFirstDeaths: evidence(item.firstDeaths), firstKills: evidence(item.firstBloods), firstDeaths: evidence(item.firstDeaths) })),
  evidence: { tradeWindowMs: 5000, capabilities: [], observations: [], observationIssues: [], coverageBySignal: [], playerMetrics: players.map(item => ({ playerId: item.playerId, kills: evidence(item.kills), deaths: evidence(item.deaths), assists: evidence(item.assists), damage: item.teamId === 'team-us' ? 250 : 100, utilityCasts: null, utilityEffects: null, ultimateUses: null, plants: evidence(item.plants), defuses: evidence(item.defuses) })), rounds: [{ roundNumber: 1, events: [], winnerTeamId: 'team-us', endReason: 'elimination', sideByTeam: { 'team-us': 'attack', 'team-them': 'defense' }, derived: { tradeOpportunities: 1, successfulTrades: 1, tradedDeathPlayerIds: ['raw-b'], multikills: [{ playerId: 'raw-a', kills: 2 }], clutches: [] } }] },
};
function evidence(field: any) { return field.status === 'available' ? field.value : null; }
const parserResult = { scoreboard: { reviewRequired: true, evidenceCoverage: { status: 'complete', reason: null }, map: value('Haven'), durationMs: value(120000), finalScore: { teamA: { teamId: 'team-us', score: value(1) }, teamB: { teamId: 'team-them', score: value(0) } }, players, unavailableFields: [] }, reviewDraft, diagnostics: { replaySha256: sha256, binarySha256: 'b'.repeat(64), binaryVersion: '0.2.5', binaryCommit: 'redacted', manifestSha256: 'c'.repeat(64), replayBuild: 'fixture', outputFileCount: 1, outputBytes: 1, identityMappingComplete: true, duplicateActorMappings: 0, duplicatePawnMappings: 0 } };
const formula = { version: 'shadow/replay-fixture-v1', weights: { killsPerRound: .25, deathsPerRound: .2, assistsPerRound: .1, averageDamagePerRound: .15, kastRate: .15, firstKillsPerRound: .1, firstDeathsPerRound: .05 }, thresholds: { minimumCoverage: .5, minimumMatches: 1, minimumRounds: 1, minimumMetricSamples: 1, minimumBaselineRounds: 1 }, zCap: 3, center: 1, scale: .15, bounds: { minimum: 0, maximum: 2 } };
const baseline = { id: 'replay-fixture', version: 'baseline/replay-fixture-v1', mode: 'scrim', source: { id: 'replay', version: '1' }, metrics: Object.fromEntries(Object.keys(formula.weights).map(key => [key, { median: key === 'averageDamagePerRound' ? 130 : .5, mad: key === 'averageDamagePerRound' ? 10 : .1, rounds: 10 }])) };

async function request(route: string, token?: string, body?: unknown) { return fetch(`${origin}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
async function login(key: string) { const response = await request('/api/login-key', undefined, { key }); expect(response.status).toBe(200); return (await response.json()).key as string; }
const mappings = [
  { parserPlayerId: 'raw-a', rosterPlayerId: 'p1', displayName: 'Reviewed Alpha' }, { parserPlayerId: 'raw-b', rosterPlayerId: 'p2', displayName: 'Reviewed Bravo' },
  { parserPlayerId: 'raw-x', rosterPlayerId: null, displayName: 'Opponent X' }, { parserPlayerId: 'raw-y', rosterPlayerId: null, displayName: 'Opponent Y' },
];

beforeEach(async () => {
  vi.resetModules(); tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-replay-review-')); dbPath = path.join(tempDir, 'db.json');
  for (const [key, entry] of Object.entries({ NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath, REPLAY_STORAGE_DIR: path.join(tempDir, 'private'), ADMIN_PASSWORD: adminKey, JWT_SECRET: 'review-session-secret-at-least-24-characters', GOOGLE_CLIENT_ID: '' })) vi.stubEnv(key, entry);
  await fs.writeFile(dbPath, JSON.stringify({
    settings: {}, matches: [{ id: 'm1', date: '2026-10-03', type: 'Scrim', opponent: 'Redacted', map: 'Haven', rosterContext: { kind: 'core' } }], playerStats: [], seasonArchives: [],
    rosterPlayers: [{ id: 'p1', displayName: 'Alpha', retiredAt: null }, { id: 'p2', displayName: 'Bravo', retiredAt: null }], coreMemberships: [{ id: 'c1', playerId: 'p1', joinedAt: '2026-01-01' }, { id: 'c2', playerId: 'p2', joinedAt: '2026-01-01' }],
    authKeys: [{ id: 'player-key', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), label: 'Alpha', role: 'player', playerId: 'p1' }], allowedUsers: [],
    replayIntake: { schemaVersion: 4, devices: { d_fixture01: { id: 'd_fixture01', name: 'Fixture PC', tokenHash: 'redacted', credentialVersion: 1, owner: { actorId: 'key:admin', role: 'coach', playerId: null }, createdAt: '2026-10-03T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', revokedAt: null, lastSeenAt: null } }, blobs: { [sha256]: { sha256, size: 100, storedAt: '2026-10-03T00:00:00.000Z', parserStatus: 'parsed-review-required', parserJobId: 'job1', reviewStatus: 'review-required', matchId: null } }, associations: { receipt: { id: 'receipt', sha256, size: 100, originalName: 'redacted-fixture.vrf', deviceId: 'd_fixture01', owner: { actorId: 'key:admin', role: 'coach', playerId: null }, receivedAt: '2026-10-03T00:00:00.000Z' } }, parserJobs: { job1: { id: 'job1', sha256, requestedBy: 'key:admin', sourceDeviceIds: ['d_fixture01'], status: 'completed', createdAt: '2026-10-03T00:00:00.000Z', startedAt: '2026-10-03T00:00:01.000Z', completedAt: '2026-10-03T00:00:02.000Z', parser: { name: 'vrfkit', version: '0.2.5' }, reviewStatus: 'review-required', result: parserResult } }, reviews: {} },
    engineAdapters: { schemaVersion: 1, idempotency: {}, replay: {}, ratings: { configs: { config: { key: `${formula.version}:${baseline.id}:${baseline.version}`, calibrationStatus: 'uncalibrated', formula, baseline } }, records: {}, formulaVersions: {}, baselineVersions: {} }, ranked: { providers: {}, accounts: {}, consents: {}, states: {} } },
  }));
  const { createApp } = await import('../server'); const app = await createApp(false); server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined; } vi.unstubAllEnvs(); vi.resetModules(); if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }); });

describe('coach replay review workflow', () => {
  it('enforces coach ownership, explicit complete mappings, collision checks and stale revisions', async () => {
    const coach = await login(adminKey); const player = await login(playerKey);
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, player, { expectedRevision: 0, requestId: 'player-attempt', matchId: 'm1', teamId: 'team-us', mappings })).status).toBe(403);
    expect((await request(`/api/replay-intake/uploads/${sha256}/parser`, player)).status).toBe(404);
    const collision = mappings.map(item => item.parserPlayerId === 'raw-b' ? { ...item, rosterPlayerId: 'p1' } : item);
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'collision', matchId: 'm1', teamId: 'team-us', mappings: collision })).status).toBe(409);
    const unknown = mappings.map(item => item.parserPlayerId === 'raw-b' ? { ...item, rosterPlayerId: 'missing' } : item);
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'unknown', matchId: 'm1', teamId: 'team-us', mappings: unknown })).status).toBe(409);
    const saved = await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'save-1', matchId: 'm1', teamId: 'team-us', mappings }); expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ revision: 1, status: 'review-required', mappings });
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'stale', matchId: 'm1', teamId: 'team-us', mappings })).status).toBe(409);
  });

  it('accepts only an explicit current revision, preserves raw evidence and hands canonical facts to analytics plus review-only ratings', async () => {
    const coach = await login(adminKey); const rawBefore = JSON.parse(await fs.readFile(dbPath, 'utf8')).replayIntake.parserJobs.job1.result;
    await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'save-1', matchId: 'm1', teamId: 'team-us', mappings });
    expect((await request(`/api/replay-intake/uploads/${sha256}/accept`, coach, { expectedRevision: 1, requestId: 'no-confirm', confirmed: false })).status).toBe(400);
    const acceptBody = { expectedRevision: 1, requestId: 'accept-1', confirmed: true }; const accepted = await request(`/api/replay-intake/uploads/${sha256}/accept`, coach, acceptBody); expect(accepted.status).toBe(200); expect(await accepted.json()).toMatchObject({ revision: 2, status: 'accepted', ratingDraftKeys: expect.any(Array) });
    const retry = await request(`/api/replay-intake/uploads/${sha256}/accept`, coach, acceptBody); expect(retry.status).toBe(200); expect((await retry.json()).revision).toBe(2);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8')); expect(stored.replayIntake.parserJobs.job1.result).toEqual(rawBefore); expect(stored.replayIntake.reviews[sha256].mappings).toEqual(mappings);
    expect(stored.matches[0]).toMatchObject({ id: 'm1', map: 'Haven', ourScore: 1, theirScore: 0, sourceMetadata: { provider: 'vrfkit', externalId: sha256 } });
    expect(stored.playerStats).toEqual(expect.arrayContaining([expect.objectContaining({ matchId: 'm1', playerId: 'p1', player: 'Reviewed Alpha', kills: 2, deaths: 0, fk: 1 }), expect.objectContaining({ matchId: 'm1', playerId: 'p2', player: 'Reviewed Bravo', kills: 1, defuses: 1 })]));
    expect(stored.engineAdapters.replay.m1).toMatchObject({ status: 'accepted', provenance: { replaySha256: sha256 } });
    const ratingRecords = Object.values(stored.engineAdapters.ratings.records) as any[]; expect(ratingRecords).toHaveLength(2); expect(ratingRecords.every(record => record.status === 'review-required' && record.acceptedAt === null && record.provenance.replaySha256 === sha256)).toBe(true);
  });
});

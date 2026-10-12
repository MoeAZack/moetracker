import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminKey = 'adapter-admin-secret-at-least-24-characters';
const jwtSecret = 'adapter-session-secret-at-least-24-characters';
const playerKey = 'adapter-player-key';
let tempDir = ''; let dbPath = ''; let server: Server | undefined; let origin = '';

async function call(route: string, token?: string, body?: any) {
  return fetch(`${origin}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(key: string) { const response = await call('/api/login-key', undefined, { key }); return (await response.json()).key; }

beforeEach(async () => {
  vi.resetModules(); tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-adapters-')); dbPath = path.join(tempDir, 'db.json');
  for (const [key, value] of Object.entries({ NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath, ADMIN_PASSWORD: adminKey, JWT_SECRET: jwtSecret, GOOGLE_CLIENT_ID: '' })) vi.stubEnv(key, value);
  await fs.writeFile(dbPath, JSON.stringify({ settings: {}, matches: [], seasonArchives: [], vodReviews: [], authKeys: [{ id: 'player-key', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), label: 'Alpha', role: 'player', playerId: 'p1' }], allowedUsers: [] }));
  const { createApp } = await import('../server'); const app = await createApp(false);
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); } vi.unstubAllEnvs(); vi.resetModules(); if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }); });

const identities = [{ playerId: 'p1', teamId: 'a' }, { playerId: 'p2', teamId: 'b' }];
const parserInput = {
  parser: { name: 'test-parser', version: '1.0' }, provenance: { fileSha256: 'private-hash', localPath: 'private-path' },
  file: { format: 'test', support: 'supported' }, identities,
  summary: { map: 'Ascent', finalScore: { teamA: 1, teamB: 0 }, roundCount: 1, players: [{ playerId: 'p1', kills: 1, deaths: 0 }, { playerId: 'p2', kills: 0, deaths: 1 }] },
  capabilities: [{ signal: 'eliminations', support: 'complete', grade: 'event-log', coveredRoundNumbers: [1] }],
  rounds: [{ roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: ['p1', 'p2'], participantCoverage: { status: 'complete', expectedPlayerCount: 2 }, winnerTeamId: 'a', events: [{ eventId: 'private-event', roundNumber: 1, sequence: 1, timestampMs: 100, kind: 'player-elimination', killerPlayerId: 'p1', victimPlayerId: 'p2', killerTeamId: 'a', victimTeamId: 'b', identityStatus: 'resolved' }] }],
} as const;

const formula = { version: 'shadow/v1', weights: { killsPerRound: .25, deathsPerRound: .2, assistsPerRound: .1, averageDamagePerRound: .15, kastRate: .15, firstKillsPerRound: .1, firstDeathsPerRound: .05 }, thresholds: { minimumCoverage: .75, minimumMatches: 1, minimumRounds: 1, minimumMetricSamples: 1, minimumBaselineRounds: 1 }, zCap: 3, center: 1, scale: .15, bounds: { minimum: 0, maximum: 2 } };
const ratingInput = { context: { playerId: 'p1', displayName: 'Alpha', mode: 'scrim', source: { id: 'replay', version: '1' }, appearance: 'core', rosterKind: 'core', tryoutBatchId: null, matchIds: ['m1'], rounds: 1, maps: ['Ascent'], agents: ['Sova'], roles: ['initiator'] }, metrics: { killsPerRound: { value: 1, samples: 1 }, deathsPerRound: { value: 0, samples: 1 }, assistsPerRound: { value: 0, samples: 1 }, averageDamagePerRound: { value: 150, samples: 1 }, kastRate: { value: 1, samples: 1 }, firstKillsPerRound: { value: 1, samples: 1 }, firstDeathsPerRound: { value: 0, samples: 1 } } };
const baseline = { id: 'b', version: '1', mode: 'scrim', source: { id: 'replay', version: '1' }, metrics: Object.fromEntries(Object.keys(ratingInput.metrics).map(key => [key, { median: key === 'averageDamagePerRound' ? 130 : .5, mad: key === 'averageDamagePerRound' ? 10 : .1, rounds: 10 }])) };

describe('persisted engine adapter HTTP boundary', () => {
  it('requires coach review transitions, recomputes ratings, redacts player payloads, and rejects stale writes', async () => {
    const coach = await login(adminKey); const player = await login(playerKey);
    expect((await call('/api/engine-adapters/replay/draft', player, {})).status).toBe(403);
    const draftResponse = await call('/api/engine-adapters/replay/draft', coach, { matchId: 'm1', expectedRevision: 0, requestId: 'replay-draft-1', parserInput });
    expect(draftResponse.status).toBe(200); const draft = await draftResponse.json(); expect(draft).toMatchObject({ status: 'review-required', revision: 1, draft: { writable: false, reviewRequired: true } });
    expect((await call('/api/engine-adapters/replay/draft', coach, { matchId: 'm1', expectedRevision: 0, requestId: 'replay-draft-1', parserInput })).status).toBe(200);
    expect((await call('/api/engine-adapters/replay/draft', coach, { matchId: 'm1', expectedRevision: 0, requestId: 'replay-draft-1', parserInput: { ...parserInput, provenance: { fileSha256: 'different' } } })).status).toBe(409);
    expect((await call('/api/engine-adapters/replay/draft', coach, { matchId: 'm1', expectedRevision: 0, requestId: 'different', parserInput })).status).toBe(409);
    expect((await call('/api/engine-adapters/replay/accept', coach, { matchId: 'm1', expectedRevision: 1, requestId: 'accept-1' })).status).toBe(200);

    const configKey = 'shadow/v1:b:1';
    expect((await call('/api/engine-adapters/ratings/config', coach, { expectedRevision: 0, requestId: 'config-1', formula, baseline, validationInput: ratingInput })).status).toBe(200);
    const computed = await (await call('/api/engine-adapters/ratings/recompute', coach, { expectedRevision: 0, requestId: 'rating-1', configKey, input: { ...ratingInput, clientScore: 999 } })).json();
    expect(computed.result.calculation.authoritativeScore).toBeNull(); expect(computed.result.calculation.shadowScore).not.toBe(999);
    expect(await fs.readFile(dbPath, 'utf8')).not.toContain('clientScore');
    expect((await call('/api/engine-adapters/ratings/accept', coach, { expectedRevision: 1, requestId: 'rating-accept', recordKey: computed.recordKey })).status).toBe(200);

    const safe = await (await call('/api/engine-adapters', player)).json(); const serialized = JSON.stringify(safe);
    expect(safe.replay[0]).toMatchObject({ status: 'accepted', matchId: 'm1' }); expect(safe.ratings[0].authoritativeScore).toBeNull();
    expect(serialized).not.toContain('private-hash'); expect(serialized).not.toContain('private-event'); expect(serialized).not.toContain('clientScore');
  });

  it('binds player consent to coach-confirmed identity and keeps provider activation disabled', async () => {
    const coach = await login(adminKey); const player = await login(playerKey);
    const provider = { providerId: 'official', approvedStatus: 'pending', configured: false, documentedEndpointFamily: null, sourceSchemaVersion: null, termsPolicyVersion: null, quota: null };
    expect((await call('/api/engine-adapters/ranked/provider', coach, { expectedRevision: 0, requestId: 'provider-1', provider })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/account', coach, { expectedRevision: 0, requestId: 'account-1', playerId: 'p1', providerId: 'official', account: { providerAccountId: 'exact-account', region: 'eu', platform: 'pc' } })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/consent', player, { expectedRevision: 0, requestId: 'consent-other', playerId: 'p2', providerId: 'official', consentVersion: 'consent/v1', scopes: ['ranked-match-history'] })).status).toBe(403);
    expect((await call('/api/engine-adapters/ranked/consent', player, { expectedRevision: 0, requestId: 'consent-1', providerId: 'official', consentVersion: 'consent/v1', scopes: ['ranked-match-history'] })).status).toBe(200);
    const outcome = { kind: 'success', generation: 1, startedAt: '2026-10-12T10:00:00.000Z', at: '2026-10-12T10:01:00.000Z', cursor: 'private-cursor', watermark: 'wm-1', knownMatchCount: 8 };
    expect((await call('/api/engine-adapters/ranked/outcome', coach, { expectedRevision: 0, requestId: 'outcome-1', playerId: 'p1', providerId: 'official', outcome })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/outcome', coach, { expectedRevision: 0, requestId: 'outcome-stale', playerId: 'p1', providerId: 'official', outcome })).status).toBe(409);
    const safe = await (await call('/api/engine-adapters', player)).json(); expect(safe.ranked).toMatchObject({ activation: 'disabled', accounts: [{ playerId: 'p1', providerId: 'official' }] });
    expect(safe.ranked).not.toHaveProperty('providers'); expect(JSON.stringify(safe.ranked)).not.toContain('cursor');
    expect((await call('/api/engine-adapters/ranked/revoke', player, { expectedRevision: 1, requestId: 'revoke-1', providerId: 'official' })).status).toBe(200);
    expect((await call('/api/sync-soloq', coach, {})).status).toBe(503);
  });
});

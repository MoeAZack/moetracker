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
const otherPlayerKey = 'adapter-other-player-key';
const unboundPlayerKey = 'adapter-unbound-player-key';
let tempDir = ''; let dbPath = ''; let server: Server | undefined; let origin = '';

async function call(route: string, token?: string, body?: any) {
  return fetch(`${origin}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login(key: string) { const response = await call('/api/login-key', undefined, { key }); return (await response.json()).key; }

beforeEach(async () => {
  vi.resetModules(); tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-adapters-')); dbPath = path.join(tempDir, 'db.json');
  for (const [key, value] of Object.entries({ NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath, ADMIN_PASSWORD: adminKey, JWT_SECRET: jwtSecret, GOOGLE_CLIENT_ID: '' })) vi.stubEnv(key, value);
  await fs.writeFile(dbPath, JSON.stringify({ settings: {}, matches: [], seasonArchives: [], vodReviews: [], authKeys: [
    { id: 'player-key', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), label: 'Alpha', role: 'player', playerId: 'p1' },
    { id: 'other-key', keyHash: crypto.createHash('sha256').update(otherPlayerKey).digest('hex'), label: 'Bravo', role: 'player', playerId: 'p2' },
    { id: 'unbound-key', keyHash: crypto.createHash('sha256').update(unboundPlayerKey).digest('hex'), label: 'Unbound', role: 'player' },
  ], allowedUsers: [] }));
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
    expect((await call('/api/engine-adapters/replay/accept', coach, { matchId: 'm1', expectedRevision: 1, requestId: 'accept-1' })).status).toBe(200);
    expect((await call('/api/engine-adapters/replay/accept', coach, { matchId: 'm1', expectedRevision: 1, requestId: 'accept-1', changed: true })).status).toBe(409);

    const configKey = 'shadow/v1:b:1';
    const markedBaseline = { ...baseline, source: { ...baseline.source, nestedPrivateMarker: { token: 'baseline-secret' } } };
    const markedInput = { ...ratingInput, context: { ...ratingInput.context, source: { ...ratingInput.context.source, nestedPrivateMarker: { token: 'input-secret' } } } };
    expect((await call('/api/engine-adapters/ratings/config', coach, { expectedRevision: 0, requestId: 'config-1', formula, baseline: markedBaseline, validationInput: markedInput })).status).toBe(200);
    const computed = await (await call('/api/engine-adapters/ratings/recompute', coach, { expectedRevision: 0, requestId: 'rating-1', configKey, input: { ...ratingInput, clientScore: 999 } })).json();
    expect(computed.result.calculation.authoritativeScore).toBeNull(); expect(computed.result.calculation.shadowScore).not.toBe(999);
    expect(await fs.readFile(dbPath, 'utf8')).not.toContain('clientScore');
    expect((await call('/api/engine-adapters/ratings/accept', coach, { expectedRevision: 1, requestId: 'rating-accept', recordKey: computed.recordKey })).status).toBe(200);
    expect((await call('/api/engine-adapters/ratings/accept', coach, { expectedRevision: 1, requestId: 'rating-accept', recordKey: computed.recordKey })).status).toBe(200);

    const safe = await (await call('/api/engine-adapters', player)).json(); const serialized = JSON.stringify(safe);
    expect(safe.replay[0]).toMatchObject({ status: 'accepted', matchId: 'm1' }); expect(safe.ratings[0]).toMatchObject({ authoritativeScore: null, calibrationStatus: 'uncalibrated', experimental: true });
    for (const marker of ['private-hash', 'private-event', 'clientScore', 'baseline-secret', 'input-secret']) expect(serialized).not.toContain(marker);
  });

  it('rejects non-canonical replay, provider and account shapes and returns normalized ranked arrays', async () => {
    const coach = await login(adminKey); const player = await login(playerKey);
    expect((await call('/api/engine-adapters/replay/draft', coach, { matchId: 'm1', expectedRevision: 0, requestId: 'bad-parser', parserInput: { ...parserInput, parser: { ...parserInput.parser, nestedPrivateMarker: { token: 'secret' } } } })).status).toBe(400);
    expect((await call('/api/engine-adapters/replay/draft', coach, { matchId: 'm1', expectedRevision: 0, requestId: 'bad-file', parserInput: { ...parserInput, file: { ...parserInput.file, nestedPrivateMarker: { token: 'secret' } } } })).status).toBe(400);
    expect((await call('/api/engine-adapters/replay/draft', coach, { matchId: 'm1', expectedRevision: 0, requestId: 'bad-provenance', parserInput: { ...parserInput, provenance: { nestedPrivateMarker: { token: 'secret' } } } })).status).toBe(400);
    const provider = { providerId: 'official', approvedStatus: 'pending', configured: false, documentedEndpointFamily: null, sourceSchemaVersion: null, termsPolicyVersion: null, quota: null };
    expect((await call('/api/engine-adapters/ranked/provider', coach, { expectedRevision: 0, requestId: 'bad-provider', provider: { ...provider, nestedPrivateMarker: { token: 'secret' } } })).status).toBe(400);
    expect((await call('/api/engine-adapters/ranked/provider', coach, { expectedRevision: 0, requestId: 'provider', provider })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/account', coach, { expectedRevision: 0, requestId: 'bad-account', playerId: 'p1', providerId: 'official', account: { providerAccountId: 'id', region: 'eu', platform: 'pc', nestedPrivateMarker: { token: 'secret' } } })).status).toBe(400);
    const coachPayload = await (await call('/api/engine-adapters', coach)).json(); const playerPayload = await (await call('/api/engine-adapters', player)).json();
    for (const payload of [coachPayload, playerPayload]) { expect(Array.isArray(payload.ranked.accounts)).toBe(true); expect(Array.isArray(payload.ranked.consents)).toBe(true); expect(Array.isArray(payload.ranked.states)).toBe(true); }
    expect(Array.isArray(coachPayload.ranked.providers)).toBe(true); expect(JSON.stringify(playerPayload)).not.toContain('nestedPrivateMarker'); expect(JSON.stringify(playerPayload)).not.toContain('secret');
  });

  it('locks formula and baseline version identities to canonical content', async () => {
    const coach = await login(adminKey); const postConfig = (requestId: string, nextFormula: any, nextBaseline: any, nextInput: any = ratingInput) => call('/api/engine-adapters/ratings/config', coach, { expectedRevision: 0, requestId, formula: nextFormula, baseline: nextBaseline, validationInput: nextInput });
    expect((await postConfig('config-lock', formula, baseline)).status).toBe(200);
    expect((await postConfig('config-lock', formula, baseline)).status).toBe(200);
    const weightMutation = { ...formula, weights: { ...formula.weights, killsPerRound: .26, deathsPerRound: .19 } };
    const thresholdMutation = { ...formula, thresholds: { ...formula.thresholds, minimumRounds: 2 } };
    for (const [id, changed] of [['center', { ...formula, center: 1.1 }], ['weights', weightMutation], ['threshold', thresholdMutation]] as const) expect((await postConfig(`mutate-${id}`, changed, baseline)).status).toBe(409);
    const sourceBaseline = { ...baseline, source: { id: 'other-source', version: '1' } }; const sourceInput = { ...ratingInput, context: { ...ratingInput.context, source: { id: 'other-source', version: '1' } } };
    expect((await postConfig('mutate-source', formula, sourceBaseline, sourceInput)).status).toBe(409);
    const metricBaseline = { ...baseline, metrics: { ...baseline.metrics, killsPerRound: { median: .9, mad: .1, rounds: 10 } } };
    expect((await postConfig('mutate-baseline', formula, metricBaseline)).status).toBe(409);
  });

  it('binds player consent to coach-confirmed identity and keeps provider activation disabled', async () => {
    const coach = await login(adminKey); const player = await login(playerKey); const other = await login(otherPlayerKey); const unbound = await login(unboundPlayerKey);
    const provider = { providerId: 'official', approvedStatus: 'pending', configured: false, documentedEndpointFamily: null, sourceSchemaVersion: null, termsPolicyVersion: null, quota: null };
    expect((await call('/api/engine-adapters/ranked/provider', coach, { expectedRevision: 0, requestId: 'provider-1', provider })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/account', coach, { expectedRevision: 0, requestId: 'account-1', playerId: 'p1', providerId: 'official', account: { providerAccountId: 'exact-account', region: 'eu', platform: 'pc' } })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/consent', coach, { expectedRevision: 0, requestId: 'coach-fabrication', playerId: 'p1', providerId: 'official', consentVersion: 'consent/v1', scopes: ['ranked-match-history'] })).status).toBe(403);
    expect((await call('/api/engine-adapters/ranked/consent', unbound, { expectedRevision: 0, requestId: 'unbound', providerId: 'official', consentVersion: 'consent/v1', scopes: ['ranked-match-history'] })).status).toBe(403);
    expect((await call('/api/engine-adapters/ranked/consent', other, { expectedRevision: 0, requestId: 'other', playerId: 'p1', providerId: 'official', consentVersion: 'consent/v1', scopes: ['ranked-match-history'] })).status).toBe(403);
    expect((await call('/api/engine-adapters/ranked/consent', player, { expectedRevision: 0, requestId: 'consent-other', playerId: 'p2', providerId: 'official', consentVersion: 'consent/v1', scopes: ['ranked-match-history'] })).status).toBe(403);
    expect((await call('/api/engine-adapters/ranked/consent', player, { expectedRevision: 0, requestId: 'consent-1', providerId: 'official', consentVersion: 'consent/v1', scopes: ['ranked-match-history'] })).status).toBe(200);
    const outcome = { kind: 'success', generation: 1, startedAt: '2026-10-12T10:00:00.000Z', at: '2026-10-12T10:01:00.000Z', cursor: 'private-cursor', watermark: 'wm-1', knownMatchCount: 8 };
    expect((await call('/api/engine-adapters/ranked/outcome', coach, { expectedRevision: 0, requestId: 'outcome-1', playerId: 'p1', providerId: 'official', outcome })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/outcome', coach, { expectedRevision: 0, requestId: 'outcome-stale', playerId: 'p1', providerId: 'official', outcome })).status).toBe(409);
    const safe = await (await call('/api/engine-adapters', player)).json(); expect(safe.ranked).toMatchObject({ activation: 'disabled', accounts: [{ playerId: 'p1', providerId: 'official' }] });
    expect(safe.ranked).not.toHaveProperty('providers'); expect(JSON.stringify(safe.ranked)).not.toContain('cursor');
    expect((await call('/api/engine-adapters/ranked/revoke', player, { expectedRevision: 1, requestId: 'revoke-1', providerId: 'official' })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/revoke', player, { expectedRevision: 1, requestId: 'revoke-1', providerId: 'official' })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/revoke', player, { expectedRevision: 1, requestId: 'revoke-1', providerId: 'official', changed: true })).status).toBe(409);
    expect((await call('/api/engine-adapters/ranked/consent', player, { expectedRevision: 2, requestId: 'consent-2', providerId: 'official', consentVersion: 'consent/v1', scopes: ['ranked-match-history'] })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/revoke', coach, { expectedRevision: 3, requestId: 'coach-revoke', playerId: 'p1', providerId: 'official' })).status).toBe(200);
    expect((await call('/api/engine-adapters/ranked/revoke', player, { expectedRevision: 1, requestId: 'revoke-1', providerId: 'official' })).status).toBe(200);
    expect((await call('/api/sync-soloq', coach, {})).status).toBe(503);
  });
});

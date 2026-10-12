import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';

const adminKey = 'test-master-secret-at-least-24-characters';
const playerKey = 'test-player-access-key';
const standInId = '00000000-0000-4000-8000-000000000003';
let tempDir: string;
let dbPath: string;
let server: Server;
let origin: string;

function fixture() {
  return {
    ...createSeed(),
    matches: [{ id: 'match-1', opponent: 'Before', attW: 1, attL: 0, defW: 0, defL: 0, rosterContext: { kind: 'mixed' } }],
    playerStats: [{ id: 'old-stat', matchId: 'match-1', player: 'Alpha', kills: 10 }],
    rosterPlayers: [{ id: standInId, displayName: 'Known Stand In', createdAt: '2026-01-01' }],
    authKeys: [{
      id: 'player-1',
      keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'),
      label: 'Read only player',
      role: 'player',
    }],
  };
}

async function login(key: string) {
  const response = await fetch(`${origin}/api/login-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).key as string;
}

async function save(token: string, body: unknown) {
  return fetch(`${origin}/api/save-match`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  vi.resetModules();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-match-save-'));
  dbPath = path.join(tempDir, 'db.json');
  for (const [key, value] of Object.entries({
    NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath,
    ADMIN_PASSWORD: adminKey, JWT_SECRET: 'test-session-secret-at-least-24-characters',
    GEMINI_API_KEY: 'test-no-external-calls', GOOGLE_CLIENT_ID: '',
  })) vi.stubEnv(key, value);
  await fs.writeFile(dbPath, JSON.stringify(fixture()));
  const { createApp } = await import('../server');
  const app = await createApp(false);
  server = await new Promise<Server>(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 15_000);

beforeEach(async () => {
  await fs.writeFile(dbPath, JSON.stringify(fixture()));
});

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  vi.unstubAllEnvs();
  vi.resetModules();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('explicit match statistics save contract', () => {
  it('preserves existing stats when a score-only save omits the stats update', async () => {
    const token = await login(adminKey);
    const response = await save(token, { match: { id: 'match-1', opponent: 'After', attW: 13 } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ statsUpdate: { operation: 'preserve' } });
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.matches[0]).toMatchObject({ id: 'match-1', opponent: 'After', attW: 13 });
    expect(stored.matches[0].rosterContext).toEqual({ kind: 'mixed' });
    expect(stored.playerStats).toEqual([{ id: 'old-stat', matchId: 'match-1', player: 'Alpha', kills: 10 }]);
  });

  it('replaces stats only through the explicit replacement operation', async () => {
    const token = await login(adminKey);
    const response = await save(token, {
      match: { id: 'match-1', opponent: 'After' },
      statsUpdate: { operation: 'replace', stats: [{ matchId: 'match-1', player: 'Alpha', kills: 22 }] },
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.statsUpdate).toMatchObject({ operation: 'replace', stats: [{ matchId: 'match-1', player: 'Alpha', kills: 22 }] });
    expect(result.statsUpdate.stats[0].id).not.toBe('old-stat');
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.playerStats).toEqual(result.statsUpdate.stats);
  });

  it('rejects wrong-match stats and the old ambiguous stats array without changing data', async () => {
    const token = await login(adminKey);
    const mismatch = await save(token, {
      match: { id: 'match-1', opponent: 'Must not save' },
      statsUpdate: { operation: 'replace', stats: [{ matchId: 'different-match', player: 'Alpha' }] },
    });
    expect(mismatch.status).toBe(400);
    const ambiguous = await save(token, {
      match: { id: 'match-1', opponent: 'Must not save' },
      stats: [],
    });
    expect(ambiguous.status).toBe(400);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.matches[0].opponent).toBe('Before');
    expect(stored.playerStats).toEqual([{ id: 'old-stat', matchId: 'match-1', player: 'Alpha', kills: 10 }]);
  });

  it('keeps player sessions read-only', async () => {
    const response = await save(await login(playerKey), { match: { id: 'match-1', opponent: 'Forbidden' } });
    expect(response.status).toBe(403);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.matches[0].opponent).toBe('Before');
  });

  it('normalizes a coach-confirmed stand-in and rejects a foreign identity through HTTP', async () => {
    const token = await login(adminKey);
    const accepted = await save(token, {
      match: { id: 'match-1', opponent: 'After', rosterContext: { kind: 'mixed' } },
      statsUpdate: { operation: 'replace', stats: [{ playerId: standInId, appearanceType: 'standIn', player: 'untrusted name' }] },
    });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).statsUpdate.stats[0]).toMatchObject({
      playerId: standInId, player: 'Known Stand In', displayNameSnapshot: 'Known Stand In', appearanceType: 'standIn',
    });
    await fs.writeFile(dbPath, JSON.stringify(fixture()));
    const rejected = await save(token, {
      match: { id: 'match-1', opponent: 'Must not save', rosterContext: { kind: 'mixed' } },
      statsUpdate: { operation: 'replace', stats: [{ playerId: '00000000-0000-4000-8000-000000000099', appearanceType: 'standIn' }] },
    });
    expect(rejected.status).toBe(400);
    expect(JSON.parse(await fs.readFile(dbPath, 'utf8')).matches[0].opponent).toBe('Before');
  });

  it('preserves totals for incomplete splits, recomputes complete splits, and keeps unknown distinct from zero', async () => {
    const token = await login(adminKey);
    const response = await save(token, {
      match: { id: 'match-1', opponent: 'After', attW: null, attL: null, defW: null, defL: null },
      statsUpdate: { operation: 'replace', stats: [{
        player: 'Alpha', kills: 22, kAtt: 10, kDef: null,
        deaths: 14, dAtt: null, dDef: null,
        assists: 99, aAtt: 3, aDef: 4,
        fk: null, fd: 0,
      }] },
    });
    expect(response.status).toBe(200);
    const stat = (await response.json()).statsUpdate.stats[0];
    expect(stat).toMatchObject({ kills: 22, deaths: 14, assists: 7, kDef: null, fk: null, fd: 0 });
  });

  it('rejects negative, fractional, and out-of-range metrics without writing', async () => {
    const token = await login(adminKey);
    const invalidBodies = [
      { match: { id: 'match-1', opponent: 'Invalid', attW: -1 } },
      { match: { id: 'match-1', opponent: 'Invalid' }, statsUpdate: { operation: 'replace', stats: [{ kills: 1.5 }] } },
      { match: { id: 'match-1', opponent: 'Invalid' }, statsUpdate: { operation: 'replace', stats: [{ hs: 101 }] } },
    ];
    for (const body of invalidBodies) expect((await save(token, body)).status).toBe(400);
    const bypass = await fetch(`${origin}/api/upsert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet: 'Matches', row: { id: 'bypass', attW: -1 } }),
    });
    expect(bypass.status).toBe(400);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.matches[0].opponent).toBe('Before');
    expect(stored.playerStats).toEqual([{ id: 'old-stat', matchId: 'match-1', player: 'Alpha', kills: 10 }]);
  });

  it('keeps match/stat source immutable and appends correction metadata on edits', async () => {
    const token = await login(adminKey);
    const sourceMetadata = {
      method: 'screenshot', provider: 'gemini', model: 'test-model', capturedAt: '2026-10-12T12:00:00.000Z',
    };
    const createdResponse = await save(token, {
      match: { opponent: 'First', source: 'ocr', sourceMetadata, attW: null, attL: null, defW: null, defL: null },
      statsUpdate: { operation: 'replace', stats: [{ player: 'Alpha', kills: 12, sourceMetadata }] },
    });
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json();
    const createdStat = created.statsUpdate.stats[0];
    const fakeSource = { method: 'manual', capturedAt: '2099-01-01T00:00:00.000Z' };
    const editedResponse = await save(token, {
      match: { ...created.match, opponent: 'Corrected', sourceMetadata: fakeSource, corrections: [] },
      statsUpdate: { operation: 'replace', stats: [{ ...createdStat, kills: 13, sourceMetadata: fakeSource, corrections: [] }] },
    });
    expect(editedResponse.status).toBe(200);
    const edited = await editedResponse.json();
    expect(edited.match.sourceMetadata).toEqual(sourceMetadata);
    expect(edited.match.corrections).toEqual([expect.objectContaining({ correctedBy: 'Administrator (Master)', fields: ['opponent'] })]);
    expect(edited.statsUpdate.stats[0].sourceMetadata).toEqual(sourceMetadata);
    expect(edited.statsUpdate.stats[0].corrections).toEqual([expect.objectContaining({ correctedBy: 'Administrator (Master)', fields: ['kills'] })]);
  });

  it('keeps every VLR endpoint disabled without fetching or writing', async () => {
    const token = await login(adminKey);
    const before = await fs.readFile(dbPath, 'utf8');
    const originalFetch = globalThis.fetch;
    const externalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected external fetch'));
    try {
      for (const [route, method] of [
        ['/api/vlr-team-matches', 'GET'],
        ['/api/vlr-team-map-stats', 'GET'],
        ['/api/import-vlr-match', 'POST'],
      ] as const) {
        const response = await originalFetch(`${origin}${route}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(method === 'POST' ? { body: JSON.stringify({ matchId: '123' }) } : {}),
        });
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ disabled: true, fetched: false, wrote: false });
      }
      expect(externalFetch).not.toHaveBeenCalled();
    } finally {
      externalFetch.mockRestore();
    }
    expect(await fs.readFile(dbPath, 'utf8')).toBe(before);
  });
});

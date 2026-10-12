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
let tempDir: string;
let dbPath: string;
let server: Server;
let origin: string;

function fixture() {
  return {
    ...createSeed(),
    matches: [{ id: 'match-1', opponent: 'Before', attW: 1, attL: 0, defW: 0, defL: 0 }],
    playerStats: [{ id: 'old-stat', matchId: 'match-1', player: 'Alpha', kills: 10 }],
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
});

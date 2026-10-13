import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminKey = 'test-master-secret-at-least-24-characters';
const jwtSecret = 'test-session-secret-at-least-24-characters';
const playerKey = 'test-player-access-key';
let tempDir: string;
let dbPath: string;
let server: Server | undefined;
let origin: string;

async function request(route: string, token?: string, body?: unknown) {
  return fetch(`${origin}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function login(key: string) {
  const response = await request('/api/login-key', undefined, { key });
  expect(response.status).toBe(200);
  return (await response.json()).key as string;
}

beforeEach(async () => {
  vi.resetModules();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-http-'));
  dbPath = path.join(tempDir, 'db.json');
  for (const [key, value] of Object.entries({
    NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath,
    ADMIN_PASSWORD: adminKey, JWT_SECRET: jwtSecret, GEMINI_API_KEY: 'test-no-external-calls', GOOGLE_CLIENT_ID: '',
  })) vi.stubEnv(key, value);
  await fs.writeFile(dbPath, JSON.stringify({
    settings: {
      teamName: 'Test team', discordWebhook: 'private-hook', henrikApiKey: 'private-henrik', gridApiKey: 'private-grid',
      riotIds: { Alpha: { name: 'Private Riot name', tag: 'TAG', region: 'eu' } },
    },
    matches: [{ id: 'visible-match' }],
    rosterPlayers: [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Ahmed' }],
    coreMemberships: [],
    seasonArchives: [{ id: 'archive-1', name: 'Private archive', vodReviews: [{ id: 'private-archived-vod' }] }],
    vodReviews: [{ id: 'active-vod' }],
    authKeys: [{ id: 'player-1', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), label: 'Test player', role: 'player' }],
    allowedUsers: [{ email: 'private@example.invalid', role: 'coach' }],
    secretValues: { token: 'private-token' },
    replayIntake: { devices: { one: { tokenHash: 'PRIVATE-REPLAY-TOKEN-HASH', owner: { actorId: 'PRIVATE-REPLAY-OWNER' } } }, reviews: { one: { mappings: ['PRIVATE-REPLAY-MAPPING'] } } },
    engineAdapters: { replay: { one: { draft: 'PRIVATE-REPLAY-EVIDENCE' } }, ratings: { records: { one: { input: 'PRIVATE-RATING-INPUT' } } } },
  }));
  const { createApp } = await import('../server');
  const app = await createApp(false);
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server = undefined;
  }
  vi.unstubAllEnvs();
  vi.resetModules();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('HTTP authentication and authorization boundary', () => {
  it('rejects unauthenticated requests and raw master/player keys, with no-store even on errors', async () => {
    for (const token of [undefined, adminKey, playerKey]) {
      const response = await request('/api/data', token);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('exchanges a player key for a JWT and returns tracker data without credentials', async () => {
    const token = await login(playerKey);
    expect(jwt.verify(token, jwtSecret, { algorithms: ['HS256'] })).toMatchObject({ kind: 'key', keyId: 'player-1' });
    const response = await request('/api/data', token);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const data = await response.json();
    expect(data.matches).toEqual([{ id: 'visible-match' }]);
    for (const key of ['authKeys', 'allowedUsers', 'secretValues']) expect(data).not.toHaveProperty(key);
    expect(data.settings).toMatchObject({ teamName: 'Test team' });
    expect(data.seasonArchives).toEqual([]);
    expect(JSON.stringify(data)).not.toContain('private-archived-vod');
    expect(data.vodReviews).toEqual([]);
    expect(data).not.toHaveProperty('replayIntake'); expect(data).not.toHaveProperty('engineAdapters'); expect(JSON.stringify(data)).not.toContain('PRIVATE-REPLAY');
  });

  it('returns full season archives and Riot IDs to a coach', async () => {
    const token = await login(adminKey);
    const response = await request('/api/data', token);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.settings.riotIds.Alpha.tag).toBe('TAG');
    expect(data.seasonArchives[0].vodReviews[0].id).toBe('private-archived-vod');
    expect(data).not.toHaveProperty('replayIntake'); expect(data).not.toHaveProperty('engineAdapters'); expect(JSON.stringify(data)).not.toContain('PRIVATE-REPLAY');
  });

  it('rejects player administrative reads and writes while allowing comment validation', async () => {
    const token = await login(playerKey);
    for (const route of ['/api/access', '/api/keys']) expect((await request(route, token)).status).toBe(403);
    for (const route of ['/api/settings', '/api/reset-metrics', '/api/keys/create']) {
      expect((await request(route, token, {})).status).toBe(403);
    }
    expect((await request('/api/vod/reply', token, {})).status).toBe(403);
    expect((await request('/api/lineup/comment', token, {})).status).toBe(400);
  });

  it('revokes an already-issued player session immediately', async () => {
    const token = await login(playerKey);
    const coach = await login(adminKey);
    expect((await request('/api/keys/revoke', coach, { id: 'player-1' })).status).toBe(200);
    expect((await request('/api/data', token)).status).toBe(401);
  });

  it('creates 128-bit random keys, stores only their hash, and excludes hashes from key listings', async () => {
    const coach = await login(adminKey);
    const response = await request('/api/keys/create', coach, { label: 'New coach', role: 'coach' });
    expect(response.status).toBe(200);
    const created = await response.json();
    expect(created.key).toMatch(/^RAAD-COACH-[A-F0-9]{32}$/);
    expect(created).not.toHaveProperty('keyHash');
    const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    const stored = db.authKeys.find((entry: { id: string }) => entry.id === created.id);
    expect(stored).not.toHaveProperty('key');
    expect(stored.keyHash).toBe(crypto.createHash('sha256').update(created.key).digest('hex'));
    const listing = await (await request('/api/keys', coach)).json();
    for (const entry of listing) {
      expect(entry).not.toHaveProperty('key');
      expect(entry).not.toHaveProperty('keyHash');
    }
  });

  it('lets a coach reset a named player password without storing plaintext and revokes the prior session', async () => {
    const coach = await login(adminKey);
    const playerId = '11111111-1111-4111-8111-111111111111';
    const firstSet = await request('/api/player-password', coach, { playerId, password: 'xyz' });
    expect(firstSet.status).toBe(200);
    const firstMetadata = await firstSet.json();
    expect(firstMetadata).toMatchObject({ success: true, playerId, playerName: 'Ahmed' });
    expect(firstMetadata.credentialVersion).toMatch(/^[0-9a-f-]{36}$/);
    let db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    const stored = db.authKeys.find((entry: any) => entry.id === `player-password:${playerId}`);
    expect(stored).toMatchObject({ role: 'player', playerId, credentialType: 'player-password', credentialVersion: firstMetadata.credentialVersion });
    expect(stored).not.toHaveProperty('key');
    expect(JSON.stringify(stored)).not.toContain('xyz');

    const signedIn = await request('/api/login-key', undefined, { playerName: 'Ahmed', key: 'xyz' });
    expect(signedIn.status).toBe(200);
    const oldToken = (await signedIn.json()).key;
    expect(jwt.verify(oldToken, jwtSecret, { algorithms: ['HS256'] })).toMatchObject({ kind: 'key', keyId: `player-password:${playerId}`, credentialVersion: firstMetadata.credentialVersion });
    expect((await request('/api/data', oldToken)).status).toBe(200);

    const reset = await request('/api/player-password', coach, { playerId, password: 'new-password' });
    expect(reset.status).toBe(200);
    const resetMetadata = await reset.json();
    expect(resetMetadata.credentialVersion).not.toBe(firstMetadata.credentialVersion);
    expect((await request('/api/data', oldToken)).status).toBe(401);
    expect((await request('/api/login-key', undefined, { playerName: 'Ahmed', key: 'xyz' })).status).toBe(401);
    expect((await request('/api/login-key', undefined, { playerName: 'Ahmed', key: 'new-password' })).status).toBe(200);
    db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(db.authKeys.find((entry: any) => entry.id === `player-password:${playerId}`).credentialVersion).toBe(resetMetadata.credentialVersion);
  });

  it('does not resurrect an old password session after credential deletion and recreation', async () => {
    const coach = await login(adminKey);
    const playerId = '11111111-1111-4111-8111-111111111111';
    const firstSet = await request('/api/player-password', coach, { playerId, password: 'xyz' });
    const firstVersion = (await firstSet.json()).credentialVersion;
    const signedIn = await request('/api/login-key', undefined, { playerName: 'Ahmed', key: 'xyz' });
    const oldToken = (await signedIn.json()).key;
    expect((await request('/api/keys/revoke', coach, { id: `player-password:${playerId}` })).status).toBe(200);
    expect((await request('/api/data', oldToken)).status).toBe(401);
    const recreated = await request('/api/player-password', coach, { playerId, password: 'xyz' });
    expect(recreated.status).toBe(200);
    expect((await recreated.json()).credentialVersion).not.toBe(firstVersion);
    expect((await request('/api/data', oldToken)).status).toBe(401);
  });

  it('returns a retryable conflict when two password resets race', async () => {
    const coach = await login(adminKey);
    const playerId = '11111111-1111-4111-8111-111111111111';
    const responses = await Promise.all([
      request('/api/player-password', coach, { playerId, password: 'first-password' }),
      request('/api/player-password', coach, { playerId, password: 'second-password' }),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const conflict = responses.find(response => response.status === 409)!;
    expect(await conflict.json()).toEqual({ error: 'Password changed concurrently. Refresh and retry.' });
  });

  it('never falls through named player login to master or custom keys', async () => {
    expect((await request('/api/login-key', undefined, { playerName: 'Ahmed', key: adminKey })).status).toBe(401);
    expect((await request('/api/login-key', undefined, { playerName: 'Ahmed', key: playerKey })).status).toBe(401);
  });

  it('rejects expired, malformed, wrongly signed, and disallowed-algorithm sessions', async () => {
    const claims = { kind: 'key', keyId: 'player-1' };
    const tokens = ['not-a-jwt', jwt.sign(claims, jwtSecret, { expiresIn: -1 }),
      jwt.sign(claims, 'wrong-secret'), jwt.sign(claims, jwtSecret, { algorithm: 'HS384' })];
    for (const token of tokens) expect((await request('/api/data', token)).status).toBe(401);
  });

  it('uses current stored roles and denies an unknown role despite a signed coach claim', async () => {
    const token = jwt.sign({ kind: 'key', keyId: 'player-1', role: 'coach' }, jwtSecret);
    expect((await request('/api/keys', token)).status).toBe(403);
    const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    db.authKeys[0].role = 'unexpected-role';
    await fs.writeFile(dbPath, JSON.stringify(db));
    expect((await request('/api/data', token)).status).toBe(401);
  });

  it('does not expose server artifacts', async () => {
    for (const route of ['/server.cjs', '/server.cjs.map', '/build/server.cjs', '/build/server.cjs.map']) {
      expect((await request(route)).status).toBe(404);
    }
  });
});

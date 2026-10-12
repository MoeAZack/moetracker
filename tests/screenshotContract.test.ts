import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';

const generateContent = vi.hoisted(() => vi.fn());
vi.mock('../lib/clients', () => ({ ai: { models: { generateContent } } }));

const adminKey = 'test-master-secret-at-least-24-characters';
let tempDir: string;
let dbPath: string;
let server: Server;
let origin: string;

function fixture() {
  return {
    ...createSeed(),
    settings: { ...createSeed().settings, players: ['Alpha'] },
    rosterPlayers: [{ id: '00000000-0000-4000-8000-000000000001', displayName: 'Alpha', createdAt: '2026-01-01' }],
  };
}

async function login() {
  const response = await fetch(`${origin}/api/login-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: adminKey }),
  });
  return (await response.json()).key as string;
}

async function extract(route: string, token: string) {
  const payload = route === '/api/import-scrim'
    ? { scoreboard: { base64: 'image-bytes', mediaType: 'image/png' } }
    : { base64: 'image-bytes', mediaType: 'image/png' };
  return fetch(`${origin}${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  vi.resetModules();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-screenshot-contract-'));
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
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: JSON.stringify({
    map: 'Ascent', ourScore: 13, theirScore: 0, confident: false,
    players: [{ name: 'Alpha', agent: 'Omen', kills: 0, deaths: null, assists: 4, acs: null }],
  }) });
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

describe('screenshot extraction API contract', () => {
  it('returns the same non-writing review contract from both screenshot endpoints', async () => {
    const token = await login();
    const before = await fs.readFile(dbPath, 'utf8');
    for (const route of ['/api/import-screenshot', '/api/import-scrim']) {
      const response = await extract(route, token);
      expect(response.status).toBe(200);
      const draft = await response.json();
      expect(draft).toMatchObject({
        contractVersion: 1, status: 'review-required', reviewRequired: true,
        sourceMetadata: { method: 'screenshot', provider: 'gemini' },
        match: { ourScore: 13, theirScore: 0, attW: null, defW: null, alliedSideConfirmed: false },
        stats: [{ matchedPlayerName: 'Alpha', kills: 0, deaths: null, kAtt: null }],
      });
    }
    expect(await fs.readFile(dbPath, 'utf8')).toBe(before);
  });

  it('rejects invalid extracted metrics without saving', async () => {
    const token = await login();
    const before = await fs.readFile(dbPath, 'utf8');
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({
      map: 'Ascent', ourScore: 13, theirScore: 10, confident: true,
      players: [{ name: 'Alpha', kills: -1, deaths: 2, assists: 3 }],
    }) });
    const response = await extract('/api/import-screenshot', token);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Nothing was saved') });
    expect(await fs.readFile(dbPath, 'utf8')).toBe(before);
  });
});

import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addTryoutCandidate,
  archiveAndResetTryoutBatch,
  createRosterPlayer,
  createTryoutBatch,
  promoteTryoutCandidate,
  retireRosterPlayer,
  restoreTryoutBatch,
} from '../lib/roster';
import { createSeed } from '../lib/seed';

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
];
const now = () => '2026-10-12T10:00:00.000Z';

function rosterDb() {
  return {
    settings: { players: ['legacy-name'], inactivePlayers: ['other-legacy-name'] },
    rosterPlayers: [],
    coreMemberships: [],
    tryoutBatches: [],
    playerStats: [{ id: 'stat-1', player: 'legacy-name', kills: 9 }],
  };
}

describe('roster domain', () => {
  it('starts a fresh database with no invented core membership', () => {
    const seed = createSeed();
    expect(seed.rosterPlayers).toEqual([]);
    expect(seed.coreMemberships).toEqual([]);
    expect(seed.tryoutBatches).toEqual([]);
    expect(seed.settings.players).toEqual([]);
    expect(seed.matches).toEqual([]);
    expect(seed.playerStats).toEqual([]);
    expect(seed.rounds).toEqual([]);
    expect(seed.schedule).toEqual([]);
    expect(seed.goals).toEqual([]);
    expect(seed.strats).toEqual([]);
    expect(JSON.stringify(seed)).not.toMatch(/Shalaby|Shniider|Gamax|Nasr|Top GZ/);
  });

  it('archives a candidate list and creates an empty batch without touching core or statistics', () => {
    const db = rosterDb();
    const idFactory = vi.fn().mockReturnValueOnce(ids[0]).mockReturnValueOnce(ids[1]).mockReturnValueOnce(ids[2]);
    const player = createRosterPlayer(db, 'Candidate A', idFactory, now);
    const batch = createTryoutBatch(db, 'October trials', idFactory, now);
    addTryoutCandidate(db, batch.id, player.id);
    const statsBefore = structuredClone(db.playerStats);
    const coreBefore = structuredClone(db.coreMemberships);

    const result = archiveAndResetTryoutBatch(db, batch.id, 'November trials', idFactory, now);

    expect(result.archived).toMatchObject({ id: batch.id, status: 'archived', candidatePlayerIds: [player.id] });
    expect(result.replacement).toMatchObject({ id: ids[2], status: 'active', candidatePlayerIds: [] });
    expect(db.playerStats).toEqual(statsBefore);
    expect(db.coreMemberships).toEqual(coreBefore);
    expect(() => promoteTryoutCandidate(db, batch.id, player.id)).toThrow('active tryout batch');
    expect(restoreTryoutBatch(db, batch.id).batch.id).toBe(batch.id);
    expect(batch.candidatePlayerIds).toEqual([player.id]);
  });

  it('promotes idempotently while retaining candidate and source-batch history', () => {
    const db = rosterDb();
    const idFactory = vi.fn()
      .mockReturnValueOnce(ids[0])
      .mockReturnValueOnce(ids[1])
      .mockReturnValueOnce(ids[2]);
    const player = createRosterPlayer(db, 'Candidate A', idFactory, now);
    const batch = createTryoutBatch(db, 'October trials', idFactory, now);
    addTryoutCandidate(db, batch.id, player.id);

    const first = promoteTryoutCandidate(db, batch.id, player.id, idFactory, now);
    const second = promoteTryoutCandidate(db, batch.id, player.id, idFactory, now);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.membership.id).toBe(first.membership.id);
    expect(db.coreMemberships).toHaveLength(1);
    expect(first.membership.sourceTryoutBatchId).toBe(batch.id);
    expect(batch.candidatePlayerIds).toEqual([player.id]);
    expect(db.settings.players).toEqual(['Candidate A']);
    expect(db.settings.inactivePlayers).toEqual([]);
  });

  it('removes an active identity while preserving historical match evidence and revoking active links', () => {
    const db: any = rosterDb(); db.authKeys = []; db.allowedUsers = []; db.replayIntake = { devices: {} }; db.engineAdapters = { ranked: { consents: {} } };
    const idFactory = vi.fn().mockReturnValueOnce(ids[0]).mockReturnValueOnce(ids[1]).mockReturnValueOnce(ids[2]);
    const player: any = createRosterPlayer(db, 'Candidate A', idFactory, now);
    const batch = createTryoutBatch(db, 'October trials', idFactory, now); addTryoutCandidate(db, batch.id, player.id);
    promoteTryoutCandidate(db, batch.id, player.id, idFactory, now);
    db.authKeys.push({ id: 'key', playerId: player.id });
    db.allowedUsers.push({ email: 'player@example.com', playerId: player.id, role: 'player' });
    db.replayIntake.devices.device = { owner: { playerId: player.id }, revokedAt: null };
    db.engineAdapters.ranked.consents.consent = { playerId: player.id, revokedAt: null };
    db.playerStats.push({ id: 'historical', playerId: player.id, matchId: 'm1', kills: 10 });

    expect(retireRosterPlayer(db, player.id, now)).toMatchObject({ changed: true });
    expect(player.retiredAt).toBe(now());
    expect(db.coreMemberships[0].endedAt).toBe(now());
    expect(batch.candidatePlayerIds).toEqual([]);
    expect(db.authKeys).toEqual([]);
    expect(db.allowedUsers).toEqual([]);
    expect(db.replayIntake.devices.device.revokedAt).toBe(now());
    expect(db.engineAdapters.ranked.consents.consent.revokedAt).toBe(now());
    expect(db.playerStats).toContainEqual(expect.objectContaining({ id: 'historical', playerId: player.id }));
    expect(db.settings.players).toEqual([]);
  });
});

describe('roster HTTP and concurrency boundary', () => {
  let server: Server | undefined;
  let tempDir = '';

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

  it('keeps player sessions read-only while a coach can create a stable identity', async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-roster-http-'));
    const dbPath = path.join(tempDir, 'db.json');
    const playerKey = 'test-player-access-key';
    const adminKey = 'test-master-secret-at-least-24-characters';
    const base = createSeed();
    await fs.writeFile(dbPath, JSON.stringify({
      ...base,
      authKeys: [{
        id: 'player-1',
        keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'),
        label: 'Read only player',
        role: 'player',
      }],
    }));
    for (const [key, value] of Object.entries({
      NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath,
      ADMIN_PASSWORD: adminKey, JWT_SECRET: 'test-session-secret-at-least-24-characters',
      GEMINI_API_KEY: 'test-no-external-calls', GOOGLE_CLIENT_ID: '',
    })) vi.stubEnv(key, value);
    const { createApp } = await import('../server');
    const app = await createApp(false);
    server = await new Promise<Server>(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = async (key: string) => {
      const response = await fetch(`${origin}/api/login-key`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
      });
      return (await response.json()).key as string;
    };
    const postPlayer = async (token: string) => fetch(`${origin}/api/roster/players`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Stable Name' }),
    });

    expect((await postPlayer(await login(playerKey))).status).toBe(403);
    const coachToken = await login(adminKey);
    const coachResponse = await postPlayer(coachToken);
    expect(coachResponse.status).toBe(200);
    const created = await coachResponse.json();
    expect(created).toMatchObject({ displayName: 'Stable Name' });
    expect((await fetch(`${origin}/api/roster/core/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: created.id }),
    })).status).toBe(200);
    expect((await fetch(`${origin}/api/settings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: ['divergent legacy edit'] }),
    })).status).toBe(200);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.rosterPlayers).toHaveLength(1);
    expect(stored.settings.players).toEqual(['Stable Name']);

    const keyResponse = await fetch(`${origin}/api/keys/create`, { method: 'POST', headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'Stable player', role: 'player', playerId: created.id }) });
    expect(keyResponse.status).toBe(200); const playerAccess = await keyResponse.json(); const activePlayerSession = await login(playerAccess.key);
    expect((await fetch(`${origin}/api/data`, { headers: { Authorization: `Bearer ${activePlayerSession}` } })).status).toBe(200);
    expect((await fetch(`${origin}/api/roster/players/remove`, { method: 'POST', headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: created.id }) })).status).toBe(200);
    expect((await fetch(`${origin}/api/data`, { headers: { Authorization: `Bearer ${activePlayerSession}` } })).status).toBe(401);
    expect((await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: playerAccess.key }) })).status).toBe(401);
  }, 15_000);

  it('rejects a stale whole-database roster write with 409', async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-roster-stale-'));
    const dbPath = path.join(tempDir, 'db.json');
    await fs.writeFile(dbPath, JSON.stringify(createSeed()));
    vi.stubEnv('USE_FIRESTORE', 'false');
    vi.stubEnv('DB_PATH', dbPath);
    const { readDB, saveDB } = await import('../lib/store');
    const first = await readDB();
    const stale = await readDB();
    createRosterPlayer(first, 'First writer');
    await saveDB(first);
    createRosterPlayer(stale, 'Stale writer');
    await expect(saveDB(stale)).rejects.toMatchObject({ status: 409 });
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.rosterPlayers.map((player: any) => player.displayName)).toEqual(['First writer']);
  });
});

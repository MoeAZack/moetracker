import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { archiveAndResetSeason, restoreSeasonArchive } from '../lib/roster';
import { createSeed } from '../lib/seed';

const archiveId = '00000000-0000-4000-8000-000000000099';
const playerId = '00000000-0000-4000-8000-000000000001';
const now = () => '2026-10-12T12:00:00.000Z';

function seasonDb() {
  return {
    ...createSeed(),
    settings: {
      ...createSeed().settings,
      season: '2026 Spring',
      players: ['Alpha'],
      inactivePlayers: ['Former'],
      riotIds: { Alpha: { name: 'Alpha', tag: 'TEST', region: 'eu' } },
    },
    rosterPlayers: [{ id: playerId, displayName: 'Alpha', createdAt: '2026-01-01' }],
    coreMemberships: [{ id: 'membership-1', playerId, joinedAt: '2026-01-01' }],
    tryoutBatches: [{ id: 'batch-1', name: 'Trials', status: 'active', candidatePlayerIds: [] }],
    schedule: [{ id: 'schedule-1', title: 'Practice' }],
    goals: [{ id: 'goal-1', title: 'Improve' }],
    matches: [{ id: 'match-1', opponent: 'Opponent' }],
    playerStats: [{ id: 'stat-1', matchId: 'match-1', playerId, player: 'Alpha' }],
    soloq: [{ id: 'solo-1', player: 'Alpha' }],
    rounds: [{ id: 'round-1', matchId: 'match-1' }],
    vetos: [{ id: 'veto-1', matchId: 'match-1' }],
    stratRuns: [{ id: 'run-1', matchId: 'match-1' }],
    vodReviews: [{ id: 'vod-1', matchId: 'match-1' }],
    seasonArchives: [],
  };
}

describe('full roster-season archive domain', () => {
  it('makes roster management and the add-player action discoverable', async () => {
    const app = await fs.readFile(path.join(process.cwd(), 'src/App.tsx'), 'utf8');
    const manager = await fs.readFile(path.join(process.cwd(), 'src/components/RosterManager.tsx'), 'utf8');

    expect(app).toMatch(/activeTab === 'roster'[\s\S]*<RosterManager/);
    expect(manager).toContain('Add player');
  });

  it('snapshots all roster-linked history before starting a clean active season', () => {
    const db = seasonDb();
    const archive = archiveAndResetSeason(db, 'Spring finals', '2026 Summer', () => archiveId, now);

    expect(archive).toMatchObject({
      id: archiveId, name: 'Spring finals', seasonName: '2026 Spring', archivedAt: now(), schemaVersion: 1,
      rosterPlayers: [{ id: playerId }], matches: [{ id: 'match-1' }], playerStats: [{ id: 'stat-1' }],
      riotIds: { Alpha: { name: 'Alpha', tag: 'TEST', region: 'eu' } },
      legacyPlayers: ['Alpha'], legacyInactivePlayers: ['Former'],
    });
    for (const key of ['rosterPlayers', 'coreMemberships', 'tryoutBatches', 'schedule', 'goals', 'matches', 'playerStats', 'soloq', 'rounds', 'vetos', 'stratRuns', 'vodReviews']) {
      expect(db[key]).toEqual([]);
    }
    expect(db.settings).toMatchObject({ season: '2026 Summer', players: [], inactivePlayers: [], riotIds: {} });
    expect(db.seasonArchives).toEqual([archive]);

    db.rosterPlayers.push({ id: 'new-active', displayName: 'New Active', createdAt: '2026-10-12' });
    expect(archive.rosterPlayers).toEqual([{ id: playerId, displayName: 'Alpha', createdAt: '2026-01-01' }]);
  });

  it('restores the same IDs only into an empty active season and retains the snapshot', () => {
    const db = seasonDb();
    const archive = archiveAndResetSeason(db, 'Spring finals', '2026 Summer', () => archiveId, now);
    const restored = restoreSeasonArchive(db, archive.id);
    expect(restored.id).toBe(archiveId);
    expect(db.rosterPlayers[0].id).toBe(playerId);
    expect(db.coreMemberships[0].playerId).toBe(playerId);
    expect(db.matches[0].id).toBe('match-1');
    expect(db.playerStats[0].id).toBe('stat-1');
    expect(db.settings).toMatchObject({ season: '2026 Spring', players: ['Alpha'], inactivePlayers: ['Former'] });
    expect(db.seasonArchives).toHaveLength(1);
    expect(() => restoreSeasonArchive(db, archive.id)).toThrow('Archive the current active season');
  });

  it('fails before changing active data when an archive name conflicts', () => {
    const db = seasonDb();
    db.seasonArchives.push({ id: archiveId, name: 'Spring finals' });
    const before = structuredClone(db);
    expect(() => archiveAndResetSeason(db, 'spring FINALS', 'Next')).toThrow('already uses this name');
    expect(db).toEqual(before);
  });

  it('archives and restores a legacy name-only roster instead of losing it', () => {
    const db: any = seasonDb();
    for (const key of ['rosterPlayers', 'coreMemberships', 'tryoutBatches', 'schedule', 'goals', 'matches', 'playerStats', 'soloq', 'rounds', 'vetos', 'stratRuns', 'vodReviews']) db[key] = [];
    db.settings.players = ['Shalaby', 'Shniider'];
    db.settings.inactivePlayers = ['Former'];
    db.settings.riotIds = {};
    const archive = archiveAndResetSeason(db, 'Legacy season', 'Clean season', () => archiveId, now);
    expect(db.settings.players).toEqual([]);
    expect(archive.legacyPlayers).toEqual(['Shalaby', 'Shniider']);
    restoreSeasonArchive(db, archive.id);
    expect(db.settings.players).toEqual(['Shalaby', 'Shniider']);
    expect(db.settings.inactivePlayers).toEqual(['Former']);
  });
});

describe('season archive HTTP and version boundary', () => {
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

  it('denies player reset while a coach can archive and reset atomically', async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-season-http-'));
    const dbPath = path.join(tempDir, 'db.json');
    const playerKey = 'test-player-access-key';
    const adminKey = 'test-master-secret-at-least-24-characters';
    await fs.writeFile(dbPath, JSON.stringify({
      ...seasonDb(),
      authKeys: [{ id: 'player-1', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), label: 'Player', role: 'player' }],
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
    const reset = (token: string) => fetch(`${origin}/api/roster/seasons/archive-reset`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveName: 'Spring finals', newSeasonName: '2026 Summer' }),
    });

    expect((await reset(await login(playerKey))).status).toBe(403);
    expect((await reset(await login(adminKey))).status).toBe(200);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.seasonArchives).toHaveLength(1);
    expect(stored.seasonArchives[0].matches[0].id).toBe('match-1');
    expect(stored.matches).toEqual([]);
    expect(stored.rosterPlayers).toEqual([]);
  }, 15_000);

  it('rejects a stale archive/reset save with 409 and preserves the winning state', async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-season-stale-'));
    const dbPath = path.join(tempDir, 'db.json');
    await fs.writeFile(dbPath, JSON.stringify(seasonDb()));
    vi.stubEnv('USE_FIRESTORE', 'false');
    vi.stubEnv('DB_PATH', dbPath);
    const { readDB, saveDB } = await import('../lib/store');
    const winner = await readDB();
    const stale = await readDB();
    archiveAndResetSeason(winner, 'Winner archive', 'Next', () => archiveId, now);
    await saveDB(winner);
    archiveAndResetSeason(stale, 'Stale archive', 'Other', () => '00000000-0000-4000-8000-000000000098', now);
    await expect(saveDB(stale)).rejects.toMatchObject({ status: 409 });
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.seasonArchives.map((archive: any) => archive.name)).toEqual(['Winner archive']);
    expect(stored.settings.season).toBe('Next');
  });
});

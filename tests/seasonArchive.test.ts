import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveAndResetSeason,
  MAX_SEASON_ARCHIVES_BYTES,
  restoreSeasonArchive,
} from '../lib/roster';
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
    strats: [{ id: 'strat-1', map: 'Ascent', side: 'Attack', name: 'A execute', active: true }],
    stratRuns: [{ id: 'run-1', matchId: 'match-1', stratId: 'strat-1' }],
    vodReviews: [{ id: 'vod-1', matchId: 'match-1' }],
    lineups: [{ id: 'lineup-1', title: 'Shared lineup library entry' }],
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
      strats: [{ id: 'strat-1', name: 'A execute' }],
      riotIds: { Alpha: { name: 'Alpha', tag: 'TEST', region: 'eu' } },
      legacyPlayers: ['Alpha'], legacyInactivePlayers: ['Former'],
    });
    for (const key of ['rosterPlayers', 'coreMemberships', 'tryoutBatches', 'schedule', 'goals', 'matches', 'playerStats', 'soloq', 'rounds', 'vetos', 'stratRuns', 'vodReviews']) {
      expect(db[key]).toEqual([]);
    }
    expect(db.settings).toMatchObject({ season: '2026 Summer', players: [], inactivePlayers: [], riotIds: {}, tryoutsMode: false, activeTryoutBatchId: null });
    expect(db.seasonArchives).toEqual([archive]);
    expect(db.strats).toEqual([expect.objectContaining({ id: 'strat-1' })]);
    expect(db.lineups).toEqual([{ id: 'lineup-1', title: 'Shared lineup library entry' }]);

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

  it('archives and deterministically restores season-linked engine evidence without changing retained core configs', () => {
    const db: any = seasonDb();
    db.engineAdapters = {
      schemaVersion: 1,
      idempotency: { retry: { requestHash: 'hash', response: { ok: true }, completedAt: now() } },
      replay: { 'match-1': { matchId: 'match-1', status: 'accepted', revision: 2 } },
      ratings: { configs: { core: { key: 'core', revision: 4 } }, formulaVersions: { v1: 'formula-hash' }, baselineVersions: { b1: 'baseline-hash' }, records: { rating: { recordKey: 'rating', input: { context: { playerId, matchIds: ['match-1'] } }, revision: 3 } } },
      ranked: { providers: { official: { providerId: 'official', revision: 5 } }, accounts: { identity: { playerId, providerId: 'official', revision: 2 } }, consents: { identity: { playerId, providerId: 'official', revision: 3 } }, states: { identity: { playerId, providerId: 'official', revision: 7 } } },
    };
    db.authKeys = [{ id: 'player-key', role: 'player', playerId, keyHash: 'private-hash' }, { id: 'legacy-player-key', role: 'player', label: 'Alpha', keyHash: 'legacy-hash' }, { id: 'coach-key', role: 'coach', keyHash: 'coach-hash' }];
    db.allowedUsers = [{ email: 'alpha@example.com', role: 'player', playerId }, { email: 'legacy-alpha@example.com', role: 'player', name: 'Alpha' }, { email: 'coach@example.com', role: 'coach' }];
    const coreBefore = structuredClone({ configs: db.engineAdapters.ratings.configs, formulaVersions: db.engineAdapters.ratings.formulaVersions, baselineVersions: db.engineAdapters.ratings.baselineVersions, providers: db.engineAdapters.ranked.providers });
    const archive = archiveAndResetSeason(db, 'Engine season', 'Next', () => archiveId, now);
    expect(archive.engineAdapters).toMatchObject({ replay: { 'match-1': { revision: 2 } }, ratings: { records: { rating: { revision: 3 } } }, ranked: { accounts: { identity: { revision: 2 } }, consents: { identity: { revision: 3 } }, states: { identity: { revision: 7 } } }, idempotency: { retry: { requestHash: 'hash' } } });
    expect(db.engineAdapters.replay).toEqual({}); expect(db.engineAdapters.ratings.records).toEqual({}); expect(db.engineAdapters.ranked.accounts).toEqual({}); expect(db.engineAdapters.idempotency).toEqual({});
    expect(archive.accessIdentities.authKeys.map((item: any) => item.id).sort()).toEqual(['legacy-player-key', 'player-key']); expect(archive.accessIdentities.allowedUsers.map((item: any) => item.email).sort()).toEqual(['alpha@example.com', 'legacy-alpha@example.com']);
    expect(db.authKeys.map((item: any) => item.id)).toEqual(['coach-key']); expect(db.allowedUsers.map((item: any) => item.email)).toEqual(['coach@example.com']);
    expect({ configs: db.engineAdapters.ratings.configs, formulaVersions: db.engineAdapters.ratings.formulaVersions, baselineVersions: db.engineAdapters.ratings.baselineVersions, providers: db.engineAdapters.ranked.providers }).toEqual(coreBefore);
    restoreSeasonArchive(db, archive.id);
    expect(db.engineAdapters.replay['match-1'].revision).toBe(2); expect(db.engineAdapters.ratings.records.rating.revision).toBe(3); expect(db.engineAdapters.ranked.states.identity.revision).toBe(7); expect(db.engineAdapters.idempotency.retry.requestHash).toBe('hash');
    expect(db.authKeys.map((item: any) => item.id).sort()).toEqual(['coach-key', 'legacy-player-key', 'player-key']); expect(db.allowedUsers.map((item: any) => item.email).sort()).toEqual(['alpha@example.com', 'coach@example.com', 'legacy-alpha@example.com']);
    expect({ configs: db.engineAdapters.ratings.configs, formulaVersions: db.engineAdapters.ratings.formulaVersions, baselineVersions: db.engineAdapters.ratings.baselineVersions, providers: db.engineAdapters.ranked.providers }).toEqual(coreBefore);
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

  it('restores missing referenced strategies without overwriting newer shared definitions', () => {
    const newer = seasonDb();
    const newerArchive = archiveAndResetSeason(newer, 'With strategy', 'Next', () => archiveId, now);
    newer.strats[0].name = 'Newer shared definition';
    restoreSeasonArchive(newer, newerArchive.id);
    expect(newer.strats).toEqual([expect.objectContaining({ id: 'strat-1', name: 'Newer shared definition' })]);

    const missing = seasonDb();
    const missingArchive = archiveAndResetSeason(missing, 'With strategy', 'Next', () => archiveId, now);
    missing.strats = [];
    restoreSeasonArchive(missing, missingArchive.id);
    expect(missing.strats).toEqual([expect.objectContaining({ id: 'strat-1', name: 'A execute' })]);
  });

  it('rejects an orphaned strategy run before changing active state', () => {
    const db: any = seasonDb();
    db.strats = [];
    const before = structuredClone(db);

    expect(() => archiveAndResetSeason(db, 'Missing strategy', 'Next')).toThrow('missing strategy definitions');
    expect(db).toEqual(before);
  });

  it('rejects oversized archives before changing active state', () => {
    const db: any = seasonDb();
    db.matches[0].privateNotes = 'x'.repeat(MAX_SEASON_ARCHIVES_BYTES);
    const before = structuredClone(db);

    expect(() => archiveAndResetSeason(db, 'Too large', 'Next')).toThrowError(
      expect.objectContaining({ status: 413 }),
    );
    expect(db).toEqual(before);
  });

  it('fails closed when a nonempty top-level collection lacks an archive/retain policy', () => {
    const db: any = seasonDb();
    db.futureCollection = [{ id: 'must-not-be-lost' }];
    const before = structuredClone(db);

    expect(() => archiveAndResetSeason(db, 'Unsafe', 'Next')).toThrow('unclassified collections');
    expect(db).toEqual(before);
  });

  it('fails closed on restore when future history lacks an explicit collection policy', () => {
    const db: any = seasonDb();
    const archive = archiveAndResetSeason(db, 'Safe archive', 'Next', () => archiveId, now);
    db.futureHistory = [{ id: 'must-not-be-overwritten' }];
    const before = structuredClone(db);

    expect(() => restoreSeasonArchive(db, archive.id)).toThrowError(
      expect.objectContaining({ status: 409 }),
    );
    expect(db).toEqual(before);
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
    const coachToken = await login(adminKey);
    const oversized = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    oversized.matches[0].privateNotes = 'x'.repeat(MAX_SEASON_ARCHIVES_BYTES);
    await fs.writeFile(dbPath, JSON.stringify(oversized));
    const rejected = await reset(coachToken);
    expect(rejected.status).toBe(413);
    expect(await rejected.json()).toMatchObject({ error: expect.stringContaining('safe 800 KiB limit') });
    const unchanged = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(unchanged.seasonArchives).toEqual([]);
    expect(unchanged.matches[0].id).toBe('match-1');

    delete unchanged.matches[0].privateNotes;
    await fs.writeFile(dbPath, JSON.stringify(unchanged));
    expect((await reset(coachToken)).status).toBe(200);
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

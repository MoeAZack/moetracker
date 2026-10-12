import { afterEach, describe, expect, it } from 'vitest';
import { stripLegacySecrets, toPublicTrackerData } from '../lib/publicData';

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });

describe('public tracker data', () => {
  it('projects legacy player selectors from canonical active core membership', () => {
    const result = toPublicTrackerData({
      settings: { players: ['Shalaby', 'Shniider'], inactivePlayers: ['Former'] },
      rosterPlayers: [{ id: 'active', displayName: 'Ahmed' }, { id: 'retired', displayName: 'Old', retiredAt: '2026-01-01T00:00:00.000Z' }],
      coreMemberships: [{ id: 'ended', playerId: 'active', endedAt: '2026-02-01T00:00:00.000Z' }],
    });

    expect(result.settings.players).toEqual([]);
    expect(result.settings.inactivePlayers).toEqual([]);
    expect(JSON.stringify(result.settings)).not.toMatch(/Shalaby|Shniider|Former/);
  });

  it('never returns auth records or credential values', () => {
    process.env.GRID_API_KEY = 'server-only';
    const result = toPublicTrackerData({
      authKeys: [{ key: 'coach-key' }],
      allowedUsers: [{ email: 'coach@example.com' }],
      secretValues: { GRID_API_KEY: 'database-secret' },
      settings: {
        teamName: 'RAAD',
        gridApiKey: 'legacy-grid',
        henrikApiKey: 'legacy-henrik',
        discordWebhook: 'https://discord.example/hook'
      },
      matches: []
    });

    expect(result).not.toHaveProperty('authKeys');
    expect(result).not.toHaveProperty('allowedUsers');
    expect(result).not.toHaveProperty('secretValues');
    expect(result.settings).toEqual({ teamName: 'RAAD' });
    expect(result.secrets.GRID_API_KEY).toBe(true);
    expect(JSON.stringify(result)).not.toContain('server-only');
  });

  it('scrubs legacy secrets from backup imports', () => {
    const result = stripLegacySecrets({
      secretValues: { GRID_API_KEY: 'secret' },
      settings: { teamName: 'RAAD', gridApiKey: 'secret' }
    });
    expect(result).toEqual({ settings: { teamName: 'RAAD' } });
  });

  it('keeps archive bodies and Riot IDs coach-only', () => {
    const db = {
      settings: { teamName: 'RAAD', riotIds: { Alpha: { name: 'Private', tag: 'TAG', region: 'eu' } } },
      seasonArchives: [{
        id: 'archive-1', name: 'Private season', riotIds: { Alpha: { tag: 'TAG' } },
        vodReviews: [{ id: 'private-vod', notes: [{ text: 'private coaching note' }] }],
        accessIdentities: { authKeys: [{ keyHash: 'ARCHIVED-KEY-HASH' }], allowedUsers: [{ email: 'private@example.com' }] },
        engineAdapters: { replay: { one: 'ARCHIVED-REPLAY-EVIDENCE' } }, replayIntake: { devices: { one: { tokenHash: 'ARCHIVED-TOKEN-HASH' } } },
      }],
      vodReviews: [{ id: 'active-vod' }],
    };

    const player = toPublicTrackerData(db, 'player');
    expect(player.settings).not.toHaveProperty('riotIds');
    expect(player.seasonArchives).toEqual([]);
    expect(JSON.stringify(player)).not.toContain('private coaching note');
    expect(player.vodReviews).toEqual([]);

    const coach = toPublicTrackerData(db, 'coach');
    expect(coach.settings.riotIds.Alpha.tag).toBe('TAG');
    expect(coach.seasonArchives[0].vodReviews[0].id).toBe('private-vod');
    expect(JSON.stringify(coach)).not.toContain('ARCHIVED-KEY-HASH'); expect(JSON.stringify(coach)).not.toContain('private@example.com'); expect(JSON.stringify(coach)).not.toContain('ARCHIVED-REPLAY-EVIDENCE'); expect(JSON.stringify(coach)).not.toContain('ARCHIVED-TOKEN-HASH');
  });

  it('never includes private replay intake or engine-adapter stores in the generic payload', () => {
    const privateStores = {
      replayIntake: {
        devices: { device: { tokenHash: 'TOKEN-HASH', owner: { actorId: 'PRIVATE-ACTOR' } } },
        associations: { receipt: { deviceId: 'PRIVATE-DEVICE', owner: { playerId: 'PRIVATE-PLAYER' } } },
        reviews: { replay: { mappings: [{ parserPlayerId: 'RAW-IDENTITY', rosterPlayerId: 'PRIVATE-PLAYER' }] } },
      },
      engineAdapters: { replay: { match: { draft: { observations: ['PRIVATE-OBSERVATION'] } } }, ratings: { records: { one: { input: 'PRIVATE-RATING-INPUT' } } } },
      matches: [{ id: 'safe-match' }], settings: { teamName: 'RAAD' },
    };
    for (const role of ['coach', 'player'] as const) {
      const result = toPublicTrackerData(privateStores, role); const serialized = JSON.stringify(result);
      expect(result.matches).toEqual([{ id: 'safe-match' }]); expect(result).not.toHaveProperty('replayIntake'); expect(result).not.toHaveProperty('engineAdapters');
      for (const marker of ['TOKEN-HASH', 'PRIVATE-ACTOR', 'PRIVATE-DEVICE', 'PRIVATE-PLAYER', 'RAW-IDENTITY', 'PRIVATE-OBSERVATION', 'PRIVATE-RATING-INPUT']) expect(serialized).not.toContain(marker);
    }
  });
});

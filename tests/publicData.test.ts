import { afterEach, describe, expect, it } from 'vitest';
import { stripLegacySecrets, toPublicTrackerData } from '../lib/publicData';

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });

describe('public tracker data', () => {
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
    expect(JSON.stringify(coach)).not.toContain('ARCHIVED-KEY-HASH'); expect(JSON.stringify(coach)).not.toContain('private@example.com');
  });
});

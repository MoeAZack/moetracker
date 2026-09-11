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
});

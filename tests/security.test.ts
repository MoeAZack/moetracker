import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createKeySchema, settingsSchema } from '../schemas';
import { hashAccessKey } from '../lib/utils';

describe('security invariants', () => {
  it('only accepts defined access roles', () => {
    expect(createKeySchema.safeParse({ label: 'Player', role: 'player' }).success).toBe(true);
    expect(createKeySchema.safeParse({ label: 'Bypass', role: 'editor' }).success).toBe(false);
  });

  it('drops credential fields from settings updates', () => {
    const parsed = settingsSchema.parse({ teamName: 'RAAD', gridApiKey: 'do-not-store' });
    expect(parsed).toEqual({ teamName: 'RAAD' });
  });

  it('stores access-key digests instead of plaintext', () => {
    expect(hashAccessKey('RAAD-PLAY-1234')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAccessKey('RAAD-PLAY-1234')).not.toContain('RAAD-PLAY');
  });

  it('does not contain the removed published credentials', () => {
    const files = ['server.ts', '.env.example', 'lib/routes/integrations.ts'];
    const source = files.map((file) => fs.readFileSync(path.resolve(file), 'utf8')).join('\n');
    expect(source).not.toMatch(/ADMIN_PASSWORD\s*\|\|\s*['"]/);
    expect(source).not.toMatch(/JWT_SECRET\s*\|\|\s*['"]/);
    expect(source).not.toMatch(/GRID_API_KEY\s*\|\|\s*['"]/);
  });
});

import { describe, expect, it } from 'vitest';
import { createPlayerPasswordVerifier, verifyPlayerPassword } from '../lib/playerPassword';

describe('player password verifier', () => {
  it('uses a random salt and verifies without storing plaintext', async () => {
    const first = await createPlayerPasswordVerifier('xyz');
    const second = await createPlayerPasswordVerifier('xyz');
    expect(first).not.toEqual(second);
    expect(JSON.stringify(first)).not.toContain('xyz');
    expect(await verifyPlayerPassword('xyz', first)).toBe(true);
    expect(await verifyPlayerPassword('wrong', first)).toBe(false);
  });

  it('rejects malformed stored verifier material', async () => {
    expect(await verifyPlayerPassword('xyz', { passwordSalt: 'bad', passwordHash: 'bad' })).toBe(false);
  });
});

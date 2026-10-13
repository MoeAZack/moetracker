import crypto from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(crypto.scrypt);
const KEY_LENGTH = 32;

export async function createPlayerPasswordVerifier(password: string) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH) as Buffer;
  return { passwordSalt: salt.toString('base64'), passwordHash: derived.toString('base64') };
}

export async function verifyPlayerPassword(password: string, record: { passwordSalt?: unknown; passwordHash?: unknown }) {
  if (typeof record.passwordSalt !== 'string' || typeof record.passwordHash !== 'string') return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(record.passwordSalt, 'base64');
    expected = Buffer.from(record.passwordHash, 'base64');
  } catch { return false; }
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = await scryptAsync(password, salt, KEY_LENGTH) as Buffer;
  return crypto.timingSafeEqual(actual, expected);
}

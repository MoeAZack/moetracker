import express from 'express';
import crypto from 'crypto';
import { z } from 'zod';

// Unique ID helper.
export const uid = () => 'x' + Math.random().toString(36).substring(2, 10);

// Validate a request body against a Zod schema. On failure, sends a 400 and returns null,
// so callers do: `const body = validate(schema, req.body, res); if (!body) return;`
export function validate<T>(schema: z.ZodType<T>, body: any, res: express.Response): T | null {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    res.status(400).json({ error: 'Invalid request payload.', details: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`) });
    return null;
  }
  return result.data;
}

// Constant-time string comparison so token/password checks don't leak length or content via timing.
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Simple in-memory login rate limiter (per IP). Fine for a single-instance service.
const loginAttempts = new Map<string, { fails: number; lockedUntil: number }>();
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 10 * 60 * 1000;

export function clientIp(req: any): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
export function loginLockRemaining(ip: string): number {
  const rec = loginAttempts.get(ip);
  if (rec && rec.lockedUntil > Date.now()) return Math.ceil((rec.lockedUntil - Date.now()) / 1000);
  return 0;
}
export function loginRecordFail(ip: string) {
  const rec = loginAttempts.get(ip) || { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= LOGIN_MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOGIN_LOCK_MS;
    rec.fails = 0;
  }
  loginAttempts.set(ip, rec);
}
export function loginRecordSuccess(ip: string) {
  loginAttempts.delete(ip);
}

// Minimal in-memory TTL cache for slow third-party calls (VLR scraper, etc.).
const _cache = new Map<string, { expires: number; value: any }>();
export async function cached<T>(key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await producer();
  _cache.set(key, { expires: Date.now() + ttlMs, value });
  return value;
}

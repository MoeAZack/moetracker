import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

const DAILY_BYTES = Number(process.env.REPLAY_DAILY_BYTES || 8 * 1024 * 1024 * 1024);
const DAILY_FILES = Number(process.env.REPLAY_DAILY_FILES || 30);
const MAX_CONCURRENT_UPLOADS = Number(process.env.REPLAY_MAX_CONCURRENT_UPLOADS || 4);
const MAX_DEVICE_CONCURRENT_UPLOADS = Number(process.env.REPLAY_MAX_DEVICE_CONCURRENT_UPLOADS || 2);
const inFlightByDevice = new Map<string, { files: number; bytes: number }>();
let inFlightTotal = 0;

const safeEqual = (left: string, right: string) => left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));

export function reserveReplayUpload(deviceId: string, bytes: number, committedFiles: number, committedBytes: number, countsTowardDaily = true) {
  const current = inFlightByDevice.get(deviceId) || { files: 0, bytes: 0 };
  if (inFlightTotal >= MAX_CONCURRENT_UPLOADS) return { ok: false as const, status: 503, error: 'Replay intake is at its bounded concurrent upload limit.' };
  if (current.files >= MAX_DEVICE_CONCURRENT_UPLOADS || committedFiles + current.files + (countsTowardDaily ? 1 : 0) > DAILY_FILES || committedBytes + current.bytes + (countsTowardDaily ? bytes : 0) > DAILY_BYTES) return { ok: false as const, status: 429, error: 'This device reached its replay intake quota.' };
  inFlightTotal += 1; inFlightByDevice.set(deviceId, { files: current.files + 1, bytes: current.bytes + bytes }); let released = false;
  return { ok: true as const, release: () => {
    if (released) return; released = true; inFlightTotal -= 1;
    const latest = inFlightByDevice.get(deviceId); if (!latest || latest.files <= 1) inFlightByDevice.delete(deviceId); else inFlightByDevice.set(deviceId, { files: latest.files - 1, bytes: latest.bytes - bytes });
  } };
}

async function sha256File(file: string) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(); } }));
  return hash.digest('hex');
}

export async function publishVerifiedReplayTemp(tempPath: string, finalPath: string, expectedHash: string, expectedSize: number) {
  try {
    await fsp.link(tempPath, finalPath); await fsp.rm(tempPath, { force: true }); return true;
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const stat = await fsp.stat(finalPath); const actualHash = stat.size === expectedSize ? await sha256File(finalPath) : '';
    if (stat.size !== expectedSize || !safeEqual(actualHash, expectedHash)) throw Object.assign(new Error('Private replay destination conflicts with the verified upload.'), { status: 409 });
    await fsp.rm(tempPath, { force: true }); return false;
  }
}

export { sha256File as sha256ReplayFile };

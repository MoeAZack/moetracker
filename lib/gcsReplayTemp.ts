import crypto from 'crypto';
import { GoogleAuth } from 'google-auth-library';

const HEX_SHA256 = /^[a-f0-9]{64}$/;
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

export type RawReplayObject = { bucket: string; object: string; generation: string; size: number; sha256: string; uploadId: string; status: 'uploading' | 'verified' | 'processing' | 'parse-failed' | 'deleted'; expiresAt: string };

export function rawReplayConfig() {
  if (process.env.REPLAY_RAW_GCS_ENABLED !== 'true') throw Object.assign(new Error('Coach raw replay fallback is disabled.'), { code: 'raw-mode-disabled', status: 503 });
  const bucket = String(process.env.REPLAY_RAW_GCS_BUCKET || '').trim();
  if (!BUCKET.test(bucket)) throw Object.assign(new Error('REPLAY_RAW_GCS_BUCKET is not configured safely.'), { code: 'raw-mode-misconfigured', status: 503 });
  const ttlMinutes = Number(process.env.REPLAY_RAW_SESSION_TTL_MINUTES || 30);
  if (!Number.isSafeInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 60) throw Object.assign(new Error('REPLAY_RAW_SESSION_TTL_MINUTES must be 5–60.'), { code: 'raw-mode-misconfigured', status: 503 });
  return { bucket, ttlMinutes };
}

async function accessToken() {
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.read_write'] }).getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('GCS application credentials did not provide an access token.');
  return token.token;
}

async function gcsFetch(url: string, init: RequestInit = {}) {
  const token = await accessToken();
  return fetch(url, { ...init, redirect: 'error', headers: { ...init.headers, Authorization: `Bearer ${token}` } });
}

export async function initiateRawReplayUpload(input: { sha256: string; size: number; deviceId: string; originalName: string }) {
  if (!HEX_SHA256.test(input.sha256) || !Number.isSafeInteger(input.size) || input.size <= 0) throw new Error('Raw replay identity is invalid.');
  const config = rawReplayConfig(); const uploadId = crypto.randomUUID(); const object = `incoming/${input.sha256}.vrf`;
  const endpoint = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(config.bucket)}/o?uploadType=resumable&name=${encodeURIComponent(object)}&ifGenerationMatch=0`;
  const response = await gcsFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Upload-Content-Type': 'application/vnd.valorant.replay', 'X-Upload-Content-Length': String(input.size) }, body: JSON.stringify({ contentType: 'application/vnd.valorant.replay', metadata: { replaySha256: input.sha256, replaySize: String(input.size), deviceId: input.deviceId, uploadId, originalName: input.originalName } }) });
  const uploadUrl = response.headers.get('location');
  if (!response.ok || !uploadUrl?.startsWith('https://storage.googleapis.com/')) throw new Error('GCS did not create a resumable replay session.');
  return { uploadId, uploadUrl, bucket: config.bucket, object, expiresAt: new Date(Date.now() + config.ttlMinutes * 60_000).toISOString() };
}

export async function verifyRawReplayObject(input: { bucket: string; object: string; generation?: string; sha256: string; size: number; deviceId: string; uploadId: string }) {
  const metadataUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(input.bucket)}/o/${encodeURIComponent(input.object)}`;
  const metaResponse = await gcsFetch(metadataUrl);
  if (!metaResponse.ok) throw Object.assign(new Error('Uploaded raw replay object was not found.'), { status: 409 });
  const metadata: any = await metaResponse.json();
  if (!metadata.generation || (input.generation && metadata.generation !== input.generation)
    || Number(metadata.size) !== input.size || metadata.metadata?.replaySha256 !== input.sha256
    || metadata.metadata?.deviceId !== input.deviceId || metadata.metadata?.uploadId !== input.uploadId) throw Object.assign(new Error('Uploaded raw replay metadata or generation did not match the session.'), { status: 409 });
  const mediaUrl = `${metadataUrl}?alt=media&generation=${encodeURIComponent(metadata.generation)}`;
  const media = await gcsFetch(mediaUrl); if (!media.ok || !media.body) throw new Error('Uploaded raw replay could not be verified.');
  const digest = crypto.createHash('sha256'); let bytes = 0;
  for await (const chunk of media.body as any) { bytes += chunk.length; if (bytes > input.size) throw new Error('Uploaded raw replay exceeded its declared size.'); digest.update(chunk); }
  if (bytes !== input.size || digest.digest('hex') !== input.sha256) throw Object.assign(new Error('Uploaded raw replay failed SHA-256 verification.'), { status: 422 });
  return { generation: String(metadata.generation), verifiedAt: new Date().toISOString() };
}

export async function downloadRawReplayObject(record: RawReplayObject) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(record.bucket)}/o/${encodeURIComponent(record.object)}?alt=media&generation=${encodeURIComponent(record.generation)}`;
  const response = await gcsFetch(url); if (!response.ok || !response.body) throw new Error('Verified raw replay object is unavailable.'); return response;
}

export async function deleteRawReplayObject(record: RawReplayObject) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(record.bucket)}/o/${encodeURIComponent(record.object)}?ifGenerationMatch=${encodeURIComponent(record.generation)}`;
  const response = await gcsFetch(url, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error('Verified raw replay object could not be deleted.');
}

/** Cancels an unfinished resumable URI. The URI is a bearer credential: never log it. */
export async function cancelRawReplayUpload(uploadUrl: string) {
  if (!uploadUrl.startsWith('https://storage.googleapis.com/')) throw new Error('Unsafe resumable upload URL.');
  const response = await fetch(uploadUrl, { method: 'DELETE', redirect: 'error', headers: { 'Content-Length': '0' } });
  if (!response.ok && ![404, 410, 499].includes(response.status)) throw new Error(`GCS resumable cancellation failed with HTTP ${response.status}.`);
}

export const gcsReplayTempInternals = { rawReplayConfig };

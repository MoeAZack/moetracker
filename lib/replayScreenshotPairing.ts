import crypto from 'crypto';
import type { ScreenshotReviewDraft } from '../src/types';

export type ScreenshotPairing = {
  id: string; deviceId: string; imageSha256: string; createdAt: string; createdBy: string;
  status: 'pending' | 'linked' | 'ambiguous' | 'incomplete'; reviewRequired: true;
  draft: ScreenshotReviewDraft; replaySha256: string | null;
  suggestions: Array<{ parserPlayerId: string; displayName: string; rosterPlayerId: null }>;
  reason: string;
};
export const SCREENSHOT_LIMIT = 100;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const reject = (message: string, status = 400) => Object.assign(new Error(message), { status });

export function validatePairingImage(body: any) {
  if (typeof body?.deviceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(body.deviceId)) throw reject('Choose a collection device.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(body.mediaType)) throw reject('Use a PNG, JPEG, or WebP scoreboard.');
  if (typeof body.base64 !== 'string' || body.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw reject('Screenshot encoding or size is invalid.');
  const bytes = Buffer.from(body.base64, 'base64');
  if (bytes.toString('base64') !== body.base64) throw reject('Screenshot encoding is invalid.');
  const valid = body.mediaType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : body.mediaType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid || !bytes.length || bytes.length > MAX_IMAGE_BYTES) throw reject('Screenshot content does not match its image type or size limit.');
  return { deviceId: body.deviceId as string, base64: body.base64 as string, mediaType: body.mediaType as string, imageSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

export function screenshotRecordId(deviceId: string, hash: string) { return crypto.createHash('sha256').update(`${deviceId}\0${hash}`).digest('hex'); }
export function pruneScreenshotPairings(store: any, now = Date.now()) {
  store.screenshots ||= {};
  for (const [id, record] of Object.entries(store.screenshots) as Array<[string, ScreenshotPairing]>) {
    if (!Number.isFinite(Date.parse(record.createdAt)) || now - Date.parse(record.createdAt) > RETENTION_MS) delete store.screenshots[id];
  }
}
export function screenshotAdmission(store: any, deviceId: string, actorId: string, now = Date.now()) {
  const records = Object.values(store.screenshots || {}) as ScreenshotPairing[];
  if (records.length >= SCREENSHOT_LIMIT || records.filter(record => (record.deviceId === deviceId || record.createdBy === actorId) && now - Date.parse(record.createdAt) < 24 * 60 * 60 * 1000).length >= 20) throw reject('Screenshot review capacity reached. Try again after retained requests expire.', 429);
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const field = (value: any) => value?.status === 'available' ? value.value : null;
const mapName = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
function tuple(row: any) { return [row.kills, row.deaths, row.assists].every(integer) ? `${row.kills}/${row.deaths}/${row.assists}` : null; }

/** Recompute suggestions separately from immutable parser evidence and accepted coach overlays. */
export function pairReplayScreenshots(store: any) {
  const records = Object.values(store.screenshots || {}) as ScreenshotPairing[];
  for (const record of records) {
    if (record.deviceId === 'manual-entry') { record.replaySha256 = null; record.suggestions = []; record.status = 'pending'; record.reason = 'Screenshot ready. Complete the match manually when convenient.'; continue; }
    record.replaySha256 = null; record.suggestions = []; record.status = 'pending'; record.reason = 'Waiting for one matching replay from the selected device.';
    const { match, stats } = record.draft;
    const keys = stats.map(tuple);
    const hasMap = !!mapName(match.map); const hasScore = integer(match.ourScore) && integer(match.theirScore);
    const partialScore = integer(match.ourScore) !== integer(match.theirScore);
    if (partialScore || stats.length !== 10 || keys.some(key => key === null) || stats.some(row => !row.extractedName.trim() || row.extractedName.length > 80)) {
      record.status = 'incomplete'; record.reason = 'All ten named K/D/A rows are required. Map and final score may come from the replay.'; continue;
    }
    if (new Set(keys).size !== 10) { record.status = 'ambiguous'; record.reason = 'Duplicate K/D/A rows prevent a unique name mapping.'; continue; }
    const scores = hasScore ? [match.ourScore, match.theirScore].sort((a, b) => a! - b!).join(':') : null;
    const associated = new Set<string>(Object.values(store.associations || {}).filter((a: any) => a.deviceId === record.deviceId).map((a: any) => a.sha256));
    const candidates: Array<{ sha256: string; suggestions: ScreenshotPairing['suggestions'] }> = [];
    for (const sha256 of associated) {
      const blob = store.blobs?.[sha256]; const job = blob?.parserJobId ? store.parserJobs?.[blob.parserJobId] : null;
      if (blob?.ingestionMode !== 'local-evidence' || job?.status !== 'completed' || !job.sourceDeviceIds?.includes(record.deviceId)) continue;
      const board = job.result?.scoreboard;
      if (!board || board.evidenceCoverage?.status !== 'complete' || (hasMap && mapName(field(board.map)) !== mapName(match.map))) continue;
      const totals = [field(board.finalScore?.teamA?.score), field(board.finalScore?.teamB?.score)];
      if (!totals.every(integer) || (scores && totals.sort((a, b) => a - b).join(':') !== scores) || board.players?.length !== 10) continue;
      const rows = board.players.map((row: any) => ({ id: row.playerId, key: tuple({ kills: field(row.kills), deaths: field(row.deaths), assists: field(row.assists) }) }));
      if (rows.some((row: any) => !row.key || typeof row.id !== 'string' || !row.id) || new Set(rows.map((row: any) => row.key)).size !== 10 || new Set(rows.map((row: any) => row.id)).size !== 10 || rows.some((row: any) => !keys.includes(row.key))) continue;
      candidates.push({ sha256, suggestions: rows.map((row: any) => ({ parserPlayerId: row.id, displayName: stats[keys.indexOf(row.key)].extractedName.trim(), rosterPlayerId: null })) });
    }
    if (candidates.length > 1) { record.status = 'ambiguous'; record.reason = 'More than one replay matches. No names were assigned.'; }
    else if (candidates.length === 1) { record.status = 'linked'; record.reason = 'Unique scoreboard match. Coach review is still required.'; record.replaySha256 = candidates[0].sha256; record.suggestions = candidates[0].suggestions; }
  }
  // Two independently extracted screenshots must not silently propose conflicting identities.
  for (const record of records.filter(item => item.status === 'linked')) {
    const comparable = (item: ScreenshotPairing) => JSON.stringify([...item.suggestions].sort((a, b) => a.parserPlayerId.localeCompare(b.parserPlayerId)));
    if (records.some(other => other !== record && other.status === 'linked' && other.replaySha256 === record.replaySha256 && comparable(other) !== comparable(record))) {
      const conflicting = records.filter(other => other.status === 'linked' && other.replaySha256 === record.replaySha256);
      for (const other of conflicting) { other.status = 'ambiguous'; other.replaySha256 = null; other.suggestions = []; other.reason = 'Conflicting screenshot names require coach review. No names were assigned.'; }
    }
  }
}

export function screenshotPairingPublic(record: ScreenshotPairing) {
  const { createdBy: _privateActor, ...safe } = record;
  return safe;
}

import { localEvidenceDigest } from '../lib/replayEvidence';
import { VRFKIT_PIN } from '../lib/vrfkitReplayPipeline';

const origin = process.env.MOETRACKER_ORIGIN || 'https://moetracker-site.pages.dev';
const admin = process.env.MOETRACKER_ADMIN_PASSWORD;
if (!admin) throw new Error('MOETRACKER_ADMIN_PASSWORD is required.');

const json = async (path: string, init: RequestInit = {}) => {
  const response = await fetch(`${origin}${path}`, init);
  const body = await response.json() as any;
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${body?.error || 'unknown error'}`);
  return { response, body };
};

const coach = (await json('/api/login-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: admin }) })).body.key;
const authorized = { Authorization: `Bearer ${coach}`, 'Content-Type': 'application/json' };
const enrolled = (await json('/api/replay-intake/devices/enroll', { method: 'POST', headers: authorized, body: JSON.stringify({ name: 'Cloudflare evidence acceptance' }) })).body;
const deviceId = enrolled.device.id; const token = enrolled.credential.token; const sha256 = '9'.repeat(64);
const available = (value: number) => ({ value, status: 'available', source: 'release-smoke', confidence: 1 });
const normalized: any = {
  schemaVersion: 1,
  parserInput: { parser: { name: 'vrfkit', version: VRFKIT_PIN.version }, provenance: { replaySha256: sha256 }, file: { format: 'vrf', support: 'supported' }, identities: [{ playerId: 'a', teamId: 'red' }], summary: { roundCount: 1, finalScore: { teamA: 1, teamB: 0 }, players: [] }, rounds: [{ roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: ['a'], participantCoverage: { status: 'complete', expectedPlayerCount: 1 }, winnerTeamId: 'red', events: [] }], capabilities: [] },
  scoreboard: { reviewRequired: true, evidenceCoverage: { status: 'complete', reason: null }, map: { value: null, status: 'unavailable', source: 'release-smoke', confidence: null }, durationMs: available(1), finalScore: { teamA: { teamId: 'red', score: available(1) }, teamB: { teamId: 'blue', score: available(0) } }, players: [], unavailableFields: [] },
  diagnostics: { replaySha256: sha256, binarySha256: VRFKIT_PIN.windowsX64ExeSha256, binaryVersion: VRFKIT_PIN.version, binaryCommit: VRFKIT_PIN.commit, manifestSha256: 'f'.repeat(64), replayBuild: null, outputFileCount: 1, outputBytes: 1, identityMappingComplete: true, duplicateActorMappings: 0, duplicatePawnMappings: 0 },
};
const base: any = { schemaVersion: 1, source: { sha256, size: 100, originalName: 'release-smoke.vrf', deviceId }, parser: { name: 'vrfkit', version: VRFKIT_PIN.version, binarySha256: VRFKIT_PIN.windowsX64ExeSha256, binaryCommit: VRFKIT_PIN.commit }, normalized };
const envelope = { ...base, evidenceSha256: localEvidenceDigest(base) };
const accepted = await json(`/api/replay-intake/evidence/${sha256}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId, 'X-Device-Token': token }, body: JSON.stringify(envelope) });
await json('/api/replay-intake/devices/revoke', { method: 'POST', headers: authorized, body: JSON.stringify({ deviceId }) });
console.log(JSON.stringify({ status: accepted.response.status, ingestionMode: accepted.body.ingestionMode, parserStatus: accepted.body.parserStatus, reviewRequired: accepted.body.reviewRequired }));

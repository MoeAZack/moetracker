import crypto from 'crypto';
import { buildReplayOpeningReviewDraft } from './replayOpeningEngine';
import { validateVrfkitNormalizedResult, VRFKIT_PIN, type VrfkitNormalizedResult } from './vrfkitReplayPipeline';

const HEX_SHA256 = /^[a-f0-9]{64}$/;
export const MAX_LOCAL_EVIDENCE_BYTES = 4 * 1024 * 1024;

export type LocalReplayEvidenceEnvelope = {
  schemaVersion: 1;
  source: { sha256: string; size: number; originalName: string; deviceId: string };
  parser: { name: 'vrfkit'; version: '0.2.5'; binarySha256: string; binaryCommit: string };
  normalized: VrfkitNormalizedResult;
  evidenceSha256: string;
};

const canonical = (value: unknown): string => JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested);

export function localEvidenceDigest(envelope: Omit<LocalReplayEvidenceEnvelope, 'evidenceSha256'>) {
  return crypto.createHash('sha256').update(canonical(envelope)).digest('hex');
}

export function validateLocalReplayEvidence(raw: unknown, authenticatedDeviceId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Local replay evidence must be an object.');
  const input = raw as any;
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_LOCAL_EVIDENCE_BYTES) throw Object.assign(new Error('Local replay evidence exceeded its retained evidence limit.'), { status: 413 });
  if (input.schemaVersion !== 1 || !input.source || !input.parser || !input.normalized) throw new Error('Local replay evidence schema version 1 is required.');
  if (!HEX_SHA256.test(input.source.sha256) || !Number.isSafeInteger(input.source.size) || input.source.size <= 0) throw new Error('Local replay source identity is invalid.');
  if (input.source.deviceId !== authenticatedDeviceId) throw Object.assign(new Error('Local replay evidence is not bound to this device.'), { status: 403 });
  if (typeof input.source.originalName !== 'string' || input.source.originalName.length < 5 || input.source.originalName.length > 180) throw new Error('Local replay filename is invalid.');
  if (input.parser.name !== 'vrfkit' || input.parser.version !== VRFKIT_PIN.version
    || input.parser.binarySha256 !== VRFKIT_PIN.windowsX64ExeSha256 || input.parser.binaryCommit !== VRFKIT_PIN.commit) {
    throw new Error('Local replay evidence was not produced by the accepted parser artifact.');
  }
  const normalized = validateVrfkitNormalizedResult(input.normalized);
  if (normalized.diagnostics.replaySha256 !== input.source.sha256
    || normalized.parserInput.provenance?.replaySha256 !== input.source.sha256
    || normalized.scoreboard.reviewRequired !== true
    || normalized.diagnostics.binarySha256 !== input.parser.binarySha256
    || normalized.diagnostics.binaryVersion !== input.parser.version
    || normalized.diagnostics.binaryCommit !== input.parser.binaryCommit) throw new Error('Local replay evidence provenance does not match its source.');
  const withoutDigest = { schemaVersion: 1 as const, source: input.source, parser: input.parser, normalized };
  const expected = localEvidenceDigest(withoutDigest);
  if (!HEX_SHA256.test(input.evidenceSha256) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(input.evidenceSha256))) throw new Error('Local replay evidence checksum is invalid.');
  const retained = { scoreboard: normalized.scoreboard, reviewDraft: buildReplayOpeningReviewDraft(normalized.parserInput), diagnostics: normalized.diagnostics };
  if (Buffer.byteLength(JSON.stringify(retained)) > MAX_LOCAL_EVIDENCE_BYTES) throw Object.assign(new Error('Local replay evidence exceeded its retained evidence limit.'), { status: 413 });
  return { envelope: { ...withoutDigest, evidenceSha256: expected } as LocalReplayEvidenceEnvelope, retained };
}

export const replayEvidenceInternals = { canonical };

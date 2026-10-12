import { describe, expect, it } from 'vitest';
import { localEvidenceDigest, validateLocalReplayEvidence } from '../lib/replayEvidence';
import { VRFKIT_PIN } from '../lib/vrfkitReplayPipeline';

function fixture() {
  const sha256 = 'a'.repeat(64); const available = (value: number) => ({ value, status: 'available', source: 'fixture', confidence: 1 });
  const normalized: any = {
    schemaVersion: 1,
    parserInput: { parser: { name: 'vrfkit', version: '0.2.5' }, provenance: { replaySha256: sha256 }, file: { format: 'vrf', support: 'supported' }, identities: [{ playerId: 'a', teamId: 'red' }, { playerId: 'b', teamId: 'blue' }], summary: { roundCount: 1, finalScore: { teamA: 1, teamB: 0 }, players: [] }, rounds: [{ roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: ['a', 'b'], participantCoverage: { status: 'complete', expectedPlayerCount: 2 }, winnerTeamId: 'red', events: [] }], capabilities: [] },
    scoreboard: { reviewRequired: true, evidenceCoverage: { status: 'complete', reason: null }, map: { value: null, status: 'unavailable', source: 'fixture', confidence: null }, durationMs: available(100), finalScore: { teamA: { teamId: 'red', score: available(1) }, teamB: { teamId: 'blue', score: available(0) } }, players: [], unavailableFields: [] },
    diagnostics: { replaySha256: sha256, binarySha256: VRFKIT_PIN.windowsX64ExeSha256, binaryVersion: VRFKIT_PIN.version, binaryCommit: VRFKIT_PIN.commit, manifestSha256: 'b'.repeat(64), replayBuild: null, outputFileCount: 1, outputBytes: 10, identityMappingComplete: true, duplicateActorMappings: 0, duplicatePawnMappings: 0 },
  };
  const base: any = { schemaVersion: 1, source: { sha256, size: 123, originalName: 'match.vrf', deviceId: 'device-12345678' }, parser: { name: 'vrfkit', version: VRFKIT_PIN.version, binarySha256: VRFKIT_PIN.windowsX64ExeSha256, binaryCommit: VRFKIT_PIN.commit }, normalized };
  return { ...base, evidenceSha256: localEvidenceDigest(base) };
}

describe('local replay evidence boundary', () => {
  it('accepts pinned, source-bound evidence and always produces a review draft', () => {
    const checked = validateLocalReplayEvidence(fixture(), 'device-12345678');
    expect(checked.retained).toMatchObject({ scoreboard: { reviewRequired: true }, reviewDraft: { reviewRequired: true, writable: false } });
  });

  it('rejects another device and any post-signing mutation', () => {
    const evidence = fixture(); expect(() => validateLocalReplayEvidence(evidence, 'device-other123')).toThrow('bound to this device');
    evidence.source.size += 1; expect(() => validateLocalReplayEvidence(evidence, 'device-12345678')).toThrow('checksum');
  });
});

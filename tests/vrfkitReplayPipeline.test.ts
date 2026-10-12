import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runVrfkitReplayPipeline, validateVrfkitNormalizedResult, vrfkitPipelineInternals,
  type VrfkitPipelineConfig,
} from '../lib/vrfkitReplayPipeline';

const roots: string[] = [];
afterEach(async () => { while (roots.length) await fs.rm(roots.pop()!, { recursive: true, force: true }); });

async function tempRoot() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-vrfkit-')); roots.push(root); return root; }
async function hash(file: string) { return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'); }

function normalized(replaySha256: string, binarySha256: string, manifestSha256: string) {
  const available = (value: number, source = 'fixture') => ({ value, status: 'available', source, confidence: 1 });
  return {
    schemaVersion: 1,
    parserInput: {
      parser: { name: 'vrfkit', version: '0.2.5' }, provenance: { replaySha256 }, file: { format: 'vrf', support: 'supported' },
      identities: [{ playerId: 'a', teamId: 'team-red' }, { playerId: 'b', teamId: 'team-blue' }],
      summary: { roundCount: 1, finalScore: { teamA: 1, teamB: 0 }, players: [{ playerId: 'a', kills: 1, deaths: 0 }, { playerId: 'b', kills: 0, deaths: 1 }] },
      rounds: [{ roundNumber: 1, sequenceCompleteFromStart: true, participantPlayerIds: ['a', 'b'], participantCoverage: { status: 'complete', expectedPlayerCount: 2 }, winnerTeamId: 'team-red', events: [{ eventId: 'e1', roundNumber: 1, sequence: 1, timestampMs: 5, kind: 'player-elimination', killerPlayerId: 'a', victimPlayerId: 'b', killerTeamId: 'team-red', victimTeamId: 'team-blue', identityStatus: 'resolved' }] }],
      capabilities: [{ signal: 'eliminations', support: 'complete', grade: 'event-log' }, { signal: 'round-winner', support: 'complete', grade: 'event-log' }],
    },
    scoreboard: {
      reviewRequired: true,
      map: { value: null, status: 'unavailable', source: 'fixture', confidence: null }, durationMs: available(100),
      finalScore: { teamA: { teamId: 'team-red', score: available(1) }, teamB: { teamId: 'team-blue', score: available(0) } },
      players: [], unavailableFields: ['map.friendlyName'],
    },
    diagnostics: { replaySha256, binarySha256, binaryVersion: '0.2.5', binaryCommit: 'c4d6cc0e5ec3904fdb64b350b2656b8e3ff33d53', manifestSha256, replayBuild: 'fixture', outputFileCount: 0, outputBytes: 0 },
  };
}

describe('pinned vrfkit pipeline', () => {
  it('runs without a shell, verifies both hashes, and accepts only bounded normalized review evidence', async () => {
    const root = await tempRoot(); const replay = path.join(root, 'match.vrf'); await fs.writeFile(replay, 'fixture replay');
    const parser = path.join(root, 'fake-parser.mjs');
    await fs.writeFile(parser, `import fs from 'fs'; import path from 'path'; const out=process.argv[process.argv.indexOf('--out')+1]; fs.writeFileSync(path.join(out,'manifest.json'), JSON.stringify({replay_build:'fixture'}));`);
    const normalizer = path.join(root, 'fake-normalizer.mjs');
    await fs.writeFile(normalizer, `import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; const get=x=>process.argv[process.argv.indexOf(x)+1]; const manifest=path.join(get('--export'),'manifest.json'); const mh=crypto.createHash('sha256').update(fs.readFileSync(manifest)).digest('hex'); const data=${JSON.stringify(normalized('REPLAY', 'BINARY', 'MANIFEST'))}; data.diagnostics.replaySha256=get('--replay-sha256'); data.diagnostics.binarySha256=get('--binary-sha256'); data.diagnostics.manifestSha256=mh; fs.writeFileSync(get('--out'),JSON.stringify(data));`);
    const binarySha256 = await hash(process.execPath); const replaySha256 = await hash(replay);
    const config: VrfkitPipelineConfig = {
      binaryPath: process.execPath, binarySha256, binaryArgsPrefix: [parser], pythonPath: process.execPath,
      pythonArgsPrefix: [normalizer], normalizerPath: normalizer, jobsRoot: path.join(root, 'jobs'),
      timeoutMs: 5_000, maxOutputBytes: 2 * 1024 * 1024, maxOutputFiles: 8,
    };
    const completed = await runVrfkitReplayPipeline(replay, replaySha256, config);
    expect(completed.result).toMatchObject({ schemaVersion: 1, scoreboard: { reviewRequired: true }, diagnostics: { replaySha256, binarySha256 } });
    expect(completed.result.scoreboard.finalScore.teamB.score).toMatchObject({ value: 0, status: 'available' });
    await expect(runVrfkitReplayPipeline(replay, replaySha256, { ...config, binarySha256: '0'.repeat(64) })).rejects.toThrow('pinned SHA-256');
  });

  it('rejects output traversal primitives and output beyond configured limits', async () => {
    const root = await tempRoot(); await fs.mkdir(path.join(root, 'nested')); await fs.writeFile(path.join(root, 'nested', 'large.bin'), Buffer.alloc(32));
    await expect(vrfkitPipelineInternals.measureTree(root, 5, 16)).rejects.toThrow('size limit');
    expect(vrfkitPipelineInternals.inside(root, path.join(root, 'safe'))).toBe(true);
    expect(vrfkitPipelineInternals.inside(root, path.resolve(root, '..', 'escaped'))).toBe(false);
  });

  it('keeps unavailable evidence null instead of turning it into a plausible zero', () => {
    const raw = normalized('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64));
    raw.scoreboard.durationMs = { value: null, status: 'unavailable', source: 'fixture', confidence: null } as any;
    const checked = validateVrfkitNormalizedResult(raw);
    expect(checked.scoreboard.durationMs).toEqual({ value: null, status: 'unavailable', source: 'fixture', confidence: null });
  });
});

import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadVrfkitPipelineConfig, runVrfkitReplayPipeline, validateVrfkitNormalizedResult, vrfkitPipelineInternals,
  type VrfkitPipelineConfig,
} from '../lib/vrfkitReplayPipeline';
import { buildReplayOpeningReviewDraft } from '../lib/replayOpeningEngine';

const roots: string[] = [];
afterEach(async () => { while (roots.length) await fs.rm(roots.pop()!, { recursive: true, force: true }); });

async function tempRoot() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-vrfkit-')); roots.push(root); return root; }
async function hash(file: string) { return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'); }

async function fakeConfig(root: string, parserSource: string, normalizerSource?: string, overrides: Partial<VrfkitPipelineConfig> = {}) {
  const replay = path.join(root, 'match.vrf'); await fs.writeFile(replay, 'fixture replay');
  const parser = path.join(root, 'fake-parser.mjs'); await fs.writeFile(parser, parserSource);
  const normalizer = path.join(root, 'fake-normalizer.mjs');
  await fs.writeFile(normalizer, normalizerSource || 'process.exit(2)');
  const config: VrfkitPipelineConfig = {
    binaryPath: process.execPath, binarySha256: await hash(process.execPath), binaryArgsPrefix: [parser],
    pythonPath: process.execPath, pythonArgsPrefix: [normalizer], normalizerPath: normalizer,
    jobsRoot: path.join(root, 'jobs'), timeoutMs: 5_000, maxOutputBytes: 16 * 1024 * 1024,
    maxOutputFiles: 8, testOnlyAllowUnpinnedBinary: true, ...overrides,
  };
  return { replay, replaySha256: await hash(replay), config };
}

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
      evidenceCoverage: { status: 'complete', reason: null },
      map: { value: null, status: 'unavailable', source: 'fixture', confidence: null }, durationMs: available(100),
      finalScore: { teamA: { teamId: 'team-red', score: available(1) }, teamB: { teamId: 'team-blue', score: available(0) } },
      players: [], unavailableFields: ['map.friendlyName'],
    },
    diagnostics: { replaySha256, binarySha256, binaryVersion: '0.2.5', binaryCommit: 'c4d6cc0e5ec3904fdb64b350b2656b8e3ff33d53', manifestSha256, replayBuild: 'fixture', outputFileCount: 0, outputBytes: 0, identityMappingComplete: true, duplicateActorMappings: 0, duplicatePawnMappings: 0 },
  };
}

describe('pinned vrfkit pipeline', () => {
  it('runs without a shell, verifies both hashes, and accepts only bounded normalized review evidence', async () => {
    const root = await tempRoot(); const replay = path.join(root, 'match.vrf'); await fs.writeFile(replay, 'fixture replay');
    const parser = path.join(root, 'fake-parser.mjs');
    await fs.writeFile(parser, `import fs from 'fs'; import path from 'path'; const out=process.argv[process.argv.indexOf('--out')+1]; fs.writeFileSync(path.join(out,'manifest.json'), JSON.stringify({replay_build:'fixture'}));`);
    const normalizer = path.join(root, 'fake-normalizer.mjs');
    await fs.writeFile(normalizer, `import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; const get=x=>process.argv[process.argv.indexOf(x)+1]; const manifest=path.join(get('--export'),'manifest.json'); const mh=crypto.createHash('sha256').update(fs.readFileSync(manifest)).digest('hex'); const data=${JSON.stringify(normalized('REPLAY', 'BINARY', 'MANIFEST'))}; data.parserInput.provenance.replaySha256=get('--replay-sha256'); data.diagnostics.replaySha256=get('--replay-sha256'); data.diagnostics.binarySha256=get('--binary-sha256'); data.diagnostics.manifestSha256=mh; fs.writeFileSync(get('--out'),JSON.stringify(data));`);
    const binarySha256 = await hash(process.execPath); const replaySha256 = await hash(replay);
    const config: VrfkitPipelineConfig = {
      binaryPath: process.execPath, binarySha256, binaryArgsPrefix: [parser], pythonPath: process.execPath,
      pythonArgsPrefix: [normalizer], normalizerPath: normalizer, jobsRoot: path.join(root, 'jobs'),
      timeoutMs: 5_000, maxOutputBytes: 2 * 1024 * 1024, maxOutputFiles: 8,
      testOnlyAllowUnpinnedBinary: true,
    };
    const completed = await runVrfkitReplayPipeline(replay, replaySha256, config);
    expect(completed.result).toMatchObject({ schemaVersion: 1, scoreboard: { reviewRequired: true }, diagnostics: { replaySha256, binarySha256 } });
    await expect(fs.stat(path.join(root, 'jobs', completed.jobId))).rejects.toMatchObject({ code: 'ENOENT' });
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

  it('passes only the explicit OS allowlist to parser children', async () => {
    const root = await tempRoot(); const script = path.join(root, 'env.mjs'); const output = path.join(root, 'seen.json');
    await fs.writeFile(script, `import fs from 'fs'; fs.writeFileSync(${JSON.stringify(output)}, JSON.stringify({secret:process.env.MOETRACKER_SERVER_SECRET, keys:Object.keys(process.env)}));`);
    process.env.MOETRACKER_SERVER_SECRET = 'must-not-cross-boundary';
    try {
      const config = { timeoutMs: 2_000, maxOutputBytes: 1024 * 1024, maxOutputFiles: 8 } as VrfkitPipelineConfig;
      await vrfkitPipelineInternals.runBounded(process.execPath, [script], root, root, config);
      const seen = JSON.parse(await fs.readFile(output, 'utf8'));
      expect(seen.secret).toBeUndefined();
      expect(seen.keys).not.toContain('MOETRACKER_SERVER_SECRET');
    } finally { delete process.env.MOETRACKER_SERVER_SECRET; }
  });

  it('kills the entire timed-out parser process tree before returning', async () => {
    const root = await tempRoot(); const script = path.join(root, 'tree.mjs'); const pidFile = path.join(root, 'descendant.pid');
    await fs.writeFile(script, `import fs from 'fs'; import {spawn} from 'child_process'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); setInterval(()=>{},1000);`);
    const config = { timeoutMs: 350, maxOutputBytes: 1024 * 1024, maxOutputFiles: 8 } as VrfkitPipelineConfig;
    await expect(vrfkitPipelineInternals.runBounded(process.execPath, [script], root, root, config)).rejects.toThrow('timed out');
    const pid = Number(await fs.readFile(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(fs.rm(root, { recursive: true })).resolves.toBeUndefined();
    roots.splice(roots.indexOf(root), 1);
  }, 15_000);

  it('rejects fast oversized and reparse-point exports during mandatory final validation', async () => {
    const oversizedRoot = await tempRoot();
    const oversized = await fakeConfig(oversizedRoot, `import fs from 'fs'; import path from 'path'; const out=process.argv[process.argv.indexOf('--out')+1]; fs.writeFileSync(path.join(out,'manifest.json'),'{}'); fs.writeFileSync(path.join(out,'large.bin'),Buffer.alloc(4096));`, undefined, { maxOutputBytes: 1024 });
    await expect(runVrfkitReplayPipeline(oversized.replay, oversized.replaySha256, oversized.config)).rejects.toThrow('size limit');

    const linkRoot = await tempRoot(); const external = path.join(linkRoot, 'outside'); await fs.mkdir(external); await fs.writeFile(path.join(external, 'private.txt'), 'outside');
    const linked = await fakeConfig(linkRoot, `import fs from 'fs'; import path from 'path'; const out=process.argv[process.argv.indexOf('--out')+1]; fs.writeFileSync(path.join(out,'manifest.json'),'{}'); fs.symlinkSync(${JSON.stringify(external)},path.join(out,'escape'),'junction');`);
    await expect(runVrfkitReplayPipeline(linked.replay, linked.replaySha256, linked.config)).rejects.toThrow(/symbolic links|reparse points|realpath escapes/);
  });

  it('caps normalized JSON before reading and cleans the private job directory on failure', async () => {
    const root = await tempRoot();
    const fixture = await fakeConfig(root,
      `import fs from 'fs'; import path from 'path'; const out=process.argv[process.argv.indexOf('--out')+1]; fs.writeFileSync(path.join(out,'manifest.json'),'{}');`,
      `import fs from 'fs'; const get=x=>process.argv[process.argv.indexOf(x)+1]; fs.writeFileSync(get('--out'),'x'.repeat(9*1024*1024));`);
    await expect(runVrfkitReplayPipeline(fixture.replay, fixture.replaySha256, fixture.config)).rejects.toThrow('pre-read size limit');
    expect(await fs.readdir(fixture.config.jobsRoot)).toEqual([]);
  });

  it('rejects unpinned production configuration and false parser provenance', async () => {
    const previousNodeEnv = process.env.NODE_ENV; const previousHash = process.env.VRFKIT_BINARY_SHA256; const previousOverride = process.env.VRFKIT_TEST_ALLOW_UNPINNED_BINARY;
    process.env.NODE_ENV = 'production'; process.env.VRFKIT_BINARY_SHA256 = '0'.repeat(64); process.env.VRFKIT_TEST_ALLOW_UNPINNED_BINARY = 'true';
    try { expect(() => loadVrfkitPipelineConfig(path.resolve('private-test'))).toThrow('accepted vrfkit v0.2.5'); }
    finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousHash === undefined) delete process.env.VRFKIT_BINARY_SHA256; else process.env.VRFKIT_BINARY_SHA256 = previousHash;
      if (previousOverride === undefined) delete process.env.VRFKIT_TEST_ALLOW_UNPINNED_BINARY; else process.env.VRFKIT_TEST_ALLOW_UNPINNED_BINARY = previousOverride;
    }

    const root = await tempRoot(); const replay = path.join(root, 'match.vrf'); await fs.writeFile(replay, 'fixture replay');
    const parser = path.join(root, 'parser.mjs'); await fs.writeFile(parser, `import fs from 'fs'; import path from 'path'; const out=process.argv[process.argv.indexOf('--out')+1]; fs.writeFileSync(path.join(out,'manifest.json'),'{}');`);
    const normalizer = path.join(root, 'normalizer.mjs');
    await fs.writeFile(normalizer, `import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; const get=x=>process.argv[process.argv.indexOf(x)+1]; const m=path.join(get('--export'),'manifest.json'); const d=${JSON.stringify(normalized('R','B','M'))}; d.parserInput.provenance.replaySha256=get('--replay-sha256'); d.diagnostics.replaySha256=get('--replay-sha256'); d.diagnostics.binarySha256=get('--binary-sha256'); d.diagnostics.binaryVersion='0.2.4'; d.diagnostics.manifestSha256=crypto.createHash('sha256').update(fs.readFileSync(m)).digest('hex'); fs.writeFileSync(get('--out'),JSON.stringify(d));`);
    const config: VrfkitPipelineConfig = { binaryPath: process.execPath, binarySha256: await hash(process.execPath), binaryArgsPrefix: [parser], pythonPath: process.execPath, pythonArgsPrefix: [normalizer], normalizerPath: normalizer, jobsRoot: path.join(root, 'jobs'), timeoutMs: 2_000, maxOutputBytes: 1024 * 1024, maxOutputFiles: 8, testOnlyAllowUnpinnedBinary: true };
    await expect(runVrfkitReplayPipeline(replay, await hash(replay), config)).rejects.toThrow('provenance');
  });

  it('rejects colliding pawn mappings and suppresses identity-dependent zeroes and conclusions', async () => {
    const normalizerPath = path.resolve('scripts', 'normalize-vrfkit-export.py');
    const probe = `import sys,types,importlib.util,json; sys.dont_write_bytecode=True; p=types.ModuleType('pyarrow'); q=types.ModuleType('pyarrow.parquet'); p.parquet=q; sys.modules['pyarrow']=p; sys.modules['pyarrow.parquet']=q; s=importlib.util.spec_from_file_location('n',r'''${normalizerPath}'''); n=importlib.util.module_from_spec(s); s.loader.exec_module(n); c=n.index_manifest_players([{'actor_net_guid':1,'character_net_guid':99,'subject':'one'},{'actor_net_guid':2,'character_net_guid':99,'subject':'two'}],'a'*64); print(json.dumps({'attack':n.accepted_side_pair('a','b','attacker'),'defense':n.accepted_side_pair('a','b','defender'),'rosterComplete':n.trusted_manifest_roster_is_complete(True,False,set(),[],set(),[],{}, {},'a'*64),'collisionValid':c['mapping_valid'],'collidingPawnRetained':99 in c['pawn_to_player'],'duplicatePawns':c['duplicate_pawn_count']}))`;
    const result = spawnSync('python', ['-c', probe], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      attack: { a: 'attack', b: 'defense' }, defense: { a: 'defense', b: 'attack' },
      rosterComplete: false, collisionValid: false, collidingPawnRetained: false, duplicatePawns: 1,
    });

    const raw: any = normalized('a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64));
    raw.diagnostics.identityMappingComplete = false; raw.diagnostics.duplicatePawnMappings = 1;
    raw.scoreboard.evidenceCoverage = { status: 'incomplete', reason: 'colliding pawn mapping' };
    raw.parserInput.file.support = 'incomplete'; raw.parserInput.rounds[0].sequenceCompleteFromStart = false;
    raw.parserInput.rounds[0].participantCoverage = { status: 'partial', expectedPlayerCount: 2 };
    raw.parserInput.capabilities[0].support = 'unsupported';
    const unavailable = { value: null, status: 'unavailable', source: 'invalid identity mapping', confidence: null };
    raw.scoreboard.players = [{ playerId: 'a', teamId: 'team-red', firstBloods: unavailable, firstDeaths: unavailable, plants: unavailable, defuses: unavailable }];
    const checked = validateVrfkitNormalizedResult(raw);
    expect(checked.scoreboard.players[0].firstBloods).toMatchObject({ value: null, status: 'unavailable' });
    const draft = buildReplayOpeningReviewDraft(checked.parserInput);
    expect(draft.rounds[0]).toMatchObject({ status: 'unknown' });
    expect(draft.evidence.rounds[0].derived).toMatchObject({ tradeOpportunities: null, successfulTrades: null, clutches: null });
    raw.scoreboard.players[0].firstBloods = { value: 0, status: 'available', source: 'unsafe', confidence: 1 };
    expect(() => validateVrfkitNormalizedResult(raw)).toThrow('identity-dependent replay conclusions');
  });

  it('pairs and de-duplicates only fully resolved typed orb-pickup RPCs', () => {
    const normalizerPath = path.resolve('scripts', 'normalize-vrfkit-export.py');
    const probe = `import sys,types,importlib.util,json; sys.dont_write_bytecode=True; p=types.ModuleType('pyarrow'); q=types.ModuleType('pyarrow.parquet'); p.parquet=q; sys.modules['pyarrow']=p; sys.modules['pyarrow.parquet']=q; s=importlib.util.spec_from_file_location('n',r'''${normalizerPath}'''); n=importlib.util.module_from_spec(s); s.loader.exec_module(n); rows=[]\nfor packet in (10,11):\n rows += [{'time_ms':100,'packet_id':packet,'actor_net_guid':7,'field_name':'OrbPickedUpRPC.Orb Gatherer','value_i64':99},{'time_ms':100,'packet_id':packet,'actor_net_guid':7,'field_name':'OrbPickedUpRPC.Collectable Orb','value_i64':123}]\nok,c=n.verified_orb_captures(rows,{99:'player-a'},lambda _:1,True); bad,_=n.verified_orb_captures(rows,{},lambda _:1,True); print(json.dumps({'ok':ok,'captures':c,'bad':bad}))`;
    const result = spawnSync('python', ['-c', probe], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, captures: [[100, 7, 99, 123, 1]], bad: false });
  });
});

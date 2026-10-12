import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import type { ReplayParserDraftInput } from './replayOpeningEngine';

export const VRFKIT_PIN = {
  tag: 'v0.2.5',
  version: '0.2.5',
  commit: 'c4d6cc0e5ec3904fdb64b350b2656b8e3ff33d53',
  windowsX64ZipSha256: '2cf8375191f7de8b8199f84a69e91a02e5e4d5b541c242e466c9d9aa24ef7494',
  windowsX64ExeSha256: 'aa55fc410f1596a6ffedc7ab579341da6edb262197c64902e74b4eed485dc23f',
} as const;

const HEX_SHA256 = /^[a-f0-9]{64}$/;
const MAX_STDIO_BYTES = 64 * 1024;

export type EvidenceValue<T> = {
  value: T | null;
  status: 'available' | 'unavailable';
  source: string;
  confidence: number | null;
};

export type ReplayScoreboardPlayer = {
  playerId: string;
  displayName: EvidenceValue<string>;
  teamId: string;
  kills: EvidenceValue<number>;
  deaths: EvidenceValue<number>;
  assists: EvidenceValue<number>;
  firstBloods: EvidenceValue<number>;
  firstDeaths: EvidenceValue<number>;
  plants: EvidenceValue<number>;
  defuses: EvidenceValue<number>;
};

export type VrfkitNormalizedResult = {
  schemaVersion: 1;
  parserInput: ReplayParserDraftInput;
  scoreboard: {
    reviewRequired: true;
    map: EvidenceValue<string> & { assetPath?: string | null };
    durationMs: EvidenceValue<number>;
    finalScore: {
      teamA: { teamId: string; score: EvidenceValue<number> };
      teamB: { teamId: string; score: EvidenceValue<number> };
    };
    players: ReplayScoreboardPlayer[];
    unavailableFields: string[];
  };
  diagnostics: {
    replaySha256: string;
    binarySha256: string;
    binaryVersion: string;
    binaryCommit: string;
    manifestSha256: string;
    replayBuild: string | null;
    outputFileCount: number;
    outputBytes: number;
  };
};

export type VrfkitPipelineConfig = {
  binaryPath: string;
  binarySha256: string;
  pythonPath: string;
  normalizerPath: string;
  jobsRoot: string;
  timeoutMs: number;
  maxOutputBytes: number;
  maxOutputFiles: number;
  binaryArgsPrefix?: string[];
  pythonArgsPrefix?: string[];
};

type RunResult = { exitCode: number; stdout: string; stderr: string };

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function absoluteConfiguredPath(value: string | undefined, label: string) {
  if (!value) throw Object.assign(new Error(`${label} is not configured.`), { code: 'parser-unavailable' });
  if (!path.isAbsolute(value)) throw Object.assign(new Error(`${label} must be an absolute path.`), { code: 'parser-misconfigured' });
  return path.resolve(value);
}

export function loadVrfkitPipelineConfig(privateStorageRoot: string): VrfkitPipelineConfig {
  const binarySha256 = String(process.env.VRFKIT_BINARY_SHA256 || VRFKIT_PIN.windowsX64ExeSha256).toLowerCase();
  if (!HEX_SHA256.test(binarySha256)) throw Object.assign(new Error('VRFKIT_BINARY_SHA256 must be a SHA-256 digest.'), { code: 'parser-misconfigured' });
  const jobsRoot = path.resolve(process.env.VRFKIT_JOBS_DIR || path.join(privateStorageRoot, '.parser-jobs'));
  const relative = path.relative(path.resolve(privateStorageRoot), jobsRoot);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Object.assign(new Error('VRFKIT_JOBS_DIR must be a private child of REPLAY_STORAGE_DIR.'), { code: 'parser-misconfigured' });
  return {
    binaryPath: absoluteConfiguredPath(process.env.VRFKIT_BINARY_PATH, 'VRFKIT_BINARY_PATH'),
    binarySha256,
    pythonPath: absoluteConfiguredPath(process.env.VRFKIT_PYTHON_PATH, 'VRFKIT_PYTHON_PATH'),
    normalizerPath: path.resolve(process.cwd(), 'scripts', 'normalize-vrfkit-export.py'),
    jobsRoot,
    timeoutMs: positiveInteger(process.env.VRFKIT_PARSE_TIMEOUT_MS, 5 * 60 * 1000),
    maxOutputBytes: positiveInteger(process.env.VRFKIT_MAX_OUTPUT_BYTES, 768 * 1024 * 1024),
    maxOutputFiles: positiveInteger(process.env.VRFKIT_MAX_OUTPUT_FILES, 32),
  };
}

async function sha256File(file: string) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash as any);
  return hash.digest('hex');
}

function inside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function measureTree(root: string, maxFiles: number, maxBytes: number) {
  let files = 0; let bytes = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const target = path.resolve(directory, entry.name);
      if (!inside(root, target)) throw new Error('Parser output escaped its job directory.');
      if (entry.isSymbolicLink()) throw new Error('Parser output may not contain symbolic links.');
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        files += 1; bytes += (await fsp.stat(target)).size;
        if (files > maxFiles) throw new Error('Parser output exceeded its file-count limit.');
        if (bytes > maxBytes) throw new Error('Parser output exceeded its size limit.');
      } else throw new Error('Parser output contains an unsupported filesystem entry.');
    }
  };
  await visit(root);
  return { files, bytes };
}

function appendBounded(current: string, chunk: Buffer) {
  const combined = Buffer.concat([Buffer.from(current), chunk]);
  return combined.subarray(Math.max(0, combined.length - MAX_STDIO_BYTES)).toString('utf8');
}

async function runBounded(command: string, args: string[], cwd: string, outputRoot: string, config: VrfkitPipelineConfig): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false; let measuring = false;
    child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
    const stop = (error: Error) => {
      if (settled) return; settled = true; child.kill('SIGKILL'); clearInterval(monitor); clearTimeout(timeout); reject(error);
    };
    const timeout = setTimeout(() => stop(new Error('Replay parser timed out.')), config.timeoutMs);
    const monitor = setInterval(async () => {
      if (measuring || settled) return; measuring = true;
      try { await measureTree(outputRoot, config.maxOutputFiles, config.maxOutputBytes); } catch (error: any) { stop(error); } finally { measuring = false; }
    }, 250);
    child.on('error', error => stop(new Error(`Replay parser could not start: ${error.message}`)));
    child.on('close', code => {
      if (settled) return; settled = true; clearInterval(monitor); clearTimeout(timeout);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

function scalarObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function evidenceNumber(value: any) { return scalarObject(value) && ['available', 'unavailable'].includes(String(value.status)) && (value.value === null || (Number.isSafeInteger(value.value) && Number(value.value) >= 0)); }

export function validateVrfkitNormalizedResult(raw: any): VrfkitNormalizedResult {
  if (!scalarObject(raw) || raw.schemaVersion !== 1 || !scalarObject(raw.parserInput) || !scalarObject(raw.scoreboard) || !scalarObject(raw.diagnostics)) throw new Error('Normalizer output does not match schema version 1.');
  const data = raw as any;
  if (data.parserInput?.parser?.name !== 'vrfkit' || data.parserInput?.parser?.version !== VRFKIT_PIN.version || data.parserInput?.file?.format !== 'vrf') throw new Error('Normalizer output has an unexpected parser identity.');
  if (!Array.isArray(data.parserInput.identities) || !Array.isArray(data.parserInput.rounds) || !Array.isArray(data.scoreboard.players)) throw new Error('Normalizer output is missing identities, rounds, or scoreboard players.');
  if (data.parserInput.identities.length > 32 || data.parserInput.rounds.length > 100 || data.scoreboard.players.length > 32) throw new Error('Normalizer output exceeded structural limits.');
  if (!evidenceNumber(data.scoreboard.durationMs) || !evidenceNumber(data.scoreboard.finalScore?.teamA?.score) || !evidenceNumber(data.scoreboard.finalScore?.teamB?.score)) throw new Error('Normalizer scoreboard contains invalid numeric evidence.');
  const encoded = Buffer.byteLength(JSON.stringify(raw));
  if (encoded > 8 * 1024 * 1024) throw new Error('Normalizer JSON exceeded its size limit.');
  return structuredClone(raw) as VrfkitNormalizedResult;
}

export async function runVrfkitReplayPipeline(replayPath: string, replaySha256: string, config: VrfkitPipelineConfig) {
  if (!HEX_SHA256.test(replaySha256)) throw new Error('Replay SHA-256 is invalid.');
  const [binaryStat, normalizerStat] = await Promise.all([fsp.stat(config.binaryPath), fsp.stat(config.normalizerPath)]);
  if (!binaryStat.isFile() || !normalizerStat.isFile()) throw new Error('Configured parser or normalizer is not a regular file.');
  const actualBinaryHash = await sha256File(config.binaryPath);
  if (actualBinaryHash !== config.binarySha256) throw new Error('Configured vrfkit binary failed its pinned SHA-256 check.');
  const actualReplayHash = await sha256File(replayPath);
  if (actualReplayHash !== replaySha256) throw new Error('Private replay failed integrity verification before parsing.');

  await fsp.mkdir(config.jobsRoot, { recursive: true, mode: 0o700 });
  const jobId = `${replaySha256}-${crypto.randomUUID()}`;
  const jobDir = path.resolve(config.jobsRoot, jobId); const exportDir = path.resolve(jobDir, 'export'); const normalizedPath = path.resolve(jobDir, 'normalized.json');
  if (![jobDir, exportDir, normalizedPath].every(target => inside(config.jobsRoot, target))) throw new Error('Parser job path escaped its private root.');
  await fsp.mkdir(jobDir, { recursive: false, mode: 0o700 });
  await fsp.mkdir(exportDir, { recursive: false, mode: 0o700 });

  const exportArgs = [...(config.binaryArgsPrefix || []), 'export', replayPath, '--out', exportDir, '--checkpoints'];
  const exported = await runBounded(config.binaryPath, exportArgs, jobDir, jobDir, config);
  if (exported.exitCode !== 0) throw new Error(`vrfkit export failed (${exported.exitCode}): ${exported.stderr.trim().slice(-500) || 'no diagnostic'}`);
  const manifestPath = path.resolve(exportDir, 'manifest.json');
  if (!inside(jobDir, manifestPath) || !(await fsp.stat(manifestPath)).isFile()) throw new Error('vrfkit did not produce a manifest.');
  const manifestSha256 = await sha256File(manifestPath);

  const normalized = await runBounded(config.pythonPath, [
    ...(config.pythonArgsPrefix || []), config.normalizerPath,
    '--export', exportDir, '--out', normalizedPath, '--replay-sha256', replaySha256,
    '--binary-sha256', actualBinaryHash, '--binary-version', VRFKIT_PIN.version, '--binary-commit', VRFKIT_PIN.commit,
  ], jobDir, jobDir, config);
  if (normalized.exitCode !== 0) throw new Error(`vrfkit evidence normalization failed (${normalized.exitCode}): ${normalized.stderr.trim().slice(-500) || 'no diagnostic'}`);
  if (!inside(jobDir, normalizedPath) || !(await fsp.stat(normalizedPath)).isFile()) throw new Error('Normalizer did not produce its bounded JSON result.');
  const tree = await measureTree(jobDir, config.maxOutputFiles, config.maxOutputBytes);
  const result = validateVrfkitNormalizedResult(JSON.parse(await fsp.readFile(normalizedPath, 'utf8')));
  if (result.diagnostics.replaySha256 !== replaySha256 || result.diagnostics.binarySha256 !== actualBinaryHash || result.diagnostics.manifestSha256 !== manifestSha256) throw new Error('Normalizer provenance does not match the verified parser inputs.');
  result.diagnostics.outputFileCount = tree.files; result.diagnostics.outputBytes = tree.bytes;
  return { jobId, jobDir, result };
}

export const vrfkitPipelineInternals = { sha256File, measureTree, inside, runBounded };

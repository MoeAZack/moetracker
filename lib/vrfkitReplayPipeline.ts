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
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_NORMALIZED_BYTES = 8 * 1024 * 1024;
const MAX_BINARY_BYTES = 128 * 1024 * 1024;
const MAX_REPLAY_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_NORMALIZER_SOURCE_BYTES = 1024 * 1024;
const PROCESS_EXIT_TIMEOUT_MS = 10_000;

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
    evidenceCoverage: { status: 'complete' | 'incomplete'; reason: string | null };
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
    identityMappingComplete: boolean;
    duplicateActorMappings: number;
    duplicatePawnMappings: number;
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
  /** Tests must opt in explicitly; production can never bypass the accepted artifact pin. */
  testOnlyAllowUnpinnedBinary?: boolean;
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
  const testOverride = process.env.NODE_ENV === 'test' && process.env.VRFKIT_TEST_ALLOW_UNPINNED_BINARY === 'true';
  const binarySha256 = String(process.env.VRFKIT_BINARY_SHA256 || VRFKIT_PIN.windowsX64ExeSha256).toLowerCase();
  if (!HEX_SHA256.test(binarySha256)) throw Object.assign(new Error('VRFKIT_BINARY_SHA256 must be a SHA-256 digest.'), { code: 'parser-misconfigured' });
  if (!testOverride && binarySha256 !== VRFKIT_PIN.windowsX64ExeSha256) throw Object.assign(new Error('VRFKIT_BINARY_SHA256 must match the accepted vrfkit v0.2.5 artifact.'), { code: 'parser-misconfigured' });
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
    testOnlyAllowUnpinnedBinary: testOverride,
  };
}

async function sha256File(file: string) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash as any);
  return hash.digest('hex');
}

async function sha256BoundedRegularFile(file: string, maxBytes: number) {
  const initial = await fsp.lstat(file);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.size > maxBytes) throw new Error('Parser input is not a bounded regular file.');
  const real = await fsp.realpath(file);
  if (normalizedFsPath(real) !== normalizedFsPath(file)) throw new Error('Parser input may not use a symbolic link or reparse point.');
  const flags = fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0));
  const handle = await fsp.open(file, flags);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== initial.size || opened.size > maxBytes) throw new Error('Parser input changed before integrity verification.');
    const hash = crypto.createHash('sha256'); const buffer = Buffer.allocUnsafe(1024 * 1024); let total = 0; let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      total += bytesRead; position += bytesRead;
      if (total > maxBytes) throw new Error('Parser input exceeded its size limit.');
      hash.update(buffer.subarray(0, bytesRead));
    }
    const final = await handle.stat();
    if (final.size !== opened.size || final.mtimeMs !== opened.mtimeMs) throw new Error('Parser input changed during integrity verification.');
    return hash.digest('hex');
  } finally { await handle.close(); }
}

function inside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizedFsPath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function measureTree(root: string, maxFiles: number, maxBytes: number) {
  let files = 0; let bytes = 0;
  const rootReal = await fsp.realpath(root);
  if (normalizedFsPath(rootReal) !== normalizedFsPath(root)) throw new Error('Parser output root may not be a reparse path.');
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const target = path.resolve(directory, entry.name);
      if (!inside(root, target)) throw new Error('Parser output escaped its job directory.');
      const stat = await fsp.lstat(target);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) throw new Error('Parser output may not contain symbolic links or reparse points.');
      const real = await fsp.realpath(target);
      if (normalizedFsPath(real) !== normalizedFsPath(target) || !inside(rootReal, real)) throw new Error('Parser output may not contain reparse points or realpath escapes.');
      if (stat.isDirectory()) await visit(target);
      else if (stat.isFile()) {
        files += 1; bytes += stat.size;
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

function minimalChildEnv(): NodeJS.ProcessEnv {
  const allowed = process.platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']
    : ['PATH', 'TMPDIR', 'LANG', 'LC_ALL'];
  const env: NodeJS.ProcessEnv = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  for (const key of allowed) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

async function waitForProcessTreeExit(pid: number) {
  const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if (process.platform === 'win32') process.kill(pid, 0);
      else process.kill(-pid, 0);
    } catch (error: any) {
      if (error?.code === 'ESRCH') return;
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Replay parser process tree did not terminate within the confirmation timeout.');
}

async function terminateProcessTree(child: ReturnType<typeof spawn>) {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    if (!systemRoot) throw new Error('Cannot terminate parser tree without SystemRoot.');
    await new Promise<void>((resolve, reject) => {
      const killer = spawn(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(pid), '/t', '/f'], {
        shell: false, windowsHide: true, stdio: 'ignore', env: minimalChildEnv(),
      });
      killer.once('error', reject);
      killer.once('close', () => resolve());
    });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch (error: any) { if (error?.code !== 'ESRCH') throw error; }
  }
  await waitForProcessTreeExit(pid);
}

async function runBounded(command: string, args: string[], cwd: string, outputRoot: string, config: VrfkitPipelineConfig): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: minimalChildEnv(),
      detached: process.platform !== 'win32',
    });
    let stdout = ''; let stderr = ''; let settled = false; let stopping = false; let measuring = false;
    let confirmClosed!: () => void;
    const closed = new Promise<void>(resolveClosed => { confirmClosed = resolveClosed; });
    child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
    const stop = async (error: Error) => {
      if (settled || stopping) return; stopping = true; clearInterval(monitor); clearTimeout(timeout);
      try { await terminateProcessTree(child); } catch (terminationError: any) {
        error = new Error(`${error.message} Process-tree termination failed: ${terminationError.message}`);
      }
      try {
        await new Promise<void>((resolveClose, rejectClose) => {
          const closeTimer = setTimeout(() => rejectClose(new Error('Parser close event was not confirmed.')), PROCESS_EXIT_TIMEOUT_MS);
          void closed.then(() => { clearTimeout(closeTimer); resolveClose(); });
        });
      } catch (closeError: any) { error = new Error(`${error.message} ${closeError.message}`); }
      settled = true; reject(error);
    };
    const timeout = setTimeout(() => { void stop(new Error('Replay parser timed out.')); }, config.timeoutMs);
    const monitor = setInterval(async () => {
      if (measuring || settled) return; measuring = true;
      try { await measureTree(outputRoot, config.maxOutputFiles, config.maxOutputBytes); } catch (error: any) { await stop(error); } finally { measuring = false; }
    }, 250);
    child.on('error', error => { void stop(new Error(`Replay parser could not start: ${error.message}`)); });
    child.on('close', code => {
      confirmClosed();
      if (settled || stopping) return; settled = true; clearInterval(monitor); clearTimeout(timeout);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

async function readBoundedRegularFile(file: string, root: string, maxBytes: number) {
  if (!inside(root, file)) throw new Error('Parser evidence path escaped its private job directory.');
  const initial = await fsp.lstat(file);
  if (!initial.isFile() || initial.isSymbolicLink()) throw new Error('Parser evidence must be a regular non-link file.');
  const real = await fsp.realpath(file);
  if (normalizedFsPath(real) !== normalizedFsPath(file) || !inside(root, real)) throw new Error('Parser evidence may not use a reparse point or realpath escape.');
  if (initial.size > maxBytes) throw new Error('Parser evidence exceeded its pre-read size limit.');
  const flags = fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0));
  const handle = await fsp.open(file, flags);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== initial.size || opened.size > maxBytes) throw new Error('Parser evidence changed before it could be read safely.');
    const chunks: Buffer[] = []; let total = 0; let position = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      chunks.push(buffer.subarray(0, bytesRead)); total += bytesRead; position += bytesRead;
      if (total > maxBytes) throw new Error('Parser evidence exceeded its read size limit.');
    }
    const final = await handle.stat();
    if (final.size !== opened.size || final.mtimeMs !== opened.mtimeMs) throw new Error('Parser evidence changed while it was being read.');
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}

function scalarObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function evidenceNumber(value: any) { return scalarObject(value) && ['available', 'unavailable'].includes(String(value.status)) && (value.value === null || (Number.isSafeInteger(value.value) && Number(value.value) >= 0)); }

export function validateVrfkitNormalizedResult(raw: any): VrfkitNormalizedResult {
  if (!scalarObject(raw) || raw.schemaVersion !== 1 || !scalarObject(raw.parserInput) || !scalarObject(raw.scoreboard) || !scalarObject(raw.diagnostics)) throw new Error('Normalizer output does not match schema version 1.');
  const data = raw as any;
  if (data.parserInput?.parser?.name !== 'vrfkit' || data.parserInput?.parser?.version !== VRFKIT_PIN.version || data.parserInput?.file?.format !== 'vrf') throw new Error('Normalizer output has an unexpected parser identity.');
  if (data.scoreboard?.reviewRequired !== true) throw new Error('Normalizer output must remain review-required.');
  if (!HEX_SHA256.test(String(data.parserInput?.provenance?.replaySha256 || ''))
    || data.parserInput.provenance.replaySha256 !== data.diagnostics?.replaySha256) throw new Error('Normalizer output has conflicting replay provenance.');
  if (!Array.isArray(data.parserInput.identities) || !Array.isArray(data.parserInput.rounds) || !Array.isArray(data.scoreboard.players)) throw new Error('Normalizer output is missing identities, rounds, or scoreboard players.');
  if (data.parserInput.identities.length > 32 || data.parserInput.rounds.length > 100 || data.scoreboard.players.length > 32) throw new Error('Normalizer output exceeded structural limits.');
  if (!evidenceNumber(data.scoreboard.durationMs) || !evidenceNumber(data.scoreboard.finalScore?.teamA?.score) || !evidenceNumber(data.scoreboard.finalScore?.teamB?.score)) throw new Error('Normalizer scoreboard contains invalid numeric evidence.');
  if (!['complete', 'incomplete'].includes(data.scoreboard.evidenceCoverage?.status)
    || typeof data.diagnostics.identityMappingComplete !== 'boolean'
    || !Number.isSafeInteger(data.diagnostics.duplicateActorMappings) || data.diagnostics.duplicateActorMappings < 0
    || !Number.isSafeInteger(data.diagnostics.duplicatePawnMappings) || data.diagnostics.duplicatePawnMappings < 0) {
    throw new Error('Normalizer output is missing identity-mapping coverage diagnostics.');
  }
  if (!data.diagnostics.identityMappingComplete && data.scoreboard.evidenceCoverage.status !== 'incomplete') throw new Error('Invalid identity mapping must downgrade scoreboard evidence coverage.');
  if (!data.diagnostics.identityMappingComplete) {
    const identityDependentMetrics = ['firstBloods', 'firstDeaths', 'plants', 'defuses'];
    if (data.parserInput.file.support !== 'incomplete'
      || data.parserInput.rounds.some((round: any) => round?.sequenceCompleteFromStart === true)
      || data.parserInput.capabilities?.some((capability: any) => capability?.signal === 'eliminations' && capability?.support === 'complete')
      || data.scoreboard.players.some((player: any) => identityDependentMetrics.some(metric => player?.[metric]?.status !== 'unavailable' || player?.[metric]?.value !== null))) {
      throw new Error('Invalid identity mapping may not produce identity-dependent replay conclusions.');
    }
  }
  const encoded = Buffer.byteLength(JSON.stringify(raw));
  if (encoded > 8 * 1024 * 1024) throw new Error('Normalizer JSON exceeded its size limit.');
  return structuredClone(raw) as VrfkitNormalizedResult;
}

export async function runVrfkitReplayPipeline(replayPath: string, replaySha256: string, config: VrfkitPipelineConfig) {
  if (!HEX_SHA256.test(replaySha256)) throw new Error('Replay SHA-256 is invalid.');
  const [actualBinaryHash, actualReplayHash] = await Promise.all([
    sha256BoundedRegularFile(config.binaryPath, MAX_BINARY_BYTES),
    sha256BoundedRegularFile(replayPath, MAX_REPLAY_BYTES),
    readBoundedRegularFile(config.normalizerPath, path.dirname(config.normalizerPath), MAX_NORMALIZER_SOURCE_BYTES),
  ]);
  if (actualBinaryHash !== config.binarySha256) throw new Error('Configured vrfkit binary failed its pinned SHA-256 check.');
  const testOverride = process.env.NODE_ENV === 'test' && config.testOnlyAllowUnpinnedBinary === true;
  if (!testOverride) {
    if (config.binarySha256 !== VRFKIT_PIN.windowsX64ExeSha256 || actualBinaryHash !== VRFKIT_PIN.windowsX64ExeSha256) throw new Error('Configured vrfkit binary is not the accepted v0.2.5 artifact.');
    const buildInfoPath = path.resolve(path.dirname(config.binaryPath), 'build-info.json');
    const buildInfo = JSON.parse((await readBoundedRegularFile(buildInfoPath, path.dirname(config.binaryPath), 64 * 1024)).toString('utf8'));
    if (buildInfo?.tag !== VRFKIT_PIN.tag || buildInfo?.commit !== VRFKIT_PIN.commit
      || buildInfo?.executable_sha256 !== VRFKIT_PIN.windowsX64ExeSha256 || buildInfo?.target !== 'x86_64-pc-windows-msvc') {
      throw new Error('Configured vrfkit build metadata does not match the accepted v0.2.5 artifact.');
    }
  }
  if (actualReplayHash !== replaySha256) throw new Error('Private replay failed integrity verification before parsing.');

  await fsp.mkdir(config.jobsRoot, { recursive: true, mode: 0o700 });
  const jobId = `${replaySha256}-${crypto.randomUUID()}`;
  const jobDir = path.resolve(config.jobsRoot, jobId); const exportDir = path.resolve(jobDir, 'export'); const normalizedPath = path.resolve(jobDir, 'normalized.json');
  if (![jobDir, exportDir, normalizedPath].every(target => inside(config.jobsRoot, target))) throw new Error('Parser job path escaped its private root.');
  await fsp.mkdir(jobDir, { recursive: false, mode: 0o700 });
  try {
    await fsp.mkdir(exportDir, { recursive: false, mode: 0o700 });
    const [launchBinaryHash, launchReplayHash] = await Promise.all([
      sha256BoundedRegularFile(config.binaryPath, MAX_BINARY_BYTES),
      sha256BoundedRegularFile(replayPath, MAX_REPLAY_BYTES),
    ]);
    if (launchBinaryHash !== actualBinaryHash || launchReplayHash !== actualReplayHash) throw new Error('Parser inputs changed after integrity verification.');
    const exportArgs = [...(config.binaryArgsPrefix || []), 'export', replayPath, '--out', exportDir, '--checkpoints'];
    const exported = await runBounded(config.binaryPath, exportArgs, jobDir, jobDir, config);
    if (exported.exitCode !== 0) throw new Error(`vrfkit export failed (${exported.exitCode}): ${exported.stderr.trim().slice(-500) || 'no diagnostic'}`);
    // Mandatory final validation catches a parser that exits before the periodic monitor observes its output.
    await measureTree(jobDir, config.maxOutputFiles, config.maxOutputBytes);
    const manifestPath = path.resolve(exportDir, 'manifest.json');
    const manifestBytes = await readBoundedRegularFile(manifestPath, jobDir, Math.min(MAX_MANIFEST_BYTES, config.maxOutputBytes));
    const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');

    const normalized = await runBounded(config.pythonPath, [
      ...(config.pythonArgsPrefix || []), config.normalizerPath,
      '--export', exportDir, '--out', normalizedPath, '--replay-sha256', replaySha256,
      '--binary-sha256', actualBinaryHash, '--binary-version', VRFKIT_PIN.version, '--binary-commit', VRFKIT_PIN.commit,
    ], jobDir, jobDir, config);
    if (normalized.exitCode !== 0) throw new Error(`vrfkit evidence normalization failed (${normalized.exitCode}): ${normalized.stderr.trim().slice(-500) || 'no diagnostic'}`);
    const tree = await measureTree(jobDir, config.maxOutputFiles, config.maxOutputBytes);
    const normalizedBytes = await readBoundedRegularFile(normalizedPath, jobDir, Math.min(MAX_NORMALIZED_BYTES, config.maxOutputBytes));
    const result = validateVrfkitNormalizedResult(JSON.parse(normalizedBytes.toString('utf8')));
    if (result.diagnostics.replaySha256 !== replaySha256 || result.diagnostics.binarySha256 !== actualBinaryHash
      || result.diagnostics.binaryVersion !== VRFKIT_PIN.version || result.diagnostics.binaryCommit !== VRFKIT_PIN.commit
      || result.diagnostics.manifestSha256 !== manifestSha256) throw new Error('Normalizer provenance does not match the verified parser inputs.');
    result.diagnostics.outputFileCount = tree.files; result.diagnostics.outputBytes = tree.bytes;
    return { jobId, result };
  } finally {
    // Raw exports and normalized files never survive the request; only bounded evidence is retained by the intake store.
    await fsp.rm(jobDir, { recursive: true, force: true });
  }
}

export const vrfkitPipelineInternals = { sha256File, sha256BoundedRegularFile, measureTree, inside, runBounded, minimalChildEnv, readBoundedRegularFile };

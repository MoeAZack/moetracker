#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import readline from 'readline/promises';
import process from 'process';
import { pathToFileURL } from 'url';

const APP_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'MoeTracker', 'ReplayCollector');
const CONFIG_PATH = path.join(APP_DIR, 'config.json');
const MANIFEST_PATH = path.join(APP_DIR, 'manifest.json');
const SECRET_PATH = path.join(APP_DIR, 'device-token.dpapi');
const RAW_SESSION_PATH = path.join(APP_DIR, 'raw-session.dpapi');
const DEFAULT_DEMO = path.join(process.env.LOCALAPPDATA || '', 'VALORANT', 'Saved', 'Demos');
const REPLAY_TYPE = 'application/vnd.valorant.replay';
const VRFKIT_PIN = { version: '0.2.5', tag: 'v0.2.5', commit: 'c4d6cc0e5ec3904fdb64b350b2656b8e3ff33d53', binarySha256: 'aa55fc410f1596a6ffedc7ab579341da6edb262197c64902e74b4eed485dc23f' };
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

function option(args, name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function has(args, name) { return args.includes(name); }
function canonicalFile(value) { return path.resolve(value).toLowerCase(); }
function inside(file, directory) { const relative = path.relative(path.resolve(directory), path.resolve(file)); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); }
function serverUrl(value) {
  const parsed = new URL(value); const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.username || parsed.password) throw new Error('Collector server URL must not contain credentials.');
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('Collector server must use HTTPS (HTTP is allowed only for localhost development).');
  return parsed.toString().replace(/\/$/, '');
}
function uploadRequest(server, hash, token, file, size, deviceId) {
  const safeServer = serverUrl(server); const endpoint = new URL(`/api/replay-intake/uploads/${hash}`, safeServer);
  if (endpoint.origin !== new URL(safeServer).origin) throw new Error('Replay upload endpoint changed origin.');
  return {
    endpoint: endpoint.toString(),
    options: { method: 'PUT', redirect: 'error', duplex: 'half', body: fs.createReadStream(file), headers: { 'Content-Type': REPLAY_TYPE, 'Content-Length': String(size), 'X-Replay-Filename': path.basename(file), 'X-Device-Id': deviceId, 'X-Device-Token': token } },
  };
}
function scoreboardApproval(file, folder, replaySha256, imageSha256, approvedAt = new Date().toISOString()) {
  if (!folder || !inside(file, folder) || !/\.(png|jpe?g|webp)$/i.test(file)) throw new Error('The image must be explicitly selected from the configured scoreboard folder.');
  if (!/^[a-f0-9]{64}$/.test(replaySha256)) throw new Error('scoreboard-approve requires --replay-sha256 for an observed replay.');
  return { file: path.resolve(file), sha256: imageSha256, replaySha256, approvedAt, status: 'local-ocr-review-required' };
}

async function readJson(file, fallback) { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch (error) { if (error?.code === 'ENOENT') return structuredClone(fallback); throw error; } }
async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 }); await fsp.rename(temp, file);
}
export function migrateConfig(raw = {}) {
  const legacy = raw && typeof raw === 'object' ? raw : {};
  return { schemaVersion: 2, server: typeof legacy.server === 'string' ? legacy.server : '', deviceId: typeof legacy.deviceId === 'string' ? legacy.deviceId : '', replayPaths: Array.isArray(legacy.replayPaths) ? legacy.replayPaths : [DEFAULT_DEMO], scoreboardFolder: typeof legacy.scoreboardFolder === 'string' ? legacy.scoreboardFolder : '', autoUpload: legacy.autoUpload === true, stableSeconds: Number.isFinite(legacy.stableSeconds) ? legacy.stableSeconds : 30, scanSeconds: Number.isFinite(legacy.scanSeconds) ? legacy.scanSeconds : 60, ingestionMode: legacy.ingestionMode === 'coach-raw' ? 'coach-raw' : 'local-evidence', localRuntime: { binaryPath: String(legacy.localRuntime?.binaryPath || ''), pythonPath: String(legacy.localRuntime?.pythonPath || ''), normalizerPath: String(legacy.localRuntime?.normalizerPath || '') } };
}
async function config() { return migrateConfig(await readJson(CONFIG_PATH, {})); }
async function manifest() { return readJson(MANIFEST_PATH, { schemaVersion: 1, files: {}, approved: [], scoreboardApprovals: [] }); }

function dpapi(script, input) {
  if (process.platform !== 'win32') throw new Error('Device credentials require Windows DPAPI; this collector fails closed on other platforms.');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 }).trim();
}
function protectToken(token) {
  return dpapi("Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($v); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))", token);
}
async function unprotectToken() {
  const blob = await fsp.readFile(SECRET_PATH, 'utf8');
  return dpapi("Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))", blob);
}
async function protectJsonFile(file, value) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, protectToken(JSON.stringify(value)), { encoding: 'utf8', mode: 0o600 }); }
async function unprotectJsonFile(file) { try { const blob = await fsp.readFile(file, 'utf8'); return JSON.parse(dpapi("Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))", blob)); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; } }

async function sha256(file) {
  const hash = crypto.createHash('sha256'); await new Promise((resolve, reject) => fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', resolve).on('error', reject)); return hash.digest('hex');
}
async function replayFiles(folders) {
  const found = [];
  for (const folder of folders) {
    let entries; try { entries = await fsp.readdir(path.resolve(folder), { withFileTypes: true }); } catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
    for (const entry of entries) if (entry.isFile() && entry.name.toLowerCase().endsWith('.vrf')) found.push(path.join(path.resolve(folder), entry.name));
  }
  return found;
}

function canonical(value) { return JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested) ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested); }
function validateNormalizedEvidence(raw, replaySha256) {
  if (!raw || raw.schemaVersion !== 1 || raw.parserInput?.parser?.name !== 'vrfkit' || raw.parserInput?.parser?.version !== VRFKIT_PIN.version || raw.parserInput?.file?.format !== 'vrf') throw new Error('Local normalizer output does not match the accepted schema.');
  if (!Array.isArray(raw.parserInput?.identities) || raw.parserInput.identities.length > 32 || !Array.isArray(raw.parserInput?.rounds) || raw.parserInput.rounds.length > 100 || !Array.isArray(raw.scoreboard?.players) || raw.scoreboard.players.length > 32) throw new Error('Local normalizer output exceeded structural bounds.');
  if (raw.scoreboard.reviewRequired !== true || !['complete', 'incomplete'].includes(raw.scoreboard.evidenceCoverage?.status)) throw new Error('Local evidence must remain a review-required draft.');
  if (raw.diagnostics?.replaySha256 !== replaySha256 || raw.diagnostics?.binarySha256 !== VRFKIT_PIN.binarySha256 || raw.diagnostics?.binaryVersion !== VRFKIT_PIN.version || raw.diagnostics?.binaryCommit !== VRFKIT_PIN.commit) throw new Error('Local normalizer provenance is invalid.');
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_EVIDENCE_BYTES) throw new Error('Local evidence exceeded its upload limit.');
  return raw;
}
async function assertPinnedRuntime(runtime) {
  for (const [label, value] of Object.entries(runtime || {})) if (!value || !path.isAbsolute(value)) throw new Error(`Local ${label} is not configured as an absolute path. Raw fallback is never automatic.`);
  const [binaryHash, buildText] = await Promise.all([sha256(runtime.binaryPath), fsp.readFile(path.join(path.dirname(runtime.binaryPath), 'build-info.json'), 'utf8')]); const build = JSON.parse(buildText);
  if (binaryHash !== VRFKIT_PIN.binarySha256 || build.tag !== VRFKIT_PIN.tag || build.commit !== VRFKIT_PIN.commit || build.executable_sha256 !== VRFKIT_PIN.binarySha256) throw new Error('Local vrfkit runtime does not match the accepted pinned artifact.');
  await Promise.all([fsp.access(runtime.pythonPath, fs.constants.X_OK), fsp.access(runtime.normalizerPath, fs.constants.R_OK)]);
}
async function produceLocalEvidence(file, replaySha256, size, cfg) {
  await assertPinnedRuntime(cfg.localRuntime); const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moetracker-replay-')); const exportDir = path.join(root, 'export'); const normalized = path.join(root, 'normalized.json');
  try {
    await fsp.mkdir(exportDir); execFileSync(cfg.localRuntime.binaryPath, ['export', file, '--out', exportDir, '--checkpoints'], { cwd: root, windowsHide: true, stdio: 'pipe', timeout: 5 * 60 * 1000, maxBuffer: 64 * 1024 });
    const manifestBytes = await fsp.readFile(path.join(exportDir, 'manifest.json')); const manifestSha256 = crypto.createHash('sha256').update(manifestBytes).digest('hex');
    execFileSync(cfg.localRuntime.pythonPath, [cfg.localRuntime.normalizerPath, '--export', exportDir, '--out', normalized, '--replay-sha256', replaySha256, '--binary-sha256', VRFKIT_PIN.binarySha256, '--binary-version', VRFKIT_PIN.version, '--binary-commit', VRFKIT_PIN.commit], { cwd: root, windowsHide: true, stdio: 'pipe', timeout: 5 * 60 * 1000, maxBuffer: 64 * 1024 });
    const bytes = await fsp.readFile(normalized); if (bytes.length > MAX_EVIDENCE_BYTES) throw new Error('Local evidence exceeded its upload limit.'); const result = validateNormalizedEvidence(JSON.parse(bytes.toString('utf8')), replaySha256);
    if (result.diagnostics.manifestSha256 !== manifestSha256 || await sha256(file) !== replaySha256 || (await fsp.stat(file)).size !== size) throw new Error('Replay changed while local evidence was produced.');
    const envelope = { schemaVersion: 1, source: { sha256: replaySha256, size, originalName: path.basename(file), deviceId: cfg.deviceId }, parser: { name: 'vrfkit', version: VRFKIT_PIN.version, binarySha256: VRFKIT_PIN.binarySha256, binaryCommit: VRFKIT_PIN.commit }, normalized: result };
    return { ...envelope, evidenceSha256: crypto.createHash('sha256').update(canonical(envelope)).digest('hex') };
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
}

function deviceHeaders(token, deviceId) { return { 'X-Device-Id': deviceId, 'X-Device-Token': token }; }
async function postDeviceJson(cfg, token, route, body) { const response = await fetch(new URL(route, serverUrl(cfg.server)), { method: 'POST', redirect: 'error', headers: { ...deviceHeaders(token, cfg.deviceId), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const json = await response.json().catch(() => ({ error: `HTTP ${response.status}` })); if (!response.ok) throw new Error(json.error || `Request failed with HTTP ${response.status}.`); return json; }
async function uploadEvidence(file, hash, size, cfg, token) { const evidence = await produceLocalEvidence(file, hash, size, cfg); return postDeviceJson(cfg, token, `/api/replay-intake/evidence/${hash}`, evidence); }
async function resumableOffset(session, size) {
  const probe = await fetch(session.uploadUrl, { method: 'PUT', redirect: 'error', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${size}` } });
  if (probe.ok) return { complete: true, metadata: await probe.json().catch(() => ({})) };
  if (probe.status !== 308) throw new Error(`Direct raw upload resume check failed with HTTP ${probe.status}.`);
  const match = /^bytes=0-(\d+)$/.exec(probe.headers.get('range') || ''); return { complete: false, offset: match ? Number(match[1]) + 1 : 0 };
}
async function uploadRawFallback(file, hash, size, cfg, token) {
  let session = await unprotectJsonFile(RAW_SESSION_PATH); let offset = 0; let metadata = {};
  if (!session || session.sha256 !== hash || Date.parse(session.expiresAt) <= Date.now()) { session = { ...(await postDeviceJson(cfg, token, '/api/replay-intake/raw/initiate', { sha256: hash, size, originalName: path.basename(file) })), sha256: hash }; await protectJsonFile(RAW_SESSION_PATH, session); }
  else { const resume = await resumableOffset(session, size); if (resume.complete) metadata = resume.metadata; else offset = resume.offset; }
  if (offset < size) {
    const upload = await fetch(session.uploadUrl, { method: 'PUT', redirect: 'error', duplex: 'half', headers: { 'Content-Type': REPLAY_TYPE, 'Content-Length': String(size - offset), 'Content-Range': `bytes ${offset}-${size - 1}/${size}` }, body: fs.createReadStream(file, { start: offset }) });
    if (!upload.ok) throw new Error(`Direct raw upload paused at HTTP ${upload.status}; the protected resumable session will be retried.`);
    metadata = await upload.json().catch(() => ({}));
  }
  const receipt = await postDeviceJson(cfg, token, '/api/replay-intake/raw/finalize', { uploadId: session.uploadId, generation: metadata.generation }); await fsp.rm(RAW_SESSION_PATH, { force: true }); return receipt;
}

async function upload(file, hash, size, cfg) {
  // Re-validate immediately before DPAPI credential access; redirects are prohibited below.
  const safeServer = serverUrl(cfg.server);
  const token = await unprotectToken();
  if (cfg.ingestionMode === 'coach-raw') return uploadRawFallback(file, hash, size, cfg, token);
  return uploadEvidence(file, hash, size, cfg, token);
}

export async function scan({ allowUpload = false, approvedHash = null } = {}) {
  const cfg = await config(); const state = await manifest(); const now = Date.now(); const results = [];
  for (const file of await replayFiles(cfg.replayPaths.filter(Boolean))) {
    const key = canonicalFile(file); const stat = await fsp.stat(file); const prior = state.files[key];
    if (!prior || prior.size !== stat.size || prior.mtimeMs !== stat.mtimeMs) {
      state.files[key] = { path: file, size: stat.size, mtimeMs: stat.mtimeMs, stableSince: now, status: 'observing' };
      results.push({ file: path.basename(file), status: 'observing' }); continue;
    }
    if (now - prior.stableSince < Math.max(10, cfg.stableSeconds) * 1000) { results.push({ file: path.basename(file), status: 'observing' }); continue; }
    let handle; try { handle = await fsp.open(file, 'r'); const probe = Buffer.alloc(Math.min(16, stat.size)); await handle.read(probe, 0, probe.length, 0); } catch { results.push({ file: path.basename(file), status: 'locked' }); continue; } finally { await handle?.close(); }
    const hash = prior.sha256 || await sha256(file); prior.sha256 = hash; prior.status = prior.status === 'uploaded' ? 'uploaded' : 'review-required';
    const approved = approvedHash === hash || state.approved.includes(hash);
    if (allowUpload && (approved || cfg.autoUpload) && prior.status !== 'uploaded') {
      prior.status = cfg.ingestionMode === 'coach-raw' ? 'uploading' : 'processing-local';
      const receipt = await upload(file, hash, stat.size, cfg); prior.status = 'review-required'; prior.uploadedAt = new Date().toISOString(); prior.receipt = { sha256: receipt.sha256 || hash, ingestionMode: receipt.ingestionMode || cfg.ingestionMode, parserStatus: receipt.parserStatus || receipt.status || 'pending', reviewRequired: true }; state.approved = state.approved.filter(item => item !== hash);
    }
    results.push({ file: path.basename(file), sha256: hash, size: stat.size, status: prior.status });
  }
  await atomicJson(MANIFEST_PATH, state); return results;
}

async function main() {
  const [command = 'status', ...args] = process.argv.slice(2); let cfg = await config(); let state = await manifest();
  if (command === 'configure') {
    const server = option(args, '--server'); const addPath = option(args, '--add-path'); const scoreboardFolder = option(args, '--scoreboard-folder');
    if (server) cfg.server = serverUrl(server);
    if (addPath) cfg.replayPaths = [...new Set([...cfg.replayPaths, path.resolve(addPath)])];
    if (scoreboardFolder) cfg.scoreboardFolder = path.resolve(scoreboardFolder);
    const binaryPath = option(args, '--vrfkit-binary'); const pythonPath = option(args, '--python'); const normalizerPath = option(args, '--normalizer');
    if (binaryPath) cfg.localRuntime.binaryPath = path.resolve(binaryPath); if (pythonPath) cfg.localRuntime.pythonPath = path.resolve(pythonPath); if (normalizerPath) cfg.localRuntime.normalizerPath = path.resolve(normalizerPath);
    if (has(args, '--coach-raw-fallback')) cfg.ingestionMode = 'coach-raw'; if (has(args, '--local-evidence')) cfg.ingestionMode = 'local-evidence';
    if (has(args, '--enable-auto-upload')) cfg.autoUpload = true;
    if (has(args, '--disable-auto-upload')) cfg.autoUpload = false;
    await atomicJson(CONFIG_PATH, cfg); console.log(JSON.stringify({ configured: true, ...cfg, credentialStored: fs.existsSync(SECRET_PATH) }, null, 2)); return;
  }
  if (command === 'enroll') {
    const server = option(args, '--server'); const deviceId = option(args, '--device-id');
    if (!server || !deviceId) throw new Error('Usage: enroll --server https://tracker.example --device-id <server-issued-id>');
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout }); const token = (await prompt.question('Paste the one-time device credential: ')).trim(); prompt.close();
    if (token.length < 43) throw new Error('Device credential was missing or malformed.');
    cfg.server = serverUrl(server); cfg.deviceId = deviceId;
    await fsp.mkdir(APP_DIR, { recursive: true }); await fsp.writeFile(SECRET_PATH, protectToken(token), { encoding: 'utf8', mode: 0o600 }); await atomicJson(CONFIG_PATH, cfg);
    console.log('Device enrolled. The credential is protected for this Windows user with DPAPI.'); return;
  }
  if (command === 'scan') { console.log(JSON.stringify(await scan(), null, 2)); return; }
  if (command === 'approve') {
    const hash = String(option(args, '--sha256') || '').toLowerCase(); if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('approve requires --sha256 <64 hex characters>.');
    state.approved = [...new Set([...state.approved, hash])]; await atomicJson(MANIFEST_PATH, state); console.log(JSON.stringify(await scan({ allowUpload: true, approvedHash: hash }), null, 2)); return;
  }
  if (command === 'watch') {
    console.log(`Watching configured replay folders every ${cfg.scanSeconds}s. ${cfg.autoUpload ? 'EXPLICIT AUTO-UPLOAD ENABLED' : 'Dry-run/review-required mode'}.`);
    for (;;) { try { console.log(JSON.stringify(await scan({ allowUpload: true }), null, 2)); } catch (error) { console.error(error.message); } await new Promise(resolve => setTimeout(resolve, Math.max(30, cfg.scanSeconds) * 1000)); }
  }
  if (command === 'scoreboard-approve') {
    const file = path.resolve(option(args, '--file') || ''); const replaySha256 = String(option(args, '--replay-sha256') || '').toLowerCase();
    if (!Object.values(state.files).some(item => item.sha256 === replaySha256)) throw new Error('The replay hash must already be present in this device manifest. Run scan first.');
    await fsp.access(file, fs.constants.R_OK); const hash = await sha256(file); const approval = scoreboardApproval(file, cfg.scoreboardFolder, replaySha256, hash); state.scoreboardApprovals.push(approval); await atomicJson(MANIFEST_PATH, state);
    console.log(JSON.stringify({ file: path.basename(file), sha256: hash, replaySha256, status: approval.status, uploaded: false, note: 'Open this approved image in MoeTracker local OCR; it is never captured or uploaded automatically.' }, null, 2)); return;
  }
  if (command === 'status') {
    console.log(JSON.stringify({ configPath: CONFIG_PATH, manifestPath: MANIFEST_PATH, defaultReplayPath: DEFAULT_DEMO, server: cfg.server || null, deviceId: cfg.deviceId || null, replayPaths: cfg.replayPaths, ingestionMode: cfg.ingestionMode, localRuntimeReady: Object.values(cfg.localRuntime).every(Boolean), resumableSessionProtected: fs.existsSync(RAW_SESSION_PATH), autoUpload: cfg.autoUpload, credentialStored: fs.existsSync(SECRET_PATH), trackedFiles: Object.keys(state.files).length }, null, 2)); return;
  }
  throw new Error('Commands: configure, enroll, scan, approve, watch, scoreboard-approve, status');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(`Replay collector: ${error.message}`); process.exitCode = 1; });

export const collectorInternals = { APP_DIR, DEFAULT_DEMO, inside, canonicalFile, serverUrl, scoreboardApproval, uploadRequest, migrateConfig, validateNormalizedEvidence, resumableOffset };

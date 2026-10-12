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
const DEFAULT_DEMO = path.join(process.env.LOCALAPPDATA || '', 'VALORANT', 'Saved', 'Demos');
const REPLAY_TYPE = 'application/vnd.valorant.replay';

function option(args, name) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }
function has(args, name) { return args.includes(name); }
function canonicalFile(value) { return path.resolve(value).toLowerCase(); }
function inside(file, directory) { const relative = path.relative(path.resolve(directory), path.resolve(file)); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); }
function serverUrl(value) {
  const parsed = new URL(value); const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('Collector server must use HTTPS (HTTP is allowed only for localhost development).');
  return parsed.toString().replace(/\/$/, '');
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
async function config() { return readJson(CONFIG_PATH, { schemaVersion: 1, server: '', deviceId: '', replayPaths: [DEFAULT_DEMO], scoreboardFolder: '', autoUpload: false, stableSeconds: 30, scanSeconds: 60 }); }
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

async function upload(file, hash, size, cfg) {
  if (!/^https?:\/\//.test(cfg.server)) throw new Error('Collector server URL is not configured.');
  const token = await unprotectToken();
  const response = await fetch(`${cfg.server.replace(/\/$/, '')}/api/replay-intake/uploads/${hash}`, {
    method: 'PUT', duplex: 'half', body: fs.createReadStream(file),
    headers: { 'Content-Type': REPLAY_TYPE, 'Content-Length': String(size), 'X-Replay-Filename': path.basename(file), 'X-Device-Id': cfg.deviceId, 'X-Device-Token': token },
  });
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(body.error || `Upload failed with HTTP ${response.status}.`);
  return body;
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
      const receipt = await upload(file, hash, stat.size, cfg); prior.status = 'uploaded'; prior.uploadedAt = new Date().toISOString(); prior.receipt = receipt; state.approved = state.approved.filter(item => item !== hash);
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
    console.log(JSON.stringify({ configPath: CONFIG_PATH, manifestPath: MANIFEST_PATH, defaultReplayPath: DEFAULT_DEMO, server: cfg.server || null, deviceId: cfg.deviceId || null, replayPaths: cfg.replayPaths, autoUpload: cfg.autoUpload, credentialStored: fs.existsSync(SECRET_PATH), trackedFiles: Object.keys(state.files).length }, null, 2)); return;
  }
  throw new Error('Commands: configure, enroll, scan, approve, watch, scoreboard-approve, status');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(`Replay collector: ${error.message}`); process.exitCode = 1; });

export const collectorInternals = { APP_DIR, DEFAULT_DEMO, inside, canonicalFile, serverUrl, scoreboardApproval };

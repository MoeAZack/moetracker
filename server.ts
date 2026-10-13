import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import * as schemas from './schemas';
import { uid, validate, safeEqual, hashAccessKey, clientIp, loginLockRemaining, loginRecordFail, loginRecordSuccess, cached } from './lib/utils';
import { readDB, saveDB } from './lib/store';
import { registerVodLineupRoutes } from './lib/routes/vodLineup';
import { registerIntegrationRoutes } from './lib/routes/integrations';
import { registerDataRoutes } from './lib/routes/data';
import { registerRosterRoutes } from './lib/routes/roster';
import { registerEngineAdapterRoutes } from './lib/routes/engineAdapters';
import { createPlayerPasswordVerifier, verifyPlayerPassword } from './lib/playerPassword';
import { stripLegacySecrets, toPublicTrackerData } from './lib/publicData';
import { registerReplayDeviceRoutes, registerReplayDeviceUploadRoute } from './lib/routes/replayIntake';

// Google Sign-In config (dormant unless GOOGLE_CLIENT_ID is set — password auth always works).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const BOOTSTRAP_ADMIN_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').toLowerCase();
const googleClient = null;

function requiredSecret(name: 'ADMIN_PASSWORD' | 'JWT_SECRET'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Configure it as a deployment secret.`);
  if (value.length < 24) throw new Error(`${name} must be at least 24 characters.`);
  return value;
}





export async function createApp(serveFrontend = true) {
  const app = express();
  const cloudflareRuntime = process.env.CLOUDFLARE_WORKER === 'true';

  const adminPass = requiredSecret('ADMIN_PASSWORD');
  const jwtSecret = requiredSecret('JWT_SECRET');

  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Security headers (defense-in-depth). CSP allows Google Identity Services + arbitrary
  // image hosts (lineup screenshots) while blocking plugins and framing.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com",
      "worker-src 'self'",
      "style-src 'self' 'unsafe-inline' https://accounts.google.com https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://accounts.google.com",
      "frame-src https://accounts.google.com",
      "object-src 'none'",
      "base-uri 'self'"
    ].join('; '));
    next();
  });

  app.use(express.json({ limit: '10mb' }));

  // GET health status for Sheets integration check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), build: process.env.APP_REVISION || 'development' });
  });

  // POST validate and authenticate access keys
  app.post('/api/login-key', async (req, res) => {
    try {
      const ip = clientIp(req);
      const lockRemaining = loginLockRemaining(ip);
      if (lockRemaining > 0) {
        res.setHeader('Retry-After', String(lockRemaining));
        return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(lockRemaining / 60)} minute(s).` });
      }

      const body = validate(schemas.loginKeySchema, req.body, res); if (!body) return;
      const cleanKey = body.key.trim();
      if (body.playerName) {
        const db = await readDB();
        if (!db.authKeys) db.authKeys = [];
        const normalizedName = body.playerName.trim().toLocaleLowerCase();
        const player = (db.rosterPlayers || []).find((item: any) => !item.retiredAt && String(item.displayName || '').trim().toLocaleLowerCase() === normalizedName);
        const passwordEntry = player ? db.authKeys.find((entry: any) => entry.credentialType === 'player-password' && entry.role === 'player' && entry.playerId === player.id) : null;
        if (player && passwordEntry && await verifyPlayerPassword(cleanKey, passwordEntry)) {
          loginRecordSuccess(ip);
          const token = jwt.sign(
            { role: 'player', name: player.displayName, kind: 'key', keyId: passwordEntry.id, credentialVersion: passwordEntry.credentialVersion },
            jwtSecret,
            { expiresIn: '12h' },
          );
          return res.json({ success: true, role: 'player', username: player.displayName, key: token });
        }
        loginRecordFail(ip);
        return res.status(401).json({ error: 'Invalid player name or password.' });
      }
      // 1. Check Master Admin Key
      if (safeEqual(cleanKey, adminPass)) {
        loginRecordSuccess(ip);
        const token = jwt.sign(
          { role: 'coach', name: 'Administrator (Master)', kind: 'master', authVersion: hashAccessKey(adminPass) },
          jwtSecret,
          { expiresIn: '12h' }
        );
        return res.json({
          success: true,
          role: 'coach',
          username: 'Administrator (Master)',
          key: token
        });
      }

      // 2. Check Custom Active Keys in DB
      const db = await readDB();
      if (!db.authKeys) db.authKeys = [];

      const cleanKeyHash = hashAccessKey(cleanKey);
      const foundKey = db.authKeys.find((k: any) => k.keyHash === cleanKeyHash || k.key === cleanKey);
      if (foundKey) {
        // Transparently migrate legacy plaintext records after a successful login.
        if (!foundKey.keyHash) {
          foundKey.keyHash = cleanKeyHash;
          delete foundKey.key;
          await saveDB(db);
        }
        loginRecordSuccess(ip);
        const token = jwt.sign(
          { role: foundKey.role, name: foundKey.label, kind: 'key', keyId: foundKey.id },
          jwtSecret,
          { expiresIn: '12h' }
        );
        return res.json({
          success: true,
          role: foundKey.role,
          username: foundKey.label,
          key: token
        });
      }

      loginRecordFail(ip);
      return res.status(401).json({ error: 'Invalid or revoked Access Key.' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Public client config: tells the login screen whether Google Sign-In is available.
  app.get('/api/config', (req, res) => {
    res.json({ googleEnabled: !!googleClient, googleClientId: GOOGLE_CLIENT_ID });
  });

  app.post('/api/auth/google', (_req, res) => res.status(410).json({ error: 'Google sign-in has been removed from this free-only deployment.' }));

  // Cron endpoint: sync every configured player's Solo Queue. Guarded by a shared
  // secret header (set CRON_SECRET) so Cloud Scheduler can call it without a coach key.
  // Registered before the auth middleware so it isn't gated by the bearer token.
  app.post('/api/cron/sync-soloq', async (req, res) => {
    try {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers['x-cron-secret'] !== secret) {
        return res.status(401).json({ error: 'Unauthorized cron request.' });
      }
      res.status(503).json({ disabled: true, fetched: false, wrote: false, reason: 'ranked-sync-gate-unavailable', error: 'Scheduled ranked sync is disabled until provider, consent and account gates are persisted.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Private recovery backup. It is deliberately not available through the normal
  // authenticated API: the manifest includes private engine/intake metadata.
  app.post('/api/cron/backup', async (req, res) => {
    try {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers['x-cron-secret'] !== secret) {
        return res.status(401).json({ error: 'Unauthorized cron request.' });
      }
      if (cloudflareRuntime) return res.status(410).json({ error: 'Cloudflare Free uses offline D1 exports instead of paid object backups.' });
      const moduleName = './lib/privateBackup';
      const { createPrivateBackup } = await import(moduleName);
      const backup = await createPrivateBackup({ reason: 'scheduled-private-recovery' });
      res.json({ success: true, backupId: backup.id, format: backup.manifest.format, replayBlobCount: backup.manifest.replayBlobs.inventory.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Device uploads use a narrow, revocable credential instead of a human session.
  registerReplayDeviceUploadRoute(app);

  // Authorization middleware protecting all subsequent API routes
  app.use('/api', async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Session expired or invalid. Please provide an Access Key.' });
    }

    const clientKey = authHeader.split(' ')[1];
    let userRole = '';
    let username = '';

    {
      const db = await readDB();
      if (!db.authKeys) db.authKeys = [];
      // Long-lived keys are accepted only by the throttled login exchange.
      // Every protected route requires an expiring, signed session.
      {
        // Try a Google session token. The email is re-checked against the allowlist on
        // every request, so removing someone from the panel revokes them instantly.
        try {
          const decoded: any = jwt.verify(clientKey, jwtSecret, { algorithms: ['HS256'] });
          if (decoded?.kind === 'master' && safeEqual(decoded.authVersion || '', hashAccessKey(adminPass))) {
            userRole = 'coach';
            username = decoded.name || 'Administrator';
            (req as any).sessionActorId = 'master';
          } else if (decoded?.kind === 'key' && decoded.keyId) {
            const entry = db.authKeys.find((k: any) => k.id === decoded.keyId);
            const versionMatches = entry?.credentialType !== 'player-password' || decoded.credentialVersion === entry.credentialVersion;
            const activePasswordPlayer = entry?.credentialType !== 'player-password' || (db.rosterPlayers || []).some((player: any) => player.id === entry.playerId && !player.retiredAt);
            if (entry && versionMatches && activePasswordPlayer) {
              userRole = entry.role;
              username = entry.label;
              (req as any).sessionPlayerId = entry.playerId;
              (req as any).sessionActorId = `key:${entry.id}`;
            }
          } else if (decoded?.kind === 'google' && decoded.email) {
            const entry = (db.allowedUsers || []).find((u: any) => (u.email || '').toLowerCase() === String(decoded.email).toLowerCase());
            if (entry) {
              userRole = entry.role;
              username = decoded.name || entry.email;
              (req as any).sessionPlayerId = entry.playerId;
              (req as any).sessionActorId = `google:${String(decoded.email).toLowerCase()}`;
            }
          }
        } catch {
          // Not a valid session token — falls through to 401 below.
        }
      }
    }

    if (userRole !== 'coach' && userRole !== 'player') {
      return res.status(401).json({ error: 'Access Key has been revoked or is invalid.' });
    }

    // Attach to request
    (req as any).user = { role: userRole, username, playerId: (req as any).sessionPlayerId, actorId: (req as any).sessionActorId };

    // Players are read-only. Lineup comments remain shared; coach VOD notes and replies are private.
    const playerWritable = req.method === 'POST' && (req.path === '/lineup/comment'
      || req.path === '/engine-adapters/ranked/consent' || req.path === '/engine-adapters/ranked/revoke'
      || req.path === '/replay-intake/devices/enroll' || req.path === '/replay-intake/devices/revoke');
    if (req.method !== 'GET' && userRole === 'player' && !playerWritable) {
      return res.status(403).json({ error: 'Forbidden: Player accounts are read-only. Only Coach can make changes.' });
    }

    next();
  });

  // Authenticated, application-owned storage telemetry. This deliberately reports
  // measured MoeTracker payload bytes rather than pretending to be the provider's
  // billable figure (Firestore indexes/metadata are visible only in Cloud billing).
  app.get('/api/storage/status', async (_req, res) => {
    try {
      const db = await readDB();
      const databaseBytes = Buffer.byteLength(JSON.stringify(db), 'utf8');
      const intake = db.replayIntake || {};
      const jobs = Object.values(intake.parserJobs || {}) as any[];
      const blobs = Object.values(intake.blobs || {}) as any[];
      const retainedEvidenceBytes = jobs.reduce((total, job) => total + (job?.result ? Buffer.byteLength(JSON.stringify(job.result), 'utf8') : 0), 0);
      const temporaryRawBytes = blobs.reduce((total, blob) => total + (blob?.rawObject && blob?.uploadStatus !== 'deleted' ? Number(blob.size || 0) : 0), 0);
      const freeTierBaselineBytes = cloudflareRuntime ? 500 * 1024 ** 2 : 1024 ** 3;
      const configuredCap = Number(process.env.APP_STORAGE_SAFETY_CAP_BYTES);
      const safetyCapBytes = Number.isSafeInteger(configuredCap) && configuredCap > 0
        ? Math.min(freeTierBaselineBytes, Math.max(64 * 1024 ** 2, configuredCap)) : 768 * 1024 ** 2;
      const usedBytes = databaseBytes;
      const percentOfBaseline = Math.min(100, (usedBytes / freeTierBaselineBytes) * 100);
      const status = usedBytes >= freeTierBaselineBytes ? 'over-baseline' : usedBytes >= safetyCapBytes ? 'warning' : 'tracked-below-cap';
      res.json({
        measuredAt: new Date().toISOString(), basis: 'active-app-payload', databaseBytes, temporaryRawBytes, retainedEvidenceBytes,
        combinedTrackedBytes: databaseBytes + temporaryRawBytes,
        usedBytes, remainingBytes: Math.max(0, freeTierBaselineBytes - usedBytes), percentOfBaseline,
        freeTierBaselineBytes, safetyCapBytes, status, freeTierVerified: false, rawCoachModeEnabled: process.env.REPLAY_RAW_GCS_ENABLED === 'true',
        providerOverheadIncluded: false,
        note: cloudflareRuntime
          ? 'Tracked payload is measured against the Cloudflare D1 Free database limit. It excludes indexes and inactive revisions, so the Cloudflare dashboard remains the billing authority.'
          : 'Tracked payload excludes inactive database revisions, indexes and metadata. The provider dashboard remains the billing authority.'
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Storage status could not be measured.' });
    }
  });

  // GET list of custom active keys (Only Coach can view)
  app.get('/api/keys', async (req, res) => {
    try {
      if ((req as any).user?.role !== 'coach') {
        return res.status(403).json({ error: 'Only the coach can view access keys.' });
      }
      const db = await readDB();
      if (!db.authKeys) db.authKeys = [];
      res.json(db.authKeys.map(({ key, keyHash, passwordHash, passwordSalt, ...metadata }: any) => metadata));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create a custom key (Only Coach can create)
  app.post('/api/keys/create', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const body = validate(schemas.createKeySchema, req.body, res); if (!body) return;
      const { label, role, playerId } = body;

      const db = await readDB();
      if (!db.authKeys) db.authKeys = [];
      if (role === 'player' && (!playerId || !(db.rosterPlayers || []).some((player: any) => player.id === playerId && !player.retiredAt))) {
        return res.status(400).json({ error: 'Player access must be linked to an active roster identity.' });
      }

      // Generate a nice random key like RAAD-PLAY-XXXXXX
      const rand = crypto.randomBytes(16).toString('hex').toUpperCase();
      const generatedKey = `RAAD-${role === 'coach' ? 'COACH' : 'PLAY'}-${rand}`;

      const newKey = {
        id: uid(),
        keyHash: hashAccessKey(generatedKey),
        label: label.trim(),
        role: role,
        ...(role === 'player' ? { playerId } : {}),
        createdAt: new Date().toISOString()
      };

      db.authKeys.push(newKey);
      await saveDB(db);

      res.json({ ...newKey, keyHash: undefined, key: generatedKey });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST revoke a key (Only Coach can revoke)
  app.post('/api/keys/revoke', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const body = validate(schemas.idSchema, req.body, res); if (!body) return;
      const { id } = body;

      const db = await readDB();
      if (!db.authKeys) db.authKeys = [];

      db.authKeys = db.authKeys.filter((k: any) => k.id !== id);
      await saveDB(db);

      res.json({ success: true, message: 'Access key has been revoked successfully.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Google Sign-In access allowlist (coach-only) ---
  const requireCoach = (req: any, res: any): boolean => {
    if ((req.user?.role) !== 'coach') {
      res.status(403).json({ error: 'Only the coach can manage access.' });
      return false;
    }
    return true;
  };

  // Set or reset a simple player password. Only salted scrypt material is stored;
  // rotating the version nonce invalidates every prior password-issued session.
  app.post('/api/player-password', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const body = validate(schemas.playerPasswordSchema, req.body, res); if (!body) return;
      const db = await readDB();
      if (!db.authKeys) db.authKeys = [];
      const player = (db.rosterPlayers || []).find((item: any) => item.id === body.playerId && !item.retiredAt);
      if (!player) return res.status(400).json({ error: 'Password access requires an active roster player.' });
      const id = `player-password:${player.id}`;
      const previous = db.authKeys.find((entry: any) => entry.id === id);
      // This is deliberately unpredictable rather than a counter: deleting and
      // recreating the stable key id must never resurrect an older signed JWT.
      const credentialVersion = crypto.randomUUID();
      const verifier = await createPlayerPasswordVerifier(body.password);
      const updatedAt = new Date().toISOString();
      const entry = { id, label: player.displayName, role: 'player', playerId: player.id, credentialType: 'player-password', credentialVersion, ...verifier, createdAt: previous?.createdAt || updatedAt, updatedAt };
      db.authKeys = db.authKeys.filter((item: any) => item.id !== id);
      db.authKeys.push(entry);
      await saveDB(db);
      return res.json({ success: true, playerId: player.id, playerName: player.displayName, credentialVersion, updatedAt });
    } catch (err: any) {
      if (err?.status === 409) return res.status(409).json({ error: 'Password changed concurrently. Refresh and retry.' });
      return res.status(500).json({ error: err.message });
    }
  });

  // GET the list of Google accounts allowed to sign in
  app.get('/api/access', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const db = await readDB();
      res.json(db.allowedUsers || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST add (or update the role of) an allowed Google account
  app.post('/api/access/add', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const body = validate(schemas.accessAddSchema, req.body, res); if (!body) return;
      const { email, role, name } = body;
      const clean = String(email).trim().toLowerCase();
      const finalRole = role === 'coach' ? 'coach' : 'player';
      const db = await readDB();
      if (!db.allowedUsers) db.allowedUsers = [];
      const existing = db.allowedUsers.find((u: any) => (u.email || '').toLowerCase() === clean);
      if (existing) {
        existing.role = finalRole;
        if (name) existing.name = name;
      } else {
        db.allowedUsers.push({ email: clean, role: finalRole, name: name || '', addedAt: new Date().toISOString() });
      }
      await saveDB(db);
      res.json(db.allowedUsers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST remove an allowed Google account (revokes their access immediately)
  app.post('/api/access/remove', async (req, res) => {
    try {
      if (!requireCoach(req, res)) return;
      const body = validate(schemas.accessRemoveSchema, req.body, res); if (!body) return;
      const clean = String(body.email).trim().toLowerCase();
      const db = await readDB();
      if (!db.allowedUsers) db.allowedUsers = [];
      db.allowedUsers = db.allowedUsers.filter((u: any) => (u.email || '').toLowerCase() !== clean);
      await saveDB(db);
      res.json(db.allowedUsers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // VOD Review + Lineup Library routes (extracted module)
  registerVodLineupRoutes(app);

  // Core data + match logging routes (extracted module)
  registerDataRoutes(app);

  // Stable player identities, core membership history and named tryout batches.
  registerRosterRoutes(app);

  // Persisted, offline-only adapters for accepted replay, shadow-rating and ranked engines.
  registerEngineAdapterRoutes(app);

  await registerReplayDeviceRoutes(app);

  // Integrations routes (secrets, calendar, Henrik, VLR, GRID) — extracted module
  registerIntegrationRoutes(app);

  // Gemini Vision routes (screenshot OCR + scrim auto-import) — extracted module
  if (!cloudflareRuntime) {
    const aiRoute = './lib/routes/aiVision';
    const extraRoute = './lib/routes/extras';
    const [{ registerAiVisionRoutes }, { registerExtraRoutes }] = await Promise.all([import(aiRoute), import(extraRoute)]);
    registerAiVisionRoutes(app);
    registerExtraRoutes(app);
  } else {
    app.post(['/api/ai/screenshot', '/api/gemini/analyze-match', '/api/gemini/generate-setup'], (_req, res) => res.status(410).json({ error: 'Paid cloud AI is disabled. Use the free local scoreboard and replay tools.' }));
    app.post('/api/backup', async (_req, res) => {
      const db = await readDB();
      res.setHeader('Content-disposition', `attachment; filename=moetracker_export_${Date.now()}.json`);
      res.type('application/json').send(JSON.stringify(toPublicTrackerData(db), null, 2));
    });
    app.post('/api/import', async (req, res) => {
      const payload = stripLegacySecrets(req.body || {});
      const required = ['settings', 'matches', 'playerStats', 'rounds', 'schedule', 'goals'];
      const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(payload, key));
      if (missing.length) return res.status(400).json({ error: `Invalid backup schema. Missing keys: ${missing.join(', ')}` });
      const current = await readDB();
      for (const key of ['replayIntake', 'engineAdapters', 'authKeys', 'allowedUsers', 'secretValues', '_storage']) delete (payload as any)[key];
      const authKeys = current.authKeys || []; const allowedUsers = current.allowedUsers || [];
      for (const key of Object.keys(current)) if (!['_storage', 'authKeys', 'allowedUsers'].includes(key)) delete current[key];
      Object.assign(current, payload, { authKeys, allowedUsers });
      await saveDB(current);
      res.json({ success: true, privateEvidenceCleared: true });
    });
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));

  // Never serve backend artifacts, including the former public build paths.
  app.get(['/server.cjs', '/server.cjs.map', '/build/server.cjs', '/build/server.cjs.map'], (_req, res) => res.sendStatus(404));

  // Vite development integration
  if (serveFrontend && process.env.NODE_ENV !== 'production') {
    const vitePackage = 'vite';
    const { createServer: createViteServer } = await import(vitePackage);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (serveFrontend) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Centralized error handler — catches anything thrown outside a route's try/catch.
  // Logs with context and returns a sanitized message (never a stack trace) to clients.
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const user = (req as any).user?.username || 'anon';
    console.error(`[error] ${req.method} ${req.originalUrl} (user=${user}):`, err?.message || err);
    if (res.headersSent) return;
    res.status(err?.status || 500).json({ error: 'An unexpected server error occurred.' });
  });

  return app;
}

if (process.env.NODE_ENV !== 'test' && process.env.CLOUDFLARE_WORKER !== 'true') {
  createApp().then((app) => {
    const port = Number(process.env.PORT) || 3000;
    app.listen(port, '0.0.0.0', () => console.log(`Scrim Tracker Server running on port ${port}`));
  }).catch((error) => {
    console.error('Server startup failed:', error.message);
    process.exitCode = 1;
  });
}

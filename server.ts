import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { Type } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import * as schemas from './schemas';
import { uid, validate, safeEqual, clientIp, loginLockRemaining, loginRecordFail, loginRecordSuccess, cached } from './lib/utils';
import { readDB, saveDB, DB_PATH } from './lib/store';
import { henrikSyncPlayer, postDiscordReport } from './lib/services';
import { registerVodLineupRoutes } from './lib/routes/vodLineup';
import { registerIntegrationRoutes } from './lib/routes/integrations';
import { registerAiVisionRoutes } from './lib/routes/aiVision';
import { registerDataRoutes } from './lib/routes/data';
import { ai } from './lib/clients';

// Load environment variables
dotenv.config();

// Google Sign-In config (dormant unless GOOGLE_CLIENT_ID is set — password auth always works).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_session_signing_key_2026';
const BOOTSTRAP_ADMIN_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').toLowerCase();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;





async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Hydrate secrets saved via the UI into process.env, without clobbering values
  // already provided by the deployment environment (those take precedence).
  try {
    const bootDb = await readDB();
    if (bootDb.secretValues) {
      for (const [name, value] of Object.entries(bootDb.secretValues)) {
        if (!process.env[name] && value) process.env[name] = String(value);
      }
    }
  } catch (e) {
    console.warn('Could not hydrate persisted secrets at startup.');
  }

  app.disable('x-powered-by');

  // Security headers (defense-in-depth). CSP allows Google Identity Services + arbitrary
  // image hosts (lineup screenshots) while blocking plugins and framing.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com",
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
    res.json({ status: 'ok', time: new Date().toISOString() });
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
      const adminPass = process.env.ADMIN_PASSWORD || 'raad_coach_2026';

      // 1. Check Master Admin Key
      if (safeEqual(cleanKey, adminPass)) {
        loginRecordSuccess(ip);
        return res.json({
          success: true,
          role: 'coach',
          username: 'Administrator (Master)',
          key: cleanKey
        });
      }

      // 2. Check Custom Active Keys in DB
      const db = await readDB();
      if (!db.authKeys) db.authKeys = [];

      const foundKey = db.authKeys.find((k: any) => k.key === cleanKey);
      if (foundKey) {
        loginRecordSuccess(ip);
        return res.json({
          success: true,
          role: foundKey.role,
          username: foundKey.label,
          key: foundKey.key
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

  // POST verify a Google ID token, check the email allowlist, issue a session token.
  app.post('/api/auth/google', async (req, res) => {
    try {
      if (!googleClient) {
        return res.status(400).json({ error: 'Google Sign-In is not configured on this server.' });
      }
      const body = validate(schemas.googleAuthSchema, req.body, res); if (!body) return;
      const { credential } = body;

      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload();
      const email = (payload?.email || '').toLowerCase();
      if (!email || !payload?.email_verified) {
        return res.status(401).json({ error: 'Google account email could not be verified.' });
      }

      const db = await readDB();
      if (!db.allowedUsers) db.allowedUsers = [];

      let entry = db.allowedUsers.find((u: any) => (u.email || '').toLowerCase() === email);

      // Bootstrap: if this email matches BOOTSTRAP_ADMIN_EMAIL, auto-grant coach on first sign-in.
      if (!entry && BOOTSTRAP_ADMIN_EMAIL && email === BOOTSTRAP_ADMIN_EMAIL) {
        entry = { email, role: 'coach', name: payload?.name || email, addedAt: new Date().toISOString() };
        db.allowedUsers.push(entry);
        await saveDB(db);
      }

      if (!entry) {
        return res.status(403).json({ error: 'Your Google account is not authorized. Ask the coach to grant you access.' });
      }

      const name = payload?.name || entry.name || email;
      const token = jwt.sign({ email, role: entry.role, name, kind: 'google' }, JWT_SECRET, { expiresIn: '30d' });
      res.json({ success: true, role: entry.role, username: name, key: token });
    } catch (err: any) {
      res.status(401).json({ error: 'Google verification failed.' });
    }
  });

  // Cron endpoint: sync every configured player's Solo Queue. Guarded by a shared
  // secret header (set CRON_SECRET) so Cloud Scheduler can call it without a coach key.
  // Registered before the auth middleware so it isn't gated by the bearer token.
  app.post('/api/cron/sync-soloq', async (req, res) => {
    try {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers['x-cron-secret'] !== secret) {
        return res.status(401).json({ error: 'Unauthorized cron request.' });
      }
      const db = await readDB();
      const players: string[] = Object.keys(db.settings.riotIds || {});
      const results: any[] = [];
      for (const player of players) {
        try {
          results.push(await henrikSyncPlayer(db, player));
        } catch (e: any) {
          results.push({ player, error: e.message });
        }
      }
      await saveDB(db);
      res.json({ synced: results.filter(r => !r.error).length, total: players.length, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Cron endpoint: write a dated backup copy of the database. Guarded by CRON_SECRET.
  // Backups land next to db.json (e.g. /data/backups/db-YYYY-MM-DD.json on the bucket mount).
  app.post('/api/cron/backup', async (req, res) => {
    try {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers['x-cron-secret'] !== secret) {
        return res.status(401).json({ error: 'Unauthorized cron request.' });
      }
      const db = await readDB();
      const backupDir = path.join(path.dirname(DB_PATH), 'backups');
      await fs.mkdir(backupDir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 10);
      const backupPath = path.join(backupDir, `db-${stamp}.json`);
      await fs.writeFile(backupPath, JSON.stringify(db, null, 2), 'utf-8');
      res.json({ success: true, file: backupPath });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Authorization middleware protecting all subsequent API routes
  app.use('/api', async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Session expired or invalid. Please provide an Access Key.' });
    }

    const clientKey = authHeader.split(' ')[1];
    const adminPass = process.env.ADMIN_PASSWORD || 'raad_coach_2026';

    let userRole = '';
    let username = '';

    if (safeEqual(clientKey, adminPass)) {
      userRole = 'coach';
      username = 'Administrator';
    } else {
      const db = await readDB();
      if (!db.authKeys) db.authKeys = [];
      const found = db.authKeys.find((k: any) => k.key === clientKey);
      if (found) {
        userRole = found.role;
        username = found.label;
      } else {
        // Try a Google session token. The email is re-checked against the allowlist on
        // every request, so removing someone from the panel revokes them instantly.
        try {
          const decoded: any = jwt.verify(clientKey, JWT_SECRET);
          if (decoded?.kind === 'google' && decoded.email) {
            const entry = (db.allowedUsers || []).find((u: any) => (u.email || '').toLowerCase() === String(decoded.email).toLowerCase());
            if (entry) {
              userRole = entry.role;
              username = decoded.name || entry.email;
            }
          }
        } catch {
          // Not a valid session token — falls through to 401 below.
        }
      }
    }

    if (!userRole) {
      return res.status(401).json({ error: 'Access Key has been revoked or is invalid.' });
    }

    // Attach to request
    (req as any).user = { role: userRole, username };

    // Prevent write operations for players (read-only) — except posting replies/comments,
    // which players are explicitly allowed to do.
    const playerWritable = req.path.endsWith('/vod/reply') || req.path.endsWith('/lineup/comment');
    if (req.method !== 'GET' && userRole === 'player' && !playerWritable) {
      return res.status(403).json({ error: 'Forbidden: Player accounts are read-only. Only Coach can make changes.' });
    }

    next();
  });

  // GET list of custom active keys (Only Coach can view)
  app.get('/api/keys', async (req, res) => {
    try {
      if ((req as any).user?.role !== 'coach') {
        return res.status(403).json({ error: 'Only the coach can view access keys.' });
      }
      const db = await readDB();
      if (!db.authKeys) db.authKeys = [];
      res.json(db.authKeys);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create a custom key (Only Coach can create)
  app.post('/api/keys/create', async (req, res) => {
    try {
      const { label, role } = req.body;
      if (!label || !role) {
        return res.status(400).json({ error: 'Label and Role are required.' });
      }

      const db = await readDB();
      if (!db.authKeys) db.authKeys = [];

      // Generate a nice random key like RAAD-PLAY-XXXXXX
      const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
      const generatedKey = `RAAD-${role === 'coach' ? 'COACH' : 'PLAY'}-${rand}`;

      const newKey = {
        id: uid(),
        key: generatedKey,
        label: label.trim(),
        role: role,
        createdAt: new Date().toISOString()
      };

      db.authKeys.push(newKey);
      await saveDB(db);

      res.json(newKey);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST revoke a key (Only Coach can revoke)
  app.post('/api/keys/revoke', async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: 'Key ID is required.' });
      }

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

  // Integrations routes (secrets, calendar, Henrik, VLR, GRID) — extracted module
  registerIntegrationRoutes(app);

  // Gemini Vision routes (screenshot OCR + scrim auto-import) — extracted module
  registerAiVisionRoutes(app);

  // POST Backup file download helper
  app.post('/api/backup', async (req, res) => {
    try {
      const db = await readDB();
      res.setHeader('Content-disposition', `attachment; filename=scrim_tracker_backup_${Date.now()}.json`);
      res.setHeader('Content-type', 'application/json');
      res.write(JSON.stringify(db, null, 2));
      res.end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST Import full JSON backup payload
  app.post('/api/import', async (req, res) => {
    try {
      const payload = req.body;
      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Invalid payload.' });
      }
      
      // Basic structures check
      const requiredKeys = ['settings', 'matches', 'playerStats', 'rounds', 'schedule', 'goals'];
      const missingKeys = requiredKeys.filter(k => !payload.hasOwnProperty(k));
      if (missingKeys.length > 0) {
        return res.status(400).json({
          error: `Invalid backup schema. Missing keys: ${missingKeys.join(', ')}`
        });
      }

      // Valid structure: write to db.json
      await saveDB(payload);
      res.json({ success: true, message: 'Database successfully imported!' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST run AI Coach match analysis using server-side Gemini API
  app.post('/api/gemini/analyze-match', async (req, res) => {
    try {
      const { matchId } = req.body;
      if (!matchId) {
        return res.status(400).json({ error: 'matchId is required.' });
      }

      const db = await readDB();
      const match = db.matches.find((m: any) => m.id === matchId);
      if (!match) {
        return res.status(404).json({ error: 'Match not found.' });
      }

      const stats = db.playerStats.filter((s: any) => s.matchId === matchId);
      const rounds = db.rounds.filter((r: any) => r.matchId === matchId).sort((a: any, b: any) => a.roundNo - b.roundNo);

      const prompt = `
You are a Tier-1 professional Valorant Head Coach and Tactical Analyst.
Please analyze the following match data and provide a detailed tactical coaching report.

[MATCH METADATA]
Map: ${match.map}
Opponent: ${match.opponent}
Type: ${match.type}
Date: ${match.date}
Result: Our Score ${match.attW + match.defW} - Their Score ${match.attL + match.defL} (Attack Wins: ${match.attW}, Attack Losses: ${match.attL}, Defense Wins: ${match.defW}, Defense Losses: ${match.defL})
Pistols: Attack Pistol: ${match.pistolAtt || 'N/A'}, Defense Pistol: ${match.pistolDef || 'N/A'}
Ecos: Attack Eco: ${match.ecoAtt || 'N/A'}, Defense Eco: ${match.ecoDef || 'N/A'}
Bonus: Attack Bonus: ${match.bonusAtt || 'N/A'}, Defense Bonus: ${match.bonusDef || 'N/A'}

[PLAYER STATS]
${stats.map((s: any) => `- ${s.player} (Agent: ${s.agent}): ${s.kills}K / ${s.deaths}D / ${s.assists}A. ACS: ${s.acs || 'N/A'}, ADR: ${s.adr || 'N/A'}, HS%: ${s.hs || 'N/A'}%, First Bloods: ${s.fk || 0}, First Deaths: ${s.fd || 0}, Clutches: ${s.cl || 0}, Traded Deaths: ${s.dTraded || 0}`).join('\n')}

[ROUND BY ROUND LOG]
${rounds.map((r: any) => `Round ${r.roundNo} (${r.side}): Result: ${r.result}, Win Reason: ${r.winBy || 'N/A'}, Planted: ${r.plant || 'No'} (Site: ${r.site || 'N/A'}). Economy: Our Buy: ${r.buy || 'N/A'} vs Enemy Buy: ${r.enemyBuy || 'N/A'}. First Kill: ${r.firstKillBy || 'N/A'}, First Death: ${r.firstDeathBy || 'N/A'}. Throw? ${r.isThrow === 'TRUE' || r.isThrow === true ? `YES (by ${r.thrownBy || 'N/A'}, Reason: ${r.throwReason || 'N/A'})` : 'No'}. IGL Caller: ${r.iglPlayer || 'N/A'} (${r.iglRole || 'Caller'}). Mid-round calling change: ${r.midRoundIglChange ? 'Yes' : 'No'}. Strategies Run: ${r.strategies || 'None'}. Notes: ${r.notes || 'None'}`).join('\n')}

Please construct your analysis in a structured, professional, clear Markdown format. Focus on high-signal actionable insights.
You must strictly follow these rules:
1. Prioritize tactical issues by expected win-rate impact, capped at a maximum of 5 items.
2. Phrase each issue strictly with specific location + round-type (e.g., "B-site defender overpeeks on bonus rounds cost 15% win probability" rather than generalities like "Improve defensive setups").
3. For each of the ~5 prioritized issues, provide:
   - Expected Win-Rate Impact % (estimation based on match rounds)
   - Specific Location + Round-Type
   - Precise Root Cause (what exactly went wrong, which players/roles were involved)
   - Actionable Corrective Drill (specific micro-practice or protocol)

Structure the output as follows:
- **Executive Win-Rate Impact Priority List**: The ~5 high-signal items structured strictly as requested above.
- **First Bloods & Opening Duels Conversion**: Evaluation of opening duels and converted rounds. Did we win rounds when getting the first kill? Did we crumble on first deaths?
- **Strategy, Calling & IGL Evaluation**: Look at the strategies run. Which setups had the highest win rates? How did IGL call-changes affect performance? Is the secondary caller helping?
- **Roster & Agent Recommendations**: Agent swaps, position adjustments, or calling changes for the next match.
`;

      const response = await ai.models.generateContent({
        model: db.settings.ai?.model || 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction: 'You are an elite, objective, analytical esports coach who delivers high-density, sharp tactical feedback. You MUST prioritize issues by expected win-rate impact, capped at ~5 items, and phrase each with specific location + round-type (e.g. "B-site defender overpeeks on bonus rounds cost 15% win probability" rather than generalities like "Improve defensive setups"). Use professional, concise language.',
        }
      });

      const analysisText = response.text || '';
      
      // Save directly into the database on the match row
      const matchIdx = db.matches.findIndex((m: any) => m.id === matchId);
      if (matchIdx >= 0) {
        db.matches[matchIdx].aiAnalysis = analysisText;
        await saveDB(db);
      }

      res.json({ aiAnalysis: analysisText });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST broadcast match summaries and AI briefs to Discord Webhook
  app.post('/api/broadcast-discord', async (req, res) => {
    try {
      const { matchId } = req.body;
      if (!matchId) {
        return res.status(400).json({ error: 'matchId is required.' });
      }
      const db = await readDB();
      const result = await postDiscordReport(db, matchId);
      if (!result.success && result.error === 'Match not found.') {
        return res.status(404).json(result);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST generate AI strategy playbook setups using server-side Gemini API
  app.post('/api/gemini/generate-setup', async (req, res) => {
    try {
      const { map, side, playStyle, customFocus } = req.body;
      if (!map || !side || !playStyle) {
        return res.status(400).json({ error: 'map, side, and playStyle are required.' });
      }

      const db = await readDB();

      const SETUP_PROMPT = `You are a Tier-1 professional Valorant Head Coach and Strategic Mastermind.
Create an exceptionally high-quality tactical strategy playbook entry for the map **${map}** on the **${side}** side.
The strategy style is **${playStyle}** ${customFocus ? `with the focus: "${customFocus}"` : ''}.

Return a JSON object matching this schema precisely:
{
  "name": "Strategy Name (short, snappy, e.g. 'A-Shatter Split')",
  "agents": "Recommended Agent Composition (e.g. Jett, Omen, Cypher, Fade, Breach)",
  "overview": "A 2-sentence tactical concept/summary explaining the strategy's goal.",
  "phase1": "Preparation & Early Round Setup (What each role/agent does at start of round)",
  "phase2": "The Trigger & Execution Phase (How we take space or initiate the trap)",
  "phase3": "Post-Plant or Late Round Management (Defensive hold, delay, or retake setup)",
  "combo": "Key utility synergy combination (e.g., Fade Seize + Breach Aftershock on A-Main)",
  "notes": "Key coaching tip for success (under 30 words)."
}`;

      const response = await ai.models.generateContent({
        model: db.settings.ai?.model || 'gemini-2.5-flash',
        contents: SETUP_PROMPT,
        config: {
          systemInstruction: 'You are an accurate, elite tactical play generator. You output only valid structured JSON representing the tactical play.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              agents: { type: Type.STRING },
              overview: { type: Type.STRING },
              phase1: { type: Type.STRING },
              phase2: { type: Type.STRING },
              phase3: { type: Type.STRING },
              combo: { type: Type.STRING },
              notes: { type: Type.STRING }
            },
            required: ['name', 'agents', 'overview', 'phase1', 'phase2', 'phase3', 'combo', 'notes']
          }
        }
      });

      const jsonStr = response.text || '{}';
      res.json(JSON.parse(jsonStr));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vite development integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Scrim Tracker Server running on port ${PORT}`);
  });
}

// Last-resort guards so a stray rejection/exception logs instead of crashing silently.
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

startServer();

import type { Express } from 'express';
import { readDB, saveDB } from '../store';
import { uid } from '../utils';

// Integrations: secrets, calendar mocks, HenrikDev (Riot verify + Solo Q sync),
// VLR.gg scraping, and GRID match import. All protected routes (registered after
// the auth middleware).
export function registerIntegrationRoutes(app: Express) {
  // GET secret status
  app.get('/api/secret-status', async (req, res) => {
    try {
      const db = await readDB();
      res.json({
        ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY || !!db.secrets.ANTHROPIC_API_KEY,
        HENRIK_API_KEY: !!process.env.HENRIK_API_KEY,
        GRID_API_KEY: !!process.env.GRID_API_KEY
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET integration status for the UI health panel
  app.get('/api/integrations-status', async (req, res) => {
    try {
      const has = (v: any) => !!v;
      res.json({
        gemini: { configured: has(process.env.GEMINI_API_KEY), note: 'AI coach, tactical hub, screenshot OCR (needs active billing)' },
        henrik: { configured: false, note: 'Legacy ranked integration disabled; provider eligibility, versioned consent and exact account gating are not persisted' },
        grid: { configured: has(process.env.GRID_API_KEY), note: 'GRID match import' },
        discord: { configured: has(process.env.DISCORD_WEBHOOK_URL), note: 'Automatic match report broadcasts' },
        vlr: { configured: false, note: 'Disabled until team-side mapping and idempotency are verified' },
        dailySync: { configured: false, note: 'Legacy scheduled ranked sync disabled' }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET writable calendars
  app.get('/api/list-calendars', (req, res) => {
    res.json([
      { id: 'primary', name: 'Primary Calendar' },
      { id: 'scrims@group.calendar.google.com', name: 'Esports Scrims' }
    ]);
  });

  // POST Google Calendar mocks
  app.post('/api/sync-calendar', async (req, res) => {
    try {
      const { row } = req.body;
      const db = await readDB();
      row.gcalEventId = 'ev_' + Math.random().toString(36).substring(2, 12);
      
      const idx = db.schedule.findIndex((x: any) => x.id === row.id);
      if (idx >= 0) db.schedule[idx] = row;
      else db.schedule.push(row);

      await saveDB(db);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/unsync-calendar', async (req, res) => {
    try {
      const { row } = req.body;
      const db = await readDB();
      row.gcalEventId = '';
      
      const idx = db.schedule.findIndex((x: any) => x.id === row.id);
      if (idx >= 0) db.schedule[idx] = row;
      
      await saveDB(db);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST HenrikDev Verify Riot ID
  app.post('/api/verify-riot', async (req, res) => {
    res.status(503).json({ disabled: true, fetched: false, wrote: false, reason: 'ranked-sync-gate-unavailable', error: 'Legacy Riot verification is disabled until eligible provider and consent/account gates are persisted.' });
  });

  // POST HenrikDev Sync Solo Q rank/RR + today's real W/L
  app.post('/api/sync-soloq', async (req, res) => {
    res.status(503).json({ disabled: true, fetched: false, wrote: false, reason: 'ranked-sync-gate-unavailable', error: 'Ranked sync requires eligible provider access, explicit versioned consent, and exact account identity.' });
  });

  const vlrDisabled = (res: any) => res.status(503).json({
    disabled: true,
    fetched: false,
    wrote: false,
    error: 'VLR import is disabled until team-side mapping and idempotency are verified. No network request was made and no tracker data was written.',
  });

  app.get('/api/vlr-team-matches', (_req, res) => vlrDisabled(res));
  app.get('/api/vlr-team-map-stats', (_req, res) => vlrDisabled(res));
  app.post('/api/import-vlr-match', (_req, res) => vlrDisabled(res));

  // POST import GRID.gg live telemetry series feed
  app.post('/api/import-grid-match', async (req, res) => {
    try {
      const { matchId } = req.body;
      if (!matchId) {
        return res.status(400).json({ error: 'GRID Series ID or Match ID is required.' });
      }

      const gridApiKey = process.env.GRID_API_KEY;
      if (!gridApiKey) {
        return res.status(503).json({ error: 'GRID_API_KEY is not configured in the deployment environment.' });
      }

      let details: any = null;
      if (gridApiKey && gridApiKey !== 'false') {
        try {
          // Attempt real GRID.gg series request using custom header
          const resp = await fetch(`https://api.grid.gg/live-data-feed/v1/series/${matchId}`, {
            headers: { 
              'x-api-key': gridApiKey,
              'accept': 'application/json'
            }
          });
          if (resp.ok) {
            details = await resp.json();
          }
        } catch (e) {
          console.warn('GRID API request failed.');
        }
      }

      if (!details) {
        return res.status(502).json({ error: 'GRID returned no usable telemetry. No match was imported.' });
      }

      // The provider response varies by subscription/feed version. Do not fabricate a
      // match until a supported response schema and mapping are implemented.
      return res.status(501).json({
        error: 'GRID responded successfully, but this telemetry schema is not supported yet. No match was imported.'
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

import type { Express } from 'express';
import { readDB } from '../store';

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
        grid: { configured: false, note: 'GRID import disabled until provider eligibility, activation and schema gates are accepted' },
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

  const calendarUnavailable = (_req: any, res: any) => res.status(503).json({
    disabled: true, wrote: false, eventId: null,
    error: 'Calendar sync is unavailable until a real provider adapter and authorization gate are implemented.',
  });
  app.post('/api/sync-calendar', calendarUnavailable);
  app.post('/api/unsync-calendar', calendarUnavailable);

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
  app.post('/api/import-grid-match', (_req, res) => res.status(503).json({
    disabled: true, fetched: false, wrote: false,
    error: 'GRID import is unavailable until provider eligibility, activation and schema gates are accepted.',
  }));
}

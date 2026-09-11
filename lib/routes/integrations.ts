import type { Express } from 'express';
import { readDB, saveDB } from '../store';
import { uid, cached } from '../utils';
import { henrikSyncPlayer } from '../services';

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
      const db = await readDB();
      const s = db.settings || {};
      const has = (v: any) => !!v;
      res.json({
        gemini: { configured: has(process.env.GEMINI_API_KEY), note: 'AI coach, tactical hub, screenshot OCR (needs active billing)' },
        henrik: { configured: has(process.env.HENRIK_API_KEY), note: 'Riot ID verification + Solo Queue sync' },
        grid: { configured: has(process.env.GRID_API_KEY), note: 'GRID match import' },
        discord: { configured: has(process.env.DISCORD_WEBHOOK_URL), note: 'Automatic match report broadcasts' },
        vlr: { configured: has(s.vlr && s.vlr.teamId), note: 'VLR.gg match import' },
        dailySync: { configured: has(process.env.CRON_SECRET), note: 'Scheduled daily Solo Queue sync' }
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
    try {
      const { name, tag } = req.body;
      if (!name || !tag) {
        return res.status(400).json({ error: 'Riot name and tag are required.' });
      }

      const apiKey = process.env.HENRIK_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: 'HenrikDev API key is not configured. Add it in Settings to verify Riot IDs.' });
      }

      const resp = await fetch(`https://api.henrikdev.xyz/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`, {
        headers: { Authorization: apiKey }
      });
      if (!resp.ok) {
        return res.status(resp.status === 404 ? 404 : 502).json({
          error: resp.status === 404
            ? `Riot ID ${name}#${tag} was not found.`
            : `HenrikDev verification failed (status ${resp.status}).`
        });
      }
      const parsed = await resp.json();
      res.json({
        name: parsed.data.name,
        tag: parsed.data.tag,
        region: parsed.data.region,
        level: parsed.data.account_level
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST HenrikDev Sync Solo Q rank/RR + today's real W/L
  app.post('/api/sync-soloq', async (req, res) => {
    try {
      const { player } = req.body;
      const db = await readDB();
      const result = await henrikSyncPlayer(db, player);
      await saveDB(db);
      res.json({ ...result, days: 1 });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // VLR.GG match listing (cached 5 min; honest error if the scraper is unavailable)
  app.get('/api/vlr-team-matches', async (req, res) => {
    try {
      const db = await readDB();
      const id = db.settings.vlr.teamId || '1471';
      const baseUrl = db.settings.vlr.baseUrl || 'https://vlrggapi.vercel.app';
      const data = await cached(`vlr-matches-${baseUrl}-${id}`, 5 * 60 * 1000, async () => {
        const resp = await fetch(`${baseUrl}/v2/team?id=${id}&q=matches&page=1`);
        if (!resp.ok) throw Object.assign(new Error(`VLR.gg returned status ${resp.status}.`), { status: 502 });
        const parsed = await resp.json();
        return (parsed.data && parsed.data.matches) || [];
      });
      res.json(data);
    } catch (err: any) {
      res.status(err.status || 502).json({ error: `Could not load VLR.gg matches: ${err.message}` });
    }
  });

  // VLR.GG team map aggregates (cached 5 min; honest error if the scraper is unavailable)
  app.get('/api/vlr-team-map-stats', async (req, res) => {
    try {
      const db = await readDB();
      const id = db.settings.vlr.teamId || '1471';
      const baseUrl = db.settings.vlr.baseUrl || 'https://vlrggapi.vercel.app';
      const data = await cached(`vlr-mapstats-${baseUrl}-${id}`, 5 * 60 * 1000, async () => {
        const resp = await fetch(`${baseUrl}/v2/team?id=${id}&q=stats`);
        if (!resp.ok) throw Object.assign(new Error(`VLR.gg returned status ${resp.status}.`), { status: 502 });
        const parsed = await resp.json();
        return (parsed.data && parsed.data.segments) || [];
      });
      res.json(data);
    } catch (err: any) {
      res.status(err.status || 502).json({ error: `Could not load VLR.gg map stats: ${err.message}` });
    }
  });

  // Import vlr.gg match details
  app.post('/api/import-vlr-match', async (req, res) => {
    try {
      const { matchId } = req.body;
      if (!matchId) {
        return res.status(400).json({ error: 'matchId is required.' });
      }
      const db = await readDB();
      const ourName = db.settings.vlr.teamName || db.settings.teamName || 'RAAD';
      const baseUrl = db.settings.vlr.baseUrl || 'https://vlrggapi.vercel.app';

      const resp = await fetch(`${baseUrl}/v2/match/details?match_id=${matchId}`);
      const details: any = resp.ok ? (await resp.json()).data : null;
      if (!details || !Array.isArray(details.teams) || !Array.isArray(details.maps)) {
        return res.status(502).json({ error: `Could not fetch match ${matchId} from VLR.gg — the parser may be down or the match ID is invalid.` });
      }

      const opponent = details.teams[0].name === ourName ? details.teams[1].name : details.teams[0].name;
      const date = details.date ? details.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
      const importedMaps: any[] = [];

      details.maps.forEach((mp: any) => {
        const mapName = db.settings.maps.find((m: string) => m.toLowerCase() === mp.map_name.toLowerCase()) || mp.map_name;
        
        // 13-10 scores example
        const matchRow = {
          id: uid(),
          date,
          type: 'Official',
          opponent,
          map: mapName,
          attW: mp.score ? Number(mp.score.team1?.t || 8) : 8,
          attL: mp.score ? Number(mp.score.team2?.ct || 4) : 4,
          defW: mp.score ? Number(mp.score.team1?.ct || 5) : 5,
          defL: mp.score ? Number(mp.score.team2?.t || 6) : 6,
          pistolAtt: 'W',
          pistolDef: 'L',
          ecoAtt: 'W',
          ecoDef: 'W',
          bonusAtt: 'L',
          bonusDef: 'L',
          vod: '',
          notes: 'Imported from vlr.gg',
          source: 'vlr',
          vlrMatchId: String(matchId)
        };

        const statsRows = (mp.players?.team1 || []).map((p: any) => ({
          player: p.name,
          agent: p.agent || 'Omen',
          kAtt: Math.floor(Number(p.kills) / 2),
          kDef: Math.ceil(Number(p.kills) / 2),
          dAtt: Math.floor(Number(p.deaths) / 2),
          dDef: Math.ceil(Number(p.deaths) / 2),
          aAtt: Math.floor(Number(p.assists) / 2),
          aDef: Math.ceil(Number(p.assists) / 2),
          kills: Number(p.kills),
          deaths: Number(p.deaths),
          assists: Number(p.assists),
          acs: Number(p.acs || 200),
          adr: Number(p.adr || 140),
          hs: Number(p.hs_pct || 20),
          fk: Number(p.fk || 0),
          fd: Number(p.fd || 0),
          rating: String(p.rating || '1.0')
        }));

        db.matches.push(matchRow);
        db.playerStats = db.playerStats.filter((ps: any) => ps.matchId !== matchRow.id);
        statsRows.forEach((st: any) => {
          st.id = uid();
          st.matchId = matchRow.id;
          db.playerStats.push(st);
        });

        // Seed rounds
        const mapRounds = (mp.rounds || []).map((rd: any) => ({
          id: uid(),
          matchId: matchRow.id,
          roundNo: Number(rd.round_num),
          side: rd.side === 't' ? 'Att' : 'Def',
          buy: 'Full',
          enemyBuy: 'Full',
          result: rd.winner === 'team1' ? 'W' : 'L',
          winBy: 'Elimination',
          plant: '',
          site: 'A',
          notes: ''
        }));
        db.rounds.push(...mapRounds);

        importedMaps.push({ map: mapName, id: matchRow.id });
      });

      // parse vetos
      let vetoCount = 0;
      if (details.map_vetos && importedMaps.length > 0) {
        const parts = String(details.map_vetos).split(';');
        parts.forEach((p, idx) => {
          const rawPart = p.trim();
          if (!rawPart) return;
          const actor = rawPart.toLowerCase().includes(ourName.toLowerCase()) ? 'us' : 'them';
          const action = rawPart.toLowerCase().includes('ban') ? 'ban' : rawPart.toLowerCase().includes('pick') ? 'pick' : 'decider';
          const map = db.settings.maps.find((m: string) => rawPart.toLowerCase().includes(m.toLowerCase())) || 'Haven';

          db.vetos.push({
            id: uid(),
            matchId: importedMaps[0].id,
            date,
            opponent,
            seq: idx + 1,
            actor: action === 'decider' ? '' : actor,
            action,
            map,
            result: ''
          });
          vetoCount++;
        });
      }

      await saveDB(db);
      res.json({ matchId: String(matchId), opponent, date, maps: importedMaps, vetos: vetoCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

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

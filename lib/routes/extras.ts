import type { Express } from 'express';
import { Type } from '@google/genai';
import { ai } from '../clients';
import { readDB, saveDB } from '../store';
import { postDiscordReport } from '../services';

// Backup/restore, AI coach match analysis + setup generation, and Discord broadcast.
// Protected routes registered after the auth middleware.
export function registerExtraRoutes(app: Express) {
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
}

import type { Express } from 'express';
import { Type } from '@google/genai';
import { ai } from '../clients';
import { readDB } from '../store';
import { validate } from '../utils';
import * as schemas from '../../schemas';

// Gemini Vision routes: single scoreboard OCR + full scrim auto-import (scoreboard
// + round-timeline). Protected routes registered after the auth middleware.
export function registerAiVisionRoutes(app: Express) {
  // POST import scoreboard screenshot via server-side Gemini API
  app.post('/api/import-screenshot', async (req, res) => {
    try {
      const reqBody = validate(schemas.screenshotSchema, req.body, res); if (!reqBody) return;
      const { base64, mediaType } = reqBody;

      const db = await readDB();

      const SCOREBOARD_PROMPT = `You are reading a VALORANT end-of-game scoreboard screenshot.
Analyze the image and return a JSON object containing the match map, scores, and list of player metrics.
Follow these rules strictly:
- Include every player row you can read, from both teams (typically 10 rows).
- 'ourScore' represents the score of the team on the left or allied team. 'theirScore' is the enemy team score on the right. If you cannot tell, set confident to false and put the higher score in ourScore.
- ACS, ADR, HS%, First Bloods (fk), and First Deaths (fd) should be integers. If you cannot read a value, set it to null.
- Extract player names and agent names.`;

      // Use the pre-configured Workspace server-side Gemini API key!
      const response = await ai.models.generateContent({
        model: db.settings.ai?.model || 'gemini-2.5-flash',
        contents: [
          {
            inlineData: {
              mimeType: mediaType,
              data: base64
            }
          },
          SCOREBOARD_PROMPT
        ],
        config: {
          systemInstruction: 'You are an accurate OCR document and gaming scoreboard extractor. You translate images to precise structured JSON data.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              map: { type: Type.STRING, description: 'Valorant map name (e.g. Ascent, Bind)' },
              ourScore: { type: Type.INTEGER, description: 'Allied score' },
              theirScore: { type: Type.INTEGER, description: 'Enemy score' },
              confident: { type: Type.BOOLEAN, description: 'Whether the allied team selection is fully reliable' },
              players: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: 'Riot player username (e.g. TenZ)' },
                    agent: { type: Type.STRING, description: 'Valorant Agent name (e.g. Jett, Omen)' },
                    acs: { type: Type.INTEGER, nullable: true },
                    kills: { type: Type.INTEGER },
                    deaths: { type: Type.INTEGER },
                    assists: { type: Type.INTEGER },
                    adr: { type: Type.INTEGER, nullable: true },
                    hs: { type: Type.INTEGER, nullable: true },
                    fk: { type: Type.INTEGER, nullable: true, description: 'First Bloods' },
                    fd: { type: Type.INTEGER, nullable: true, description: 'First Deaths' }
                  },
                  required: ['name', 'agent', 'kills', 'deaths', 'assists']
                }
              }
            },
            required: ['map', 'ourScore', 'theirScore', 'confident', 'players']
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error('Gemini OCR returned an empty text response.');
      }

      const parsed = JSON.parse(responseText.trim());

      // Attempt to automatically match names against settings players
      const roster = db.settings.players || [];
      const lowerRoster = roster.map((p: string) => p.toLowerCase());
      (parsed.players || []).forEach((p: any) => {
        const idx = lowerRoster.indexOf(String(p.name || '').toLowerCase());
        p.matched = idx >= 0 ? roster[idx] : '';
      });

      res.json(parsed);
    } catch (err: any) {
      console.error('OCR API Error:', err);
      res.status(500).json({ error: 'Gemini Screenshot parsing failed.', details: err.message });
    }
  });

  // POST auto-import a full scrim from a scoreboard image (+ optional round-timeline image).
  // Extracts players/score AND round-by-round results in one shot for coach review.
  app.post('/api/import-scrim', async (req, res) => {
    try {
      const body = validate(schemas.scrimImportSchema, req.body, res); if (!body) return;
      const { scoreboard, timeline } = body;
      const db = await readDB();
      const model = db.settings.ai?.model || 'gemini-2.5-flash';

      // 1) Scoreboard: map, score, players.
      const sbResp = await ai.models.generateContent({
        model,
        contents: [
          { inlineData: { mimeType: scoreboard.mediaType, data: scoreboard.base64 } },
          `You are reading a VALORANT end-of-game scoreboard screenshot. Return the map, the allied (left) team score as ourScore, the enemy (right) score as theirScore, and every player row from both teams. ACS/ADR/HS%/first bloods (fk)/first deaths (fd) are integers or null if unreadable. If you cannot tell which side is allied, set confident to false and put the higher score in ourScore.`
        ],
        config: {
          systemInstruction: 'You are an accurate OCR scoreboard extractor that outputs precise structured JSON.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              map: { type: Type.STRING },
              ourScore: { type: Type.INTEGER },
              theirScore: { type: Type.INTEGER },
              confident: { type: Type.BOOLEAN },
              players: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING }, agent: { type: Type.STRING },
                    acs: { type: Type.INTEGER, nullable: true },
                    kills: { type: Type.INTEGER }, deaths: { type: Type.INTEGER }, assists: { type: Type.INTEGER },
                    adr: { type: Type.INTEGER, nullable: true }, hs: { type: Type.INTEGER, nullable: true },
                    fk: { type: Type.INTEGER, nullable: true }, fd: { type: Type.INTEGER, nullable: true }
                  },
                  required: ['name', 'agent', 'kills', 'deaths', 'assists']
                }
              }
            },
            required: ['map', 'ourScore', 'theirScore', 'confident', 'players']
          }
        }
      });
      const parsed = JSON.parse((sbResp.text || '{}').trim());

      // Roster matching.
      const roster = db.settings.players || [];
      const lowerRoster = roster.map((p: string) => p.toLowerCase());
      (parsed.players || []).forEach((p: any) => {
        const idx = lowerRoster.indexOf(String(p.name || '').toLowerCase());
        p.matched = idx >= 0 ? roster[idx] : '';
      });

      // 2) Optional round timeline: per-round win/loss + win condition.
      let rounds: any[] = [];
      if (timeline?.base64 && timeline?.mediaType) {
        const tlResp = await ai.models.generateContent({
          model,
          contents: [
            { inlineData: { mimeType: timeline.mediaType, data: timeline.base64 } },
            `You are reading the VALORANT round-history timeline (the horizontal strip of per-round icons at the top of the end-of-game scoreboard). For each round left-to-right starting at 1, return roundNo, whether the LEFT/allied team won it (won: true/false), and the win condition if the icon is clear (one of: Elimination, Defuse, Spike, Time). Return every round you can see, in order.`
          ],
          config: {
            systemInstruction: 'You are an accurate OCR extractor that outputs precise structured JSON.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                rounds: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      roundNo: { type: Type.INTEGER },
                      won: { type: Type.BOOLEAN },
                      winCondition: { type: Type.STRING, nullable: true }
                    },
                    required: ['roundNo', 'won']
                  }
                }
              },
              required: ['rounds']
            }
          }
        });
        const tlParsed = JSON.parse((tlResp.text || '{}').trim());
        rounds = (tlParsed.rounds || []).map((r: any) => ({
          roundNo: Number(r.roundNo) || 0,
          result: r.won ? 'W' : 'L',
          winBy: r.winCondition || ''
        })).sort((a: any, b: any) => a.roundNo - b.roundNo);
      }

      res.json({ ...parsed, rounds });
    } catch (err: any) {
      console.error('Scrim import error:', err);
      res.status(500).json({ error: 'Gemini scrim import failed.', details: err.message });
    }
  });
}

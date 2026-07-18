import type { Express } from 'express';
import { readDB, saveDB } from '../store';
import { uid, validate } from '../utils';
import * as schemas from '../../schemas';

const author = (req: any) => ({ name: req.user?.username || 'Unknown', role: req.user?.role || 'player' });

// VOD Review (timestamped coach insights + player replies) and Lineup Library
// (media + comments). Registered after the auth middleware; player writes to
// /vod/reply and /lineup/comment are permitted by that middleware's whitelist.
export function registerVodLineupRoutes(app: Express) {
  // POST create/update a VOD review (coach)
  app.post('/api/vod/save', async (req, res) => {
    try {
      const parsed = validate(schemas.vodSaveSchema, req.body, res); if (!parsed) return;
      const review = parsed.review as any;
      if (!review.vodUrl) return res.status(400).json({ error: 'A VOD URL is required.' });
      const db = await readDB();
      if (!db.vodReviews) db.vodReviews = [];
      if (!review.id) {
        review.id = uid();
        review.createdAt = new Date().toISOString();
        review.notes = [];
        db.vodReviews.unshift(review);
      } else {
        const idx = db.vodReviews.findIndex((v: any) => v.id === review.id);
        if (idx >= 0) db.vodReviews[idx] = { ...db.vodReviews[idx], ...review };
        else { review.notes = review.notes || []; db.vodReviews.unshift(review); }
      }
      await saveDB(db);
      res.json(db.vodReviews);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST remove a VOD review (coach)
  app.post('/api/vod/remove', async (req, res) => {
    try {
      const { id } = req.body;
      const db = await readDB();
      db.vodReviews = (db.vodReviews || []).filter((v: any) => v.id !== id);
      await saveDB(db);
      res.json(db.vodReviews);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST add a timestamped insight to a review (coach)
  app.post('/api/vod/note', async (req, res) => {
    try {
      const body = validate(schemas.vodNoteSchema, req.body, res); if (!body) return;
      const { reviewId, seconds, timeLabel, text } = body;
      const db = await readDB();
      const review = (db.vodReviews || []).find((v: any) => v.id === reviewId);
      if (!review) return res.status(404).json({ error: 'VOD review not found.' });
      if (!review.notes) review.notes = [];
      review.notes.push({
        id: uid(), seconds: Number(seconds) || 0, timeLabel: timeLabel || '0:00',
        text, ...author(req), createdAt: new Date().toISOString(), replies: []
      });
      review.notes.sort((a: any, b: any) => (a.seconds || 0) - (b.seconds || 0));
      await saveDB(db);
      res.json(db.vodReviews);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST remove a note from a review (coach)
  app.post('/api/vod/note/remove', async (req, res) => {
    try {
      const { reviewId, noteId } = req.body;
      const db = await readDB();
      const review = (db.vodReviews || []).find((v: any) => v.id === reviewId);
      if (review) review.notes = (review.notes || []).filter((n: any) => n.id !== noteId);
      await saveDB(db);
      res.json(db.vodReviews);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST reply to an insight (coach OR player)
  app.post('/api/vod/reply', async (req, res) => {
    try {
      const body = validate(schemas.vodReplySchema, req.body, res); if (!body) return;
      const { reviewId, noteId, text } = body;
      const db = await readDB();
      const review = (db.vodReviews || []).find((v: any) => v.id === reviewId);
      const note = review?.notes?.find((n: any) => n.id === noteId);
      if (!note) return res.status(404).json({ error: 'Insight not found.' });
      if (!note.replies) note.replies = [];
      note.replies.push({ id: uid(), text, ...author(req), createdAt: new Date().toISOString() });
      await saveDB(db);
      res.json(db.vodReviews);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST create/update a lineup (coach)
  app.post('/api/lineup/save', async (req, res) => {
    try {
      const parsed = validate(schemas.lineupSaveSchema, req.body, res); if (!parsed) return;
      const lineup = parsed.lineup as any;
      if (!lineup.title) return res.status(400).json({ error: 'A lineup title is required.' });
      const db = await readDB();
      if (!db.lineups) db.lineups = [];
      if (!lineup.id) {
        lineup.id = uid();
        lineup.createdAt = new Date().toISOString();
        lineup.comments = [];
        db.lineups.unshift(lineup);
      } else {
        const idx = db.lineups.findIndex((l: any) => l.id === lineup.id);
        if (idx >= 0) db.lineups[idx] = { ...db.lineups[idx], ...lineup };
        else { lineup.comments = lineup.comments || []; db.lineups.unshift(lineup); }
      }
      await saveDB(db);
      res.json(db.lineups);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST remove a lineup (coach)
  app.post('/api/lineup/remove', async (req, res) => {
    try {
      const { id } = req.body;
      const db = await readDB();
      db.lineups = (db.lineups || []).filter((l: any) => l.id !== id);
      await saveDB(db);
      res.json(db.lineups);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST comment on a lineup (coach OR player)
  app.post('/api/lineup/comment', async (req, res) => {
    try {
      const body = validate(schemas.lineupCommentSchema, req.body, res); if (!body) return;
      const { lineupId, text } = body;
      const db = await readDB();
      const lineup = (db.lineups || []).find((l: any) => l.id === lineupId);
      if (!lineup) return res.status(404).json({ error: 'Lineup not found.' });
      if (!lineup.comments) lineup.comments = [];
      lineup.comments.push({ id: uid(), text, ...author(req), createdAt: new Date().toISOString() });
      await saveDB(db);
      res.json(db.lineups);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
}

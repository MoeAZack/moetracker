import type { Express, Request, Response } from 'express';
import { readDB, saveDB } from '../store';
import { validate } from '../utils';
import * as schemas from '../../schemas';
import {
  addCoreMembership,
  addTryoutCandidate,
  archiveAndResetSeason,
  archiveAndResetTryoutBatch,
  createRosterPlayer,
  createTryoutBatch,
  endCoreMembership,
  promoteTryoutCandidate,
  restoreTryoutBatch,
  restoreSeasonArchive,
} from '../roster';

function requireCoach(req: Request, res: Response) {
  if ((req as any).user?.role !== 'coach') {
    res.status(403).json({ error: 'Only an owner or coach can manage rosters.' });
    return false;
  }
  return true;
}

async function mutate(req: Request, res: Response, operation: (db: any) => any) {
  if (!requireCoach(req, res)) return;
  try {
    const db = await readDB();
    const result = operation(db);
    await saveDB(db);
    res.json(result);
  } catch (err: any) {
    res.status(err?.status || 500).json({ error: err?.message || 'Roster update failed.' });
  }
}

export function registerRosterRoutes(app: Express) {
  app.post('/api/roster/players', (req, res) => {
    const body = validate(schemas.rosterPlayerCreateSchema, req.body, res); if (!body) return;
    return mutate(req, res, db => createRosterPlayer(db, body.displayName));
  });

  app.post('/api/roster/core/add', (req, res) => {
    const body = validate(schemas.rosterPlayerIdSchema, req.body, res); if (!body) return;
    return mutate(req, res, db => addCoreMembership(db, body.playerId));
  });

  app.post('/api/roster/core/remove', (req, res) => {
    const body = validate(schemas.rosterPlayerIdSchema, req.body, res); if (!body) return;
    return mutate(req, res, db => endCoreMembership(db, body.playerId));
  });

  app.post('/api/roster/tryouts', (req, res) => {
    const body = validate(schemas.tryoutCreateSchema, req.body, res); if (!body) return;
    return mutate(req, res, db => createTryoutBatch(db, body.name));
  });

  app.post('/api/roster/tryouts/candidates', (req, res) => {
    const body = validate(schemas.tryoutCandidateSchema, req.body, res); if (!body) return;
    return mutate(req, res, db => addTryoutCandidate(db, body.batchId, body.playerId));
  });

  app.post('/api/roster/tryouts/archive-reset', (req, res) => {
    const body = validate(schemas.tryoutArchiveResetSchema, req.body, res); if (!body) return;
    return mutate(req, res, db => archiveAndResetTryoutBatch(db, body.batchId, body.newBatchName));
  });

  app.post('/api/roster/tryouts/restore', (req, res) => {
    const body = validate(schemas.tryoutBatchIdSchema, req.body, res); if (!body) return;
    return mutate(req, res, db => restoreTryoutBatch(db, body.batchId));
  });

  app.post('/api/roster/tryouts/promote', (req, res) => {
    const body = validate(schemas.tryoutCandidateSchema, req.body, res); if (!body) return;
    return mutate(req, res, db => promoteTryoutCandidate(db, body.batchId, body.playerId));
  });

  app.post('/api/roster/seasons/archive-reset', (req, res) => {
    const body = validate(schemas.seasonArchiveResetSchema, req.body, res); if (!body) return;
    return mutate(req, res, db => {
      const archive = archiveAndResetSeason(db, body.archiveName, body.newSeasonName);
      return { id: archive.id, name: archive.name, seasonName: archive.seasonName, archivedAt: archive.archivedAt, schemaVersion: archive.schemaVersion };
    });
  });

  app.post('/api/roster/seasons/restore', (req, res) => {
    const body = validate(schemas.seasonArchiveRestoreSchema, req.body, res); if (!body) return;
    return mutate(req, res, db => {
      const archive = restoreSeasonArchive(db, body.archiveId);
      return { id: archive.id, name: archive.name, seasonName: archive.seasonName, restored: true };
    });
  });
}


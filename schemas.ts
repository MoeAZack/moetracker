import { z } from 'zod';

// The app stores flexible row objects, so we validate the envelope/types and known
// required fields, but allow extra properties rather than over-constraining the data.
const looseObject = z.object({}).passthrough();
const nonEmpty = z.string().min(1);
const shortText = z.string().min(1).max(5000);
const imagePayload = z.object({ base64: nonEmpty, mediaType: nonEmpty });

export const loginKeySchema = z.object({ key: z.string().min(1).max(500) });
export const googleAuthSchema = z.object({ credential: z.string().min(1).max(8000) });

export const upsertSchema = z.object({
  sheet: z.enum(['Schedule', 'Goals', 'Matches', 'SoloQ', 'Strats', 'StratRuns']),
  row: looseObject
});
export const removeSchema = z.object({ sheet: nonEmpty, id: nonEmpty });
export const idSchema = z.object({ id: nonEmpty });

export const settingsSchema = looseObject;

export const saveMatchSchema = z.object({ match: looseObject, stats: z.array(looseObject).optional() });
export const saveRoundsSchema = z.object({ matchId: nonEmpty, rows: z.array(looseObject).optional() });
export const saveVetoSchema = z.object({ matchId: nonEmpty, meta: looseObject, actions: z.array(looseObject).optional() });

export const setSecretSchema = z.object({ name: z.string().min(1).max(100), value: z.string().max(8000).optional().nullable() });

export const accessAddSchema = z.object({ email: z.string().email().max(200), role: z.enum(['coach', 'player']).optional(), name: z.string().max(200).optional() });
export const accessRemoveSchema = z.object({ email: z.string().min(1).max(200) });

export const vodSaveSchema = z.object({ review: looseObject });
export const vodNoteSchema = z.object({ reviewId: nonEmpty, seconds: z.number().optional(), timeLabel: z.string().max(20).optional(), text: shortText });
export const vodNoteRemoveSchema = z.object({ reviewId: nonEmpty, noteId: nonEmpty });
export const vodReplySchema = z.object({ reviewId: nonEmpty, noteId: nonEmpty, text: shortText });

export const lineupSaveSchema = z.object({ lineup: looseObject });
export const lineupCommentSchema = z.object({ lineupId: nonEmpty, text: shortText });

export const scrimImportSchema = z.object({ scoreboard: imagePayload, timeline: imagePayload.optional() });
export const screenshotSchema = imagePayload;

import type {
  EntryCorrectionMetadata,
  EntrySourceMetadata,
  ScreenshotReviewDraft,
} from '../src/types';

const SOURCE_METHODS = new Set(['manual', 'screenshot', 'live-logger', 'provider-import', 'unknown']);
const META_FIELDS = new Set(['id', 'matchId', 'sourceMetadata', 'corrections']);

function isKnownInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function resolvedTotal(stat: Record<string, any>, total: string, first: string, second: string) {
  if (isKnownInteger(stat[first]) && isKnownInteger(stat[second])) return stat[first] + stat[second];
  return isKnownInteger(stat[total]) ? stat[total] : null;
}

/** Complete side splits are authoritative; otherwise preserve the imported total. */
export function reconcileStatTotals<T extends Record<string, any>>(stat: T): T {
  return {
    ...stat,
    kills: resolvedTotal(stat, 'kills', 'kAtt', 'kDef'),
    deaths: resolvedTotal(stat, 'deaths', 'dAtt', 'dDef'),
    assists: resolvedTotal(stat, 'assists', 'aAtt', 'aDef'),
  };
}

function sourceMethod(legacySource: unknown): EntrySourceMetadata['method'] {
  if (legacySource === 'manual') return 'manual';
  if (legacySource === 'live-logger') return 'live-logger';
  if (legacySource === 'ocr' || legacySource === 'scrim-import') return 'screenshot';
  if (legacySource === 'grid' || legacySource === 'vlr') return 'provider-import';
  return 'unknown';
}

function changedFields(existing: Record<string, any>, incoming: Record<string, any>) {
  return [...new Set([...Object.keys(existing), ...Object.keys(incoming)])]
    .filter(key => !META_FIELDS.has(key))
    .filter(key => JSON.stringify(existing[key]) !== JSON.stringify(incoming[key]))
    .sort();
}

/** Source is write-once and corrections are server-appended; client copies are ignored. */
export function applyImmutableEntryMetadata<T extends Record<string, any>>(
  existing: Record<string, any> | undefined,
  incoming: T,
  actor: string,
  timestamp: string,
  inheritedSource?: EntrySourceMetadata,
): T {
  const submittedSource = incoming.sourceMetadata;
  const validSubmittedSource = submittedSource && SOURCE_METHODS.has(submittedSource.method)
    ? submittedSource as EntrySourceMetadata
    : undefined;
  const sourceMetadata: EntrySourceMetadata = structuredClone(
    existing?.sourceMetadata
      || validSubmittedSource
      || inheritedSource
      || { method: sourceMethod(existing?.source ?? incoming.source), capturedAt: timestamp },
  );
  const corrections: EntryCorrectionMetadata[] = structuredClone(existing?.corrections || []);
  const fields = existing ? changedFields(existing, incoming) : [];
  if (fields.length > 0) corrections.push({ correctedAt: timestamp, correctedBy: actor, fields });
  return { ...incoming, sourceMetadata, corrections };
}

type ScreenshotOptions = {
  model: string;
  capturedAt: string;
  rosterPlayers: Array<{ id?: string; displayName: string }>;
  rounds?: Array<{ roundNo: number; result: 'W' | 'L'; winBy?: string | null }>;
};

/** Normalize every screenshot extractor into one non-writing, review-required contract. */
export function buildScreenshotReviewDraft(raw: any, options: ScreenshotOptions): ScreenshotReviewDraft {
  const rosterByName = new Map(options.rosterPlayers.map(player => [player.displayName.toLocaleLowerCase(), player]));
  const nullable = (value: unknown): number | null => isKnownInteger(value) ? value : null;
  return {
    contractVersion: 1,
    status: 'review-required',
    reviewRequired: true,
    sourceMetadata: {
      method: 'screenshot',
      provider: 'gemini',
      model: options.model,
      capturedAt: options.capturedAt,
    },
    match: {
      opponent: '',
      type: 'Scrim',
      map: typeof raw.map === 'string' && raw.map.trim() ? raw.map.trim() : null,
      ourScore: nullable(raw.ourScore),
      theirScore: nullable(raw.theirScore),
      alliedSideConfirmed: raw.confident === true,
      attW: null,
      attL: null,
      defW: null,
      defL: null,
    },
    stats: (Array.isArray(raw.players) ? raw.players : []).map((player: any) => {
      const extractedName = typeof player.name === 'string' ? player.name.trim() : '';
      const match = rosterByName.get(extractedName.toLocaleLowerCase());
      return {
        extractedName,
        matchedPlayerId: match?.id || null,
        matchedPlayerName: match?.displayName || null,
        agent: typeof player.agent === 'string' && player.agent.trim() ? player.agent.trim() : null,
        kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null,
        kills: nullable(player.kills), deaths: nullable(player.deaths), assists: nullable(player.assists),
        acs: nullable(player.acs), adr: nullable(player.adr), hs: nullable(player.hs),
        fk: nullable(player.fk), fd: nullable(player.fd),
      };
    }),
    rounds: (options.rounds || []).map(round => ({
      roundNo: round.roundNo,
      result: round.result,
      winBy: round.winBy || null,
    })),
  };
}

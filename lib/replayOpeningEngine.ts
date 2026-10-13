export type ReplayUnknownReason =
  | 'unsupported-file'
  | 'incomplete-file'
  | 'cross-check-mismatch'
  | 'missing-capability'
  | 'invalid-round-structure'
  | 'missing-early-sequence'
  | 'identity-ambiguity'
  | 'unknown-event'
  | 'unresolved-order'
  | 'no-qualifying-elimination';

export interface ReplayPlayerIdentity {
  playerId: string;
  teamId: string;
  displayName?: string;
}

export interface ReplayPlayerSummary {
  playerId: string;
  kills?: number | null;
  deaths?: number | null;
}

export interface ReplayMatchSummary {
  map?: string | null;
  finalScore?: { teamA: number; teamB: number } | null;
  roundCount?: number | null;
  players?: readonly ReplayPlayerSummary[];
}

export interface ReplayEliminationEvent {
  eventId?: string | null;
  roundNumber: number;
  sequence?: number | null;
  timestampMs?: number | null;
  kind: 'player-elimination' | 'environmental' | 'non-player' | 'unknown';
  killerPlayerId?: string | null;
  victimPlayerId?: string | null;
  killerTeamId?: string | null;
  victimTeamId?: string | null;
  identityStatus?: 'resolved' | 'ambiguous' | 'unknown';
  duplicateOfEventId?: string | null;
  resurrectionArtifact?: boolean;
  /** Explicit parser evidence only. Unknown source/detail must remain null or omitted. */
  killSource?: 'weapon' | 'ability' | 'melee' | 'environmental' | 'unknown' | null;
  headshot?: boolean | null;
}

export interface ReplayRoundDraft {
  roundNumber: number;
  /** True only when the parser guarantees that the event stream begins before any elimination. */
  sequenceCompleteFromStart: boolean;
  events: readonly ReplayEliminationEvent[];
  participantPlayerIds?: readonly string[];
  /** Required for life-state derivations; expected count prevents a subset from masquerading as a full round. */
  participantCoverage?: { status: 'complete' | 'partial' | 'unknown'; expectedPlayerCount?: number };
  winnerTeamId?: string | null;
  endReason?: string | null;
  sideByTeam?: Readonly<Record<string, 'attack' | 'defense' | 'unknown'>>;
}

export type ReplayEvidenceGrade = 'event-log' | 'video-observation' | 'ocr' | 'inference';
export type ReplayEvidenceSignal =
  | 'eliminations' | 'assists' | 'damage' | 'utility-cast' | 'utility-effect' | 'ultimate-use'
  | 'plant' | 'defuse' | 'round-winner' | 'round-end-reason' | 'side'
  | 'economy' | 'loadout' | 'credits' | 'ultimate-state'
  | 'site-entry' | 'execute' | 'rotation' | 'retake' | 'post-plant' | 'save-eco-decision'
  | 'objective-timing' | 'position-zone' | 'round-phase' | 'orb-capture' | 'kill-details';

export interface ReplaySourceCapability {
  signal: ReplayEvidenceSignal;
  support: 'complete' | 'partial' | 'unsupported';
  grade: ReplayEvidenceGrade;
  coveredRoundNumbers?: readonly number[];
  details?: string;
}

/** Adapter-normalized observation. `attributes` carries only explicitly sourced signal detail. */
export interface ReplayEvidenceObservation {
  observationId: string;
  roundNumber: number;
  signal: ReplayEvidenceSignal;
  grade: ReplayEvidenceGrade;
  explicitlyPresent: boolean;
  confidence: number | null;
  occurredAtMs?: number | null;
  phase?: 'pre-round' | 'barrier' | 'early' | 'mid' | 'late' | 'post-plant' | 'round-end' | 'unknown';
  playerId?: string | null;
  targetPlayerId?: string | null;
  teamId?: string | null;
  attributes?: Readonly<Record<string, unknown>>;
}

export interface ReplayDerivationOptions {
  tradeWindowMs: number;
}

export interface ReplayParserDraftInput {
  parser: { name: string; version: string };
  provenance: Readonly<Record<string, string | number | boolean | null>>;
  file: { format: string; support: 'supported' | 'unsupported' | 'incomplete' };
  identities: readonly ReplayPlayerIdentity[];
  summary?: ReplayMatchSummary;
  rounds: readonly ReplayRoundDraft[];
  capabilities?: readonly ReplaySourceCapability[];
  observations?: readonly ReplayEvidenceObservation[];
  derivation?: Partial<ReplayDerivationOptions>;
}

export interface ReplayReviewReference {
  identities?: readonly ReplayPlayerIdentity[];
  summary?: ReplayMatchSummary;
}

export interface ReplayCrossCheck {
  field: 'identities' | 'map' | 'final-score' | 'rounds' | 'kills-deaths' | 'capabilities' | 'event-summary';
  status: 'match' | 'mismatch' | 'not-supplied';
  details?: string;
}

export interface OpeningRoundEvidence {
  roundNumber: number;
  status: 'resolved' | 'unknown';
  firstKillPlayerId: string | null;
  firstDeathPlayerId: string | null;
  sourceEventId: string | null;
  reason: ReplayUnknownReason | null;
  excludedEventCount: number;
}

export interface ReplayOpeningReviewDraft {
  contractVersion: 1;
  status: 'review-required';
  reviewRequired: true;
  writable: false;
  parser: ReplayParserDraftInput['parser'];
  provenance: ReplayParserDraftInput['provenance'];
  file: ReplayParserDraftInput['file'];
  crossChecks: ReplayCrossCheck[];
  rounds: OpeningRoundEvidence[];
  coverage: {
    playedRounds: number;
    resolvedRounds: number;
    unknownRounds: number;
    resolvedPercent: number | null;
    unknownReasons: Partial<Record<ReplayUnknownReason, number>>;
  };
  playerTotals: Array<{
    playerId: string;
    observedFirstKills: number | null;
    observedFirstDeaths: number | null;
    firstKills: number | null;
    firstDeaths: number | null;
  }>;
  evidence: {
    tradeWindowMs: number;
    capabilities: ReplaySourceCapability[];
    observations: ReplayEvidenceObservation[];
    observationIssues: string[];
    coverageBySignal: Array<{
      signal: ReplayEvidenceSignal;
      support: ReplaySourceCapability['support'];
      grade: ReplayEvidenceGrade;
      coveredRounds: number;
      playedRounds: number;
    }>;
    playerMetrics: Array<{
      playerId: string;
      kills: number | null;
      deaths: number | null;
      assists: number | null;
      damage: number | null;
      utilityCasts: number | null;
      utilityEffects: number | null;
      ultimateUses: number | null;
      plants: number | null;
      defuses: number | null;
      orbCaptures: number | null;
      headshotKills: number | null;
      eligibleHeadshotKills: number | null;
      headshotPercentage: number | null;
    }>;
    rounds: Array<{
      roundNumber: number;
      events: ReplayEliminationEvent[];
      winnerTeamId: string | null;
      endReason: string | null;
      sideByTeam: Readonly<Record<string, 'attack' | 'defense' | 'unknown'>> | null;
      derived: {
        /** Deaths after which at least one teammate remains alive; no engagement intent is inferred. */
        tradeOpportunities: number | null;
        successfulTrades: number | null;
        tradedDeathPlayerIds: string[] | null;
        multikills: Array<{ playerId: string; kills: number }> | null;
        clutches: Array<{ playerId: string; opponents: number; result: 'won' | 'lost' | 'unknown' }> | null;
      };
    }>;
  };
}

function knownNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function normalizedMap(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLocaleLowerCase() : null;
}

function sameScore(left: ReplayMatchSummary['finalScore'], right: ReplayMatchSummary['finalScore']): boolean {
  return !!left && !!right && left.teamA === right.teamA && left.teamB === right.teamB;
}

function identityMap(identities: readonly ReplayPlayerIdentity[]) {
  const map = new Map<string, ReplayPlayerIdentity>();
  const duplicates = new Set<string>();
  for (const identity of identities) {
    if (!identity.playerId || !identity.teamId || map.has(identity.playerId)) duplicates.add(identity.playerId);
    else map.set(identity.playerId, identity);
  }
  return { map, duplicates };
}

function duplicateKey(event: ReplayEliminationEvent): string {
  if (event.eventId) return `id:${event.eventId}`;
  return ['event', event.sequence ?? '', event.timestampMs ?? '', event.kind, event.killerPlayerId ?? '', event.victimPlayerId ?? ''].join(':');
}

function unknownRound(roundNumber: number, reason: ReplayUnknownReason, excludedEventCount: number): OpeningRoundEvidence {
  return { roundNumber, status: 'unknown', firstKillPlayerId: null, firstDeathPlayerId: null, sourceEventId: null, reason, excludedEventCount };
}

type CapabilityResolution = {
  capabilities: ReplaySourceCapability[];
  conflicts: string[];
  complete: (signal: ReplayEvidenceSignal, grade: ReplayEvidenceGrade, roundNumber?: number) => boolean;
  covered: (capability: ReplaySourceCapability) => number[];
};

function resolveCapabilities(input: ReplayParserDraftInput): CapabilityResolution {
  const roundIds = new Set(input.rounds.map(round => round.roundNumber));
  const byKey = new Map<string, ReplaySourceCapability>();
  const conflicts: string[] = [];
  for (const raw of input.capabilities || []) {
    const rounds = raw.coveredRoundNumbers === undefined
      ? undefined
      : [...new Set(raw.coveredRoundNumbers)].sort((a, b) => a - b);
    const normalized = { ...structuredClone(raw), ...(rounds === undefined ? {} : { coveredRoundNumbers: rounds }) };
    const key = `${raw.signal}:${raw.grade}`;
    if (rounds?.some(round => !roundIds.has(round)) || (raw.support === 'unsupported' && (rounds?.length || 0) > 0)) {
      conflicts.push(`Invalid coverage declaration for ${key}.`);
    }
    const existing = byKey.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(normalized)) conflicts.push(`Conflicting declarations for ${key}.`);
    else if (!existing) byKey.set(key, normalized);
  }
  const capabilities = [...byKey.values()];
  const covered = (capability: ReplaySourceCapability) => capability.support === 'unsupported'
    ? []
    : capability.coveredRoundNumbers === undefined
      ? capability.support === 'complete' ? [...roundIds].sort((a, b) => a - b) : []
      : [...capability.coveredRoundNumbers];
  const complete = (signal: ReplayEvidenceSignal, grade: ReplayEvidenceGrade, roundNumber?: number) => {
    const capability = byKey.get(`${signal}:${grade}`);
    if (!capability || capability.support !== 'complete') return false;
    const coverage = covered(capability);
    return roundNumber === undefined
      ? input.rounds.length > 0 && coverage.length === input.rounds.length
      : coverage.includes(roundNumber);
  };
  return { capabilities, conflicts: [...new Set(conflicts)], complete, covered };
}

type RoundAnalysis = {
  ordered: ReplayEliminationEvent[];
  eliminations: ReplayEliminationEvent[];
  orderResolved: boolean;
  identityComplete: boolean;
  lifeComplete: boolean;
  foreignEvent: boolean;
  eventConflict: boolean;
  unknownRelevant: boolean;
  participantComplete: boolean;
  excluded: number;
};

function participantState(round: ReplayRoundDraft, identities: Map<string, ReplayPlayerIdentity>) {
  const players = [...(round.participantPlayerIds || [])];
  const unique = new Set(players);
  const teams = new Set(players.map(playerId => identities.get(playerId)?.teamId).filter(Boolean));
  const expected = round.participantCoverage?.expectedPlayerCount;
  const complete = round.participantCoverage?.status === 'complete'
    && knownNonNegativeInteger(expected) && expected >= 2 && players.length === expected
    && unique.size === players.length && players.every(playerId => identities.has(playerId)) && teams.size === 2;
  return { players, set: unique, teams, complete };
}

function semanticEventKey(event: ReplayEliminationEvent): string {
  return JSON.stringify([
    event.roundNumber, event.kind, event.killerPlayerId ?? null, event.victimPlayerId ?? null,
    event.killerTeamId ?? null, event.victimTeamId ?? null, event.identityStatus ?? null,
    event.resurrectionArtifact === true,
  ]);
}

function fullEventKey(event: ReplayEliminationEvent): string {
  return JSON.stringify([
    semanticEventKey(event), event.eventId ?? null, event.duplicateOfEventId ?? null,
    event.sequence ?? null, event.timestampMs ?? null,
  ]);
}

function analyseRound(round: ReplayRoundDraft, identities: Map<string, ReplayPlayerIdentity>): RoundAnalysis {
  const sourceEvents = round.events.slice().sort((left, right) => fullEventKey(left).localeCompare(fullEventKey(right)));
  const byId = new Map<string, ReplayEliminationEvent[]>();
  for (const event of sourceEvents) {
    if (event.eventId) byId.set(event.eventId, [...(byId.get(event.eventId) || []), event]);
  }
  let eventConflict = [...byId.values()].some(events => new Set(events.map(fullEventKey)).size > 1);
  for (const event of sourceEvents.filter(item => item.duplicateOfEventId)) {
    const chainIds = new Set<string>(event.eventId ? [event.eventId] : []);
    const semantic = semanticEventKey(event);
    let cursor = event;
    while (cursor.duplicateOfEventId) {
      const targetId = cursor.duplicateOfEventId;
      if (chainIds.has(targetId)) { eventConflict = true; break; }
      chainIds.add(targetId);
      const targets = byId.get(targetId) || [];
      if (targets.length === 0 || new Set(targets.map(fullEventKey)).size > 1) { eventConflict = true; break; }
      const target = targets[0];
      if (semanticEventKey(target) !== semantic) { eventConflict = true; break; }
      cursor = target;
    }
  }
  const exactIdSeen = new Set<string>();
  const seen = new Set<string>();
  const unique = sourceEvents.filter(event => {
    if (event.eventId) {
      if (exactIdSeen.has(event.eventId)) return false;
      exactIdSeen.add(event.eventId);
    }
    const key = duplicateKey(event);
    if (event.duplicateOfEventId) {
      return false;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (sourceEvents.some(event => event.kind === 'player-elimination')
    && !unique.some(event => event.kind === 'player-elimination')) eventConflict = true;
  const relevant = unique.filter(event => !event.resurrectionArtifact && event.kind === 'player-elimination');
  const allSequences = relevant.every(event => knownNonNegativeInteger(event.sequence));
  const allTimes = relevant.every(event => knownNonNegativeInteger(event.timestampMs));
  const uniqueSequences = allSequences && new Set(relevant.map(event => event.sequence)).size === relevant.length;
  const uniqueTimes = allTimes && new Set(relevant.map(event => event.timestampMs)).size === relevant.length;
  const orderResolved = relevant.length <= 1 || uniqueSequences || uniqueTimes;
  const sortedRelevant = relevant.slice().sort((left, right) => uniqueSequences
    ? (left.sequence as number) - (right.sequence as number)
    : uniqueTimes ? (left.timestampMs as number) - (right.timestampMs as number) : duplicateKey(left).localeCompare(duplicateKey(right)));
  const rank = new Map(sortedRelevant.map((event, index) => [duplicateKey(event), index]));
  const ordered = unique.slice().sort((left, right) => {
    const leftRank = rank.get(duplicateKey(left));
    const rightRank = rank.get(duplicateKey(right));
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
    if (leftRank !== undefined) return -1;
    if (rightRank !== undefined) return 1;
    return duplicateKey(left).localeCompare(duplicateKey(right));
  });
  const participant = participantState(round, identities);
  const participants = participant.set;
  const dead = new Set<string>();
  let identityComplete = true;
  const unknownRelevant = unique.some(event => event.kind === 'unknown');
  let lifeComplete = participant.complete && round.sequenceCompleteFromStart && orderResolved && !eventConflict && !unknownRelevant;
  let foreignEvent = false;
  const eliminations: ReplayEliminationEvent[] = [];
  for (const event of ordered) {
    if (event.roundNumber !== round.roundNumber) { foreignEvent = true; lifeComplete = false; continue; }
    if (event.resurrectionArtifact) { lifeComplete = false; continue; }
    if (event.kind !== 'player-elimination') {
      if (event.kind !== 'unknown' || event.victimPlayerId) lifeComplete = false;
      continue;
    }
    const killer = event.killerPlayerId ? identities.get(event.killerPlayerId) : undefined;
    const victim = event.victimPlayerId ? identities.get(event.victimPlayerId) : undefined;
    const validIdentity = event.identityStatus === 'resolved' && !!killer && !!victim
      && killer.teamId === event.killerTeamId && victim.teamId === event.victimTeamId;
    if (!validIdentity) { identityComplete = false; lifeComplete = false; continue; }
    const opponentElimination = killer.playerId !== victim.playerId && killer.teamId !== victim.teamId;
    const participantActors = participants.has(killer.playerId) && participants.has(victim.playerId);
    if (dead.has(victim.playerId)) { lifeComplete = false; continue; }
    dead.add(victim.playerId);
    if (!opponentElimination) { lifeComplete = false; continue; }
    eliminations.push(event);
    if (!participantActors) lifeComplete = false;
  }
  return {
    ordered, eliminations, orderResolved, identityComplete, lifeComplete, foreignEvent,
    eventConflict, unknownRelevant, participantComplete: participant.complete,
    excluded: round.events.length - eliminations.length,
  };
}

function evaluateRound(
  round: ReplayRoundDraft,
  identities: Map<string, ReplayPlayerIdentity>,
  capabilities: CapabilityResolution,
): OpeningRoundEvidence {
  if (!capabilities.complete('eliminations', 'event-log', round.roundNumber)) return unknownRound(round.roundNumber, 'missing-capability', 0);
  if (!round.sequenceCompleteFromStart) return unknownRound(round.roundNumber, 'missing-early-sequence', 0);
  const analysis = analyseRound(round, identities);
  if (analysis.foreignEvent) return unknownRound(round.roundNumber, 'invalid-round-structure', analysis.excluded);
  if (analysis.eventConflict) return unknownRound(round.roundNumber, 'cross-check-mismatch', analysis.excluded);
  if (analysis.unknownRelevant) return unknownRound(round.roundNumber, 'unknown-event', analysis.excluded);
  if (!analysis.orderResolved) return unknownRound(round.roundNumber, 'unresolved-order', analysis.excluded);
  if (!analysis.identityComplete) return unknownRound(round.roundNumber, 'identity-ambiguity', analysis.excluded);
  if (analysis.eliminations.length === 0) return unknownRound(round.roundNumber, 'no-qualifying-elimination', analysis.excluded);
  const first = analysis.eliminations[0];
  return {
    roundNumber: round.roundNumber, status: 'resolved',
    firstKillPlayerId: first.killerPlayerId || null, firstDeathPlayerId: first.victimPlayerId || null,
    sourceEventId: first.eventId || null, reason: null, excludedEventCount: analysis.excluded,
  };
}

function buildCrossChecks(
  input: ReplayParserDraftInput,
  reference: ReplayReviewReference | undefined,
  identities: Map<string, ReplayPlayerIdentity>,
  capabilities: CapabilityResolution,
): ReplayCrossCheck[] {
  const checks: ReplayCrossCheck[] = [];
  const add = (field: ReplayCrossCheck['field'], status: ReplayCrossCheck['status'], details?: string) =>
    checks.push({ field, status, ...(details ? { details } : {}) });
  const parserIdentities = identityMap(input.identities);
  if (!reference?.identities) {
    add('identities', parserIdentities.duplicates.size ? 'mismatch' : 'not-supplied', parserIdentities.duplicates.size ? 'Parser identities are not stable and unique.' : undefined);
  } else {
    const expected = identityMap(reference.identities);
    const mismatch = parserIdentities.duplicates.size > 0 || expected.duplicates.size > 0
      || parserIdentities.map.size !== expected.map.size
      || [...expected.map].some(([id, identity]) => parserIdentities.map.get(id)?.teamId !== identity.teamId);
    add('identities', mismatch ? 'mismatch' : 'match', mismatch ? 'Stable player/team identities differ from the review reference.' : undefined);
  }

  const parserMap = normalizedMap(input.summary?.map);
  const referenceMap = normalizedMap(reference?.summary?.map);
  add('map', parserMap && referenceMap ? parserMap === referenceMap ? 'match' : 'mismatch' : 'not-supplied',
    parserMap && referenceMap && parserMap !== referenceMap ? 'Replay map differs from the review reference.' : undefined);

  const actualRoundIds = input.rounds.map(round => round.roundNumber).sort((a, b) => a - b);
  const uniqueRoundIds = new Set(actualRoundIds);
  const contiguous = actualRoundIds.every((round, index) => round === index + 1);
  const countsAgree = [input.summary?.roundCount, reference?.summary?.roundCount]
    .filter(value => value !== undefined && value !== null)
    .every(value => knownNonNegativeInteger(value) && value === input.rounds.length);
  const roundStructureValid = input.rounds.length > 0 && uniqueRoundIds.size === input.rounds.length && contiguous
    && countsAgree && input.rounds.every(round => round.events.every(event => event.roundNumber === round.roundNumber));
  add('rounds', roundStructureValid ? 'match' : 'mismatch', roundStructureValid ? undefined : 'Round IDs, event ownership, or supplied round totals are incomplete or inconsistent.');

  const validScore = (summary: ReplayMatchSummary | undefined) => !summary?.finalScore
    || (knownNonNegativeInteger(summary.finalScore.teamA) && knownNonNegativeInteger(summary.finalScore.teamB)
      && summary.finalScore.teamA + summary.finalScore.teamB === input.rounds.length);
  const scoresComparable = !!input.summary?.finalScore && !!reference?.summary?.finalScore;
  const scoreValid = validScore(input.summary) && validScore(reference?.summary)
    && (!scoresComparable || sameScore(input.summary?.finalScore, reference?.summary?.finalScore));
  add('final-score', !scoreValid ? 'mismatch' : scoresComparable ? 'match' : 'not-supplied', !scoreValid ? 'Final score conflicts with the supplied rounds or review reference.' : undefined);

  add('capabilities', capabilities.conflicts.length ? 'mismatch' : input.capabilities?.length ? 'match' : 'not-supplied', capabilities.conflicts.join(' ') || undefined);

  const analyses = input.rounds.map(round => analyseRound(round, identities));
  const internalAvailable = roundStructureValid && capabilities.complete('eliminations', 'event-log')
    && analyses.every(analysis => analysis.lifeComplete && !analysis.foreignEvent);
  const internalStats = new Map<string, { kills: number; deaths: number }>([...identities.keys()].map(id => [id, { kills: 0, deaths: 0 }]));
  if (internalAvailable) {
    for (const event of analyses.flatMap(analysis => analysis.eliminations)) {
      internalStats.get(event.killerPlayerId as string)!.kills += 1;
      internalStats.get(event.victimPlayerId as string)!.deaths += 1;
    }
  }
  const parserStats = input.summary?.players || [];
  const referenceStats = reference?.summary?.players || [];
  const suppliedStatsValid = (stats: readonly ReplayPlayerSummary[]) => stats.length > 0
    && new Set(stats.map(stat => stat.playerId)).size === stats.length
    && stats.every(stat => identities.has(stat.playerId) && knownNonNegativeInteger(stat.kills) && knownNonNegativeInteger(stat.deaths));
  const parserStatsValid = suppliedStatsValid(parserStats);
  const referenceStatsValid = suppliedStatsValid(referenceStats);
  const mapStats = (stats: readonly ReplayPlayerSummary[]) => new Map(stats.map(stat => [stat.playerId, stat]));
  const matchesInternal = (stats: readonly ReplayPlayerSummary[]) => stats.every(stat => {
    const actual = internalStats.get(stat.playerId);
    return actual?.kills === stat.kills && actual?.deaths === stat.deaths;
  });
  const summariesMatch = !parserStatsValid || !referenceStatsValid || (() => {
    const expected = mapStats(referenceStats);
    return parserStats.length === referenceStats.length
      && parserStats.every(stat => expected.get(stat.playerId)?.kills === stat.kills && expected.get(stat.playerId)?.deaths === stat.deaths);
  })();
  const kdMismatch = (parserStats.length > 0 && !parserStatsValid) || (referenceStats.length > 0 && !referenceStatsValid)
    || !summariesMatch || (internalAvailable && ((parserStatsValid && !matchesInternal(parserStats)) || (referenceStatsValid && !matchesInternal(referenceStats))));
  const kdVerified = internalAvailable && (parserStatsValid || referenceStatsValid) && !kdMismatch;
  add('kills-deaths', kdMismatch ? 'mismatch' : kdVerified ? 'match' : 'not-supplied', kdMismatch ? 'K/D is invalid or differs from event-derived evidence or the review reference.' : undefined);
  add('event-summary', internalAvailable ? 'match' : 'not-supplied', internalAvailable ? undefined : 'No complete event-derived summary was available.');
  return checks;
}

function deriveRoundEvidence(
  round: ReplayRoundDraft,
  identities: Map<string, ReplayPlayerIdentity>,
  tradeWindowMs: number,
  evidenceAllowed: boolean,
  capabilities: CapabilityResolution,
) {
  const analysis = analyseRound(round, identities);
  const participant = participantState(round, identities);
  const eliminationGrade = evidenceAllowed && capabilities.complete('eliminations', 'event-log', round.roundNumber)
    && analysis.orderResolved && !analysis.foreignEvent && analysis.identityComplete && analysis.lifeComplete;
  const eliminations = eliminationGrade ? analysis.eliminations : [];
  const multikills = eliminationGrade
    ? [...eliminations.reduce((counts, item) => {
      const playerId = item.killerPlayerId as string;
      counts.set(playerId, (counts.get(playerId) || 0) + 1);
      return counts;
    }, new Map<string, number>())].filter(([, kills]) => kills >= 2).map(([playerId, kills]) => ({ playerId, kills }))
    : null;

  let tradeOpportunities: number | null = null;
  let successfulTrades: number | null = null;
  let tradedDeathPlayerIds: string[] | null = null;
  let clutches: Array<{ playerId: string; opponents: number; result: 'won' | 'lost' | 'unknown' }> | null = null;
  const participants = participant.players;
  const hasTimes = eliminations.every(item => knownNonNegativeInteger(item.timestampMs));
  if (eliminationGrade && analysis.lifeComplete && hasTimes) {
    const alive = new Set(participants);
    tradeOpportunities = 0;
    successfulTrades = 0;
    tradedDeathPlayerIds = [];
    const clutchCandidates: Array<{ playerId: string; opponents: number }> = [];
    const captureClutches = () => {
      for (const playerId of alive) {
        const teamId = identities.get(playerId)?.teamId;
        const teamAlive = [...alive].filter(id => identities.get(id)?.teamId === teamId);
        const opponents = [...alive].filter(id => identities.get(id)?.teamId !== teamId).length;
        if (teamAlive.length === 1 && opponents >= 1 && !clutchCandidates.some(candidate => candidate.playerId === playerId)) {
          clutchCandidates.push({ playerId, opponents });
        }
      }
    };
    captureClutches();
    for (let index = 0; index < eliminations.length; index += 1) {
      const item = eliminations[index];
      const victimId = item.victimPlayerId as string;
      const killerId = item.killerPlayerId as string;
      const victimTeam = identities.get(victimId)?.teamId;
      alive.delete(victimId);
      const livingTeammates = [...alive].filter(playerId => identities.get(playerId)?.teamId === victimTeam);
      if (livingTeammates.length > 0) {
        tradeOpportunities += 1;
        const traded = eliminations.slice(index + 1).find(later => {
          const elapsed = (later.timestampMs as number) - (item.timestampMs as number);
          return elapsed >= 0 && elapsed <= tradeWindowMs
          && later.victimPlayerId === killerId
          && identities.get(later.killerPlayerId as string)?.teamId === victimTeam;
        });
        if (traded) {
          successfulTrades += 1;
          tradedDeathPlayerIds.push(victimId);
        }
      }
      captureClutches();
    }
    const winnerKnown = capabilities.complete('round-winner', 'event-log', round.roundNumber)
      && participant.complete && !!round.winnerTeamId && participant.teams.has(round.winnerTeamId);
    clutches = clutchCandidates.map(candidate => ({
      ...candidate,
      result: !winnerKnown ? 'unknown' : identities.get(candidate.playerId)?.teamId === round.winnerTeamId ? 'won' : 'lost',
    }));
  }
  const winnerValid = evidenceAllowed && capabilities.complete('round-winner', 'event-log', round.roundNumber)
    && participant.complete && !!round.winnerTeamId && participant.teams.has(round.winnerTeamId);
  const sideEntries = Object.entries(round.sideByTeam || {});
  const sideValid = evidenceAllowed && capabilities.complete('side', 'event-log', round.roundNumber)
    && participant.complete && sideEntries.length === participant.teams.size
    && sideEntries.every(([teamId, side]) => participant.teams.has(teamId) && (side === 'attack' || side === 'defense' || side === 'unknown'));
  return {
    roundNumber: round.roundNumber,
    events: structuredClone(analysis.ordered),
    winnerTeamId: winnerValid ? round.winnerTeamId as string : null,
    endReason: evidenceAllowed && capabilities.complete('round-end-reason', 'event-log', round.roundNumber) ? round.endReason || null : null,
    sideByTeam: sideValid ? structuredClone(round.sideByTeam as Readonly<Record<string, 'attack' | 'defense' | 'unknown'>>) : null,
    derived: { tradeOpportunities, successfulTrades, tradedDeathPlayerIds, multikills, clutches },
  };
}

function validateObservations(
  input: ReplayParserDraftInput,
  identities: Map<string, ReplayPlayerIdentity>,
) {
  const playerCountedSignals = new Set<ReplayEvidenceSignal>([
    'assists', 'damage', 'utility-cast', 'utility-effect', 'ultimate-use', 'plant', 'defuse', 'orb-capture',
  ]);
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
    return JSON.stringify(value);
  };
  const groups = new Map<string, ReplayEvidenceObservation[]>();
  for (const item of input.observations || []) groups.set(item.observationId, [...(groups.get(item.observationId) || []), item]);
  const roundMap = new Map(input.rounds.map(round => [round.roundNumber, round]));
  const teams = new Set([...identities.values()].map(identity => identity.teamId));
  const issues: string[] = [];
  const affected = new Set<string>();
  const observations: ReplayEvidenceObservation[] = [];
  const contaminate = (raw: ReplayEvidenceObservation) =>
    affected.add(`${raw.signal}:${raw.grade}:${raw.playerId && identities.has(raw.playerId) ? raw.playerId : '*'}:${raw.roundNumber}`);
  for (const [observationId, records] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (!observationId) {
      records.forEach(contaminate);
      issues.push('<empty>: empty-id');
      continue;
    }
    if (new Set(records.map(stable)).size > 1) {
      records.forEach(contaminate);
      issues.push(`${observationId}: conflicting-duplicate-id`);
      continue;
    }
    const raw = records[0];
    const reasons: string[] = [];
    const round = roundMap.get(raw.roundNumber);
    if (!round) reasons.push('unknown-round');
    const participants = new Set(round?.participantPlayerIds || []);
    if (playerCountedSignals.has(raw.signal) && !raw.playerId) reasons.push('missing-player');
    if (raw.playerId && (!identities.has(raw.playerId) || !participants.has(raw.playerId))) reasons.push('invalid-player');
    if (raw.targetPlayerId && (!identities.has(raw.targetPlayerId) || !participants.has(raw.targetPlayerId))) reasons.push('invalid-target');
    if (raw.teamId && !teams.has(raw.teamId)) reasons.push('invalid-team');
    if (raw.playerId && raw.teamId && identities.get(raw.playerId)?.teamId !== raw.teamId) reasons.push('player-team-mismatch');
    if (reasons.length) { contaminate(raw); issues.push(`${raw.observationId}: ${reasons.join(',')}`); continue; }
    observations.push({
      ...structuredClone(raw),
      explicitlyPresent: raw.explicitlyPresent === true,
      confidence: typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) && raw.confidence >= 0 && raw.confidence <= 1
        ? raw.confidence : null,
    });
  }
  return { observations, issues: [...new Set(issues)].sort(), affected };
}

function buildEvidence(
  input: ReplayParserDraftInput,
  identities: Map<string, ReplayPlayerIdentity>,
  evidenceAllowed: boolean,
  capabilities: CapabilityResolution,
) {
  const requestedWindow = input.derivation?.tradeWindowMs;
  const tradeWindowMs = knownNonNegativeInteger(requestedWindow) && requestedWindow >= 100 && requestedWindow <= 30_000
    ? requestedWindow
    : 5_000;
  const validated = validateObservations(input, identities);
  const observations = validated.observations;
  const playedRounds = new Set(input.rounds.map(round => round.roundNumber));
  const participantStates = new Map(input.rounds.map(round => [round.roundNumber, participantState(round, identities)]));
  const allParticipantsComplete = [...participantStates.values()].every(state => state.complete);
  const coverageBySignal = capabilities.capabilities.map(capability => ({
    signal: capability.signal,
    support: capability.support,
    grade: capability.grade,
    coveredRounds: capabilities.covered(capability).length,
    playedRounds: input.rounds.length,
  }));
  const explicitEventFacts = (signal: ReplayEvidenceSignal, playerId: string) => observations.filter(observation =>
    observation.signal === signal && observation.playerId === playerId && observation.explicitlyPresent
    && observation.grade === 'event-log' && playedRounds.has(observation.roundNumber));
  const playerRounds = (playerId: string) => input.rounds.filter(round => participantStates.get(round.roundNumber)?.set.has(playerId));
  const playerSignalComplete = (signal: ReplayEvidenceSignal, playerId: string) => {
    const rounds = playerRounds(playerId);
    const contaminated = [...validated.affected].some(key => key.startsWith(`${signal}:event-log:${playerId}:`)
      || key.startsWith(`${signal}:event-log:*:`));
    return evidenceAllowed && allParticipantsComplete && rounds.length > 0
      && rounds.every(round => capabilities.complete(signal, 'event-log', round.roundNumber))
      && !contaminated;
  };
  const countMetric = (signal: ReplayEvidenceSignal, playerId: string): number | null =>
    playerSignalComplete(signal, playerId) ? explicitEventFacts(signal, playerId).length : null;
  const damageMetric = (playerId: string): number | null => {
    if (!playerSignalComplete('damage', playerId)) return null;
    const facts = explicitEventFacts('damage', playerId);
    if (facts.some(fact => !knownNonNegativeInteger(fact.attributes?.amount))) return null;
    return facts.reduce((total, fact) => total + (fact.attributes?.amount as number), 0);
  };
  const analyses = input.rounds.map(round => analyseRound(round, identities));
  const completeEliminations = evidenceAllowed && capabilities.complete('eliminations', 'event-log')
    && analyses.every(analysis => analysis.lifeComplete && !analysis.foreignEvent);
  const allEliminations = completeEliminations
    ? analyses.flatMap(analysis => analysis.eliminations)
    : [];
  const killDetailsComplete = completeEliminations && capabilities.complete('kill-details', 'event-log')
    && allEliminations.every(item => item.killSource && item.killSource !== 'unknown'
      && (item.killSource !== 'weapon' || typeof item.headshot === 'boolean'));
  const coveredPlayers = new Set([...participantStates.values()].filter(state => state.complete).flatMap(state => state.players));
  const playerMetrics = [...identities.keys()].map(playerId => {
    const eligibleKills = killDetailsComplete
      ? allEliminations.filter(item => item.killerPlayerId === playerId && item.killSource === 'weapon') : null;
    const headshotKills = eligibleKills?.filter(item => item.headshot === true).length ?? null;
    return ({
    playerId,
    kills: completeEliminations && coveredPlayers.has(playerId) ? allEliminations.filter(item => item.killerPlayerId === playerId).length : null,
    deaths: completeEliminations && coveredPlayers.has(playerId) ? allEliminations.filter(item => item.victimPlayerId === playerId).length : null,
    assists: countMetric('assists', playerId),
    damage: damageMetric(playerId),
    utilityCasts: countMetric('utility-cast', playerId),
    utilityEffects: countMetric('utility-effect', playerId),
    ultimateUses: countMetric('ultimate-use', playerId),
    plants: countMetric('plant', playerId),
    defuses: countMetric('defuse', playerId),
    orbCaptures: countMetric('orb-capture', playerId),
    headshotKills,
    eligibleHeadshotKills: eligibleKills?.length ?? null,
    headshotPercentage: eligibleKills === null || eligibleKills.length === 0 ? null
      : Math.round((headshotKills as number) * 10_000 / eligibleKills.length) / 100,
  }); });
  return {
    tradeWindowMs,
    capabilities: capabilities.capabilities,
    observations,
    observationIssues: validated.issues,
    coverageBySignal,
    playerMetrics,
    rounds: input.rounds.map(round => deriveRoundEvidence(round, identities, tradeWindowMs, evidenceAllowed, capabilities)),
  };
}

/**
 * Converts normalized parser output into evidence only. The result is never a write command and
 * remains review-required even when every cross-check and round resolves.
 */
export function buildReplayOpeningReviewDraft(
  input: ReplayParserDraftInput,
  reference?: ReplayReviewReference,
): ReplayOpeningReviewDraft {
  const normalizedInput: ReplayParserDraftInput = { ...input, rounds: [...input.rounds].sort((a, b) => a.roundNumber - b.roundNumber) };
  const identities = identityMap(normalizedInput.identities).map;
  const capabilities = resolveCapabilities(normalizedInput);
  const crossChecks = buildCrossChecks(normalizedInput, reference, identities, capabilities);
  const invalidRounds = crossChecks.some(check => check.field === 'rounds' && check.status === 'mismatch');
  const gateReason: ReplayUnknownReason | null = input.file.support === 'unsupported'
    ? 'unsupported-file'
    : input.file.support === 'incomplete'
      ? 'incomplete-file'
      : invalidRounds
        ? 'invalid-round-structure'
        : crossChecks.some(check => check.status === 'mismatch')
          ? 'cross-check-mismatch'
          : null;
  const rounds = normalizedInput.rounds
    .map(round => gateReason ? unknownRound(round.roundNumber, gateReason, 0) : evaluateRound(round, identities, capabilities));
  const resolved = rounds.filter(round => round.status === 'resolved');
  const completeCoverage = rounds.length > 0 && resolved.length === rounds.length;
  const participantStates = normalizedInput.rounds.map(round => participantState(round, identities));
  const participantCoverageComplete = participantStates.length > 0 && participantStates.every(state => state.complete);
  const coveredPlayers = new Set(participantStates.filter(state => state.complete).flatMap(state => state.players));
  const reasonCounts: Partial<Record<ReplayUnknownReason, number>> = {};
  for (const round of rounds) {
    if (round.reason) reasonCounts[round.reason] = (reasonCounts[round.reason] || 0) + 1;
  }
  const playerTotals = normalizedInput.identities.map(identity => {
    const playerCovered = participantCoverageComplete && coveredPlayers.has(identity.playerId);
    const observedFirstKills = playerCovered ? resolved.filter(round => round.firstKillPlayerId === identity.playerId).length : null;
    const observedFirstDeaths = playerCovered ? resolved.filter(round => round.firstDeathPlayerId === identity.playerId).length : null;
    return {
      playerId: identity.playerId,
      observedFirstKills,
      observedFirstDeaths,
      firstKills: completeCoverage && playerCovered ? observedFirstKills : null,
      firstDeaths: completeCoverage && playerCovered ? observedFirstDeaths : null,
    };
  });
  return {
    contractVersion: 1,
    status: 'review-required',
    reviewRequired: true,
    writable: false,
    parser: structuredClone(normalizedInput.parser),
    provenance: structuredClone(normalizedInput.provenance),
    file: structuredClone(normalizedInput.file),
    crossChecks,
    rounds,
    coverage: {
      playedRounds: rounds.length,
      resolvedRounds: resolved.length,
      unknownRounds: rounds.length - resolved.length,
      resolvedPercent: rounds.length ? resolved.length / rounds.length * 100 : null,
      unknownReasons: reasonCounts,
    },
    playerTotals,
    evidence: buildEvidence(normalizedInput, identities, gateReason === null, capabilities),
  };
}

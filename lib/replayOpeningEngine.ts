export type ReplayUnknownReason =
  | 'unsupported-file'
  | 'incomplete-file'
  | 'cross-check-mismatch'
  | 'missing-early-sequence'
  | 'identity-ambiguity'
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
}

export interface ReplayRoundDraft {
  roundNumber: number;
  /** True only when the parser guarantees that the event stream begins before any elimination. */
  sequenceCompleteFromStart: boolean;
  events: readonly ReplayEliminationEvent[];
  participantPlayerIds?: readonly string[];
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
  | 'objective-timing' | 'position-zone' | 'round-phase';

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
  field: 'identities' | 'map' | 'final-score' | 'rounds' | 'kills-deaths';
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
    observedFirstKills: number;
    observedFirstDeaths: number;
    firstKills: number | null;
    firstDeaths: number | null;
  }>;
  evidence: {
    tradeWindowMs: number;
    capabilities: ReplaySourceCapability[];
    observations: ReplayEvidenceObservation[];
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
      ultimateUses: number | null;
      plants: number | null;
      defuses: number | null;
    }>;
    rounds: Array<{
      roundNumber: number;
      events: ReplayEliminationEvent[];
      winnerTeamId: string | null;
      endReason: string | null;
      sideByTeam: Readonly<Record<string, 'attack' | 'defense' | 'unknown'>> | null;
      derived: {
        tradeAttempts: number | null;
        successfulTrades: number | null;
        tradedDeathPlayerIds: string[] | null;
        multikills: Array<{ playerId: string; kills: number }> | null;
        clutch: { playerId: string; opponents: number; result: 'won' | 'lost' } | null;
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

function buildCrossChecks(input: ReplayParserDraftInput, reference?: ReplayReviewReference): ReplayCrossCheck[] {
  const checks: ReplayCrossCheck[] = [];
  const parserIdentities = identityMap(input.identities);
  if (!reference?.identities) {
    checks.push({ field: 'identities', status: parserIdentities.duplicates.size ? 'mismatch' : 'not-supplied', details: parserIdentities.duplicates.size ? 'Parser identities are missing stable unique player/team IDs.' : undefined });
  } else {
    const expected = identityMap(reference.identities);
    const mismatch = parserIdentities.duplicates.size > 0 || expected.duplicates.size > 0
      || parserIdentities.map.size !== expected.map.size
      || [...expected.map].some(([id, identity]) => parserIdentities.map.get(id)?.teamId !== identity.teamId);
    checks.push({ field: 'identities', status: mismatch ? 'mismatch' : 'match', details: mismatch ? 'Stable player/team identities differ from the review reference.' : undefined });
  }

  const parserSummary = input.summary;
  const expectedSummary = reference?.summary;
  const scalarCheck = (
    field: ReplayCrossCheck['field'],
    supplied: boolean,
    matches: boolean,
    details: string,
  ) => checks.push({ field, status: !supplied ? 'not-supplied' : matches ? 'match' : 'mismatch', ...(!supplied || matches ? {} : { details }) });

  const parserMap = normalizedMap(parserSummary?.map);
  const expectedMap = normalizedMap(expectedSummary?.map);
  scalarCheck('map', parserMap !== null && expectedMap !== null, parserMap === expectedMap, 'Replay map differs from the review reference.');
  scalarCheck('final-score', !!parserSummary?.finalScore && !!expectedSummary?.finalScore, sameScore(parserSummary?.finalScore, expectedSummary?.finalScore), 'Replay final score differs from the review reference.');
  scalarCheck(
    'rounds',
    knownNonNegativeInteger(parserSummary?.roundCount) && knownNonNegativeInteger(expectedSummary?.roundCount),
    parserSummary?.roundCount === expectedSummary?.roundCount,
    'Replay round count differs from the review reference.',
  );

  const parserStats = new Map((parserSummary?.players || []).map(player => [player.playerId, player]));
  const expectedStats = expectedSummary?.players || [];
  const statsSupplied = expectedStats.length > 0 && expectedStats.every(player => knownNonNegativeInteger(player.kills) && knownNonNegativeInteger(player.deaths));
  const statsMatch = statsSupplied && expectedStats.every(expected => {
    const parsed = parserStats.get(expected.playerId);
    return parsed?.kills === expected.kills && parsed?.deaths === expected.deaths;
  });
  scalarCheck('kills-deaths', statsSupplied && parserStats.size > 0, statsMatch, 'Replay player K/D differs from the review reference.');
  return checks;
}

function duplicateKey(event: ReplayEliminationEvent): string {
  if (event.eventId) return `id:${event.eventId}`;
  return ['event', event.sequence ?? '', event.timestampMs ?? '', event.kind, event.killerPlayerId ?? '', event.victimPlayerId ?? ''].join(':');
}

function unknownRound(roundNumber: number, reason: ReplayUnknownReason, excludedEventCount: number): OpeningRoundEvidence {
  return { roundNumber, status: 'unknown', firstKillPlayerId: null, firstDeathPlayerId: null, sourceEventId: null, reason, excludedEventCount };
}

function evaluateRound(round: ReplayRoundDraft, identities: Map<string, ReplayPlayerIdentity>): OpeningRoundEvidence {
  if (!round.sequenceCompleteFromStart) return unknownRound(round.roundNumber, 'missing-early-sequence', 0);
  const seen = new Set<string>();
  const deadPlayers = new Set<string>();
  let excluded = 0;
  let ambiguousIdentity = false;
  const candidates: ReplayEliminationEvent[] = [];

  const events = round.events.filter(event => event.roundNumber === round.roundNumber).slice().sort((left, right) => {
    if (knownNonNegativeInteger(left.sequence) && knownNonNegativeInteger(right.sequence) && left.sequence !== right.sequence) return left.sequence - right.sequence;
    if (knownNonNegativeInteger(left.timestampMs) && knownNonNegativeInteger(right.timestampMs) && left.timestampMs !== right.timestampMs) return left.timestampMs - right.timestampMs;
    return 0;
  });

  for (const event of events) {
    const key = duplicateKey(event);
    if (event.duplicateOfEventId || seen.has(key) || event.resurrectionArtifact) { excluded += 1; continue; }
    seen.add(key);
    if (event.kind !== 'player-elimination') { excluded += 1; continue; }
    const killer = event.killerPlayerId ? identities.get(event.killerPlayerId) : undefined;
    const victim = event.victimPlayerId ? identities.get(event.victimPlayerId) : undefined;
    const identityResolved = event.identityStatus === 'resolved' && killer && victim
      && killer.teamId === event.killerTeamId && victim.teamId === event.victimTeamId;
    if (!identityResolved) { ambiguousIdentity = true; excluded += 1; continue; }
    if (deadPlayers.has(victim.playerId)) { excluded += 1; continue; }
    deadPlayers.add(victim.playerId);
    if (killer.playerId === victim.playerId || killer.teamId === victim.teamId) { excluded += 1; continue; }
    candidates.push(event);
  }

  if (ambiguousIdentity) return unknownRound(round.roundNumber, 'identity-ambiguity', excluded);
  if (candidates.length === 0) return unknownRound(round.roundNumber, 'no-qualifying-elimination', excluded);
  const first = candidates[0];
  const tied = candidates.slice(1).some(candidate => {
    if (knownNonNegativeInteger(first.sequence) && knownNonNegativeInteger(candidate.sequence)) return candidate.sequence === first.sequence;
    return knownNonNegativeInteger(first.timestampMs) && knownNonNegativeInteger(candidate.timestampMs)
      ? candidate.timestampMs === first.timestampMs
      : true;
  });
  if (tied) return unknownRound(round.roundNumber, 'unresolved-order', excluded);
  return {
    roundNumber: round.roundNumber,
    status: 'resolved',
    firstKillPlayerId: first.killerPlayerId || null,
    firstDeathPlayerId: first.victimPlayerId || null,
    sourceEventId: first.eventId || null,
    reason: null,
    excludedEventCount: excluded,
  };
}

function deterministicCapability(input: ReplayParserDraftInput, signal: ReplayEvidenceSignal): boolean {
  return input.capabilities?.some(capability => capability.signal === signal
    && capability.support === 'complete' && capability.grade === 'event-log') === true;
}

function derivableEliminations(round: ReplayRoundDraft, identities: Map<string, ReplayPlayerIdentity>) {
  const seen = new Set<string>();
  const dead = new Set<string>();
  const usable: ReplayEliminationEvent[] = [];
  const ordered = round.events.slice().sort((left, right) => {
    if (knownNonNegativeInteger(left.sequence) && knownNonNegativeInteger(right.sequence)) return left.sequence - right.sequence;
    return (left.timestampMs ?? Number.MAX_SAFE_INTEGER) - (right.timestampMs ?? Number.MAX_SAFE_INTEGER);
  });
  for (const event of ordered) {
    const key = duplicateKey(event);
    if (event.kind !== 'player-elimination' || event.identityStatus !== 'resolved'
      || event.duplicateOfEventId || event.resurrectionArtifact || seen.has(key)) continue;
    seen.add(key);
    const killer = event.killerPlayerId ? identities.get(event.killerPlayerId) : undefined;
    const victim = event.victimPlayerId ? identities.get(event.victimPlayerId) : undefined;
    if (!killer || !victim || killer.teamId !== event.killerTeamId || victim.teamId !== event.victimTeamId
      || killer.playerId === victim.playerId || killer.teamId === victim.teamId || dead.has(victim.playerId)) continue;
    dead.add(victim.playerId);
    usable.push(event);
  }
  return usable;
}

function eliminationStreamComplete(round: ReplayRoundDraft, identities: Map<string, ReplayPlayerIdentity>): boolean {
  return round.sequenceCompleteFromStart && round.events.every(event => {
    if (event.kind !== 'player-elimination' || event.duplicateOfEventId || event.resurrectionArtifact) return true;
    const killer = event.killerPlayerId ? identities.get(event.killerPlayerId) : undefined;
    const victim = event.victimPlayerId ? identities.get(event.victimPlayerId) : undefined;
    return event.identityStatus === 'resolved' && !!killer && !!victim
      && killer.teamId === event.killerTeamId && victim.teamId === event.victimTeamId;
  });
}

function deriveRoundEvidence(
  input: ReplayParserDraftInput,
  round: ReplayRoundDraft,
  identities: Map<string, ReplayPlayerIdentity>,
  tradeWindowMs: number,
  evidenceAllowed: boolean,
) {
  const eliminationGrade = evidenceAllowed && deterministicCapability(input, 'eliminations')
    && eliminationStreamComplete(round, identities);
  const participants = round.participantPlayerIds?.filter(playerId => identities.has(playerId)) || [];
  const completeParticipants = !!round.participantPlayerIds
    && participants.length === round.participantPlayerIds.length
    && new Set(participants).size === participants.length;
  const eliminations = eliminationGrade && round.sequenceCompleteFromStart ? derivableEliminations(round, identities) : [];
  const multikills = eliminationGrade && round.sequenceCompleteFromStart
    ? [...eliminations.reduce((counts, item) => {
      const playerId = item.killerPlayerId as string;
      counts.set(playerId, (counts.get(playerId) || 0) + 1);
      return counts;
    }, new Map<string, number>())].filter(([, kills]) => kills >= 2).map(([playerId, kills]) => ({ playerId, kills }))
    : null;

  let tradeAttempts: number | null = null;
  let successfulTrades: number | null = null;
  let tradedDeathPlayerIds: string[] | null = null;
  let clutch: { playerId: string; opponents: number; result: 'won' | 'lost' } | null = null;
  const hasTimes = eliminations.every(item => knownNonNegativeInteger(item.timestampMs));
  if (eliminationGrade && round.sequenceCompleteFromStart && completeParticipants && hasTimes) {
    const alive = new Set(participants);
    tradeAttempts = 0;
    successfulTrades = 0;
    tradedDeathPlayerIds = [];
    const clutchCandidates: Array<{ playerId: string; opponents: number }> = [];
    for (let index = 0; index < eliminations.length; index += 1) {
      const item = eliminations[index];
      const victimId = item.victimPlayerId as string;
      const killerId = item.killerPlayerId as string;
      const victimTeam = identities.get(victimId)?.teamId;
      alive.delete(victimId);
      const livingTeammates = [...alive].filter(playerId => identities.get(playerId)?.teamId === victimTeam);
      if (livingTeammates.length > 0) {
        tradeAttempts += 1;
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
      const teams = [...new Set([...alive].map(playerId => identities.get(playerId)?.teamId).filter(Boolean))] as string[];
      for (const teamId of teams) {
        const teamAlive = [...alive].filter(playerId => identities.get(playerId)?.teamId === teamId);
        const opponentAlive = [...alive].filter(playerId => identities.get(playerId)?.teamId !== teamId);
        if (teamAlive.length === 1 && opponentAlive.length > 1
          && !clutchCandidates.some(candidate => candidate.playerId === teamAlive[0])) {
          clutchCandidates.push({ playerId: teamAlive[0], opponents: opponentAlive.length });
        }
      }
    }
    const candidate = clutchCandidates[0];
    if (candidate && deterministicCapability(input, 'round-winner') && round.winnerTeamId) {
      clutch = {
        ...candidate,
        result: identities.get(candidate.playerId)?.teamId === round.winnerTeamId ? 'won' : 'lost',
      };
    }
  }
  return {
    roundNumber: round.roundNumber,
    events: structuredClone([...round.events]),
    winnerTeamId: evidenceAllowed && deterministicCapability(input, 'round-winner') ? round.winnerTeamId || null : null,
    endReason: evidenceAllowed && deterministicCapability(input, 'round-end-reason') ? round.endReason || null : null,
    sideByTeam: evidenceAllowed && deterministicCapability(input, 'side') ? structuredClone(round.sideByTeam || null) : null,
    derived: { tradeAttempts, successfulTrades, tradedDeathPlayerIds, multikills, clutch },
  };
}

function buildEvidence(
  input: ReplayParserDraftInput,
  identities: Map<string, ReplayPlayerIdentity>,
  evidenceAllowed: boolean,
) {
  const requestedWindow = input.derivation?.tradeWindowMs;
  const tradeWindowMs = knownNonNegativeInteger(requestedWindow) && requestedWindow >= 100 && requestedWindow <= 30_000
    ? requestedWindow
    : 5_000;
  const capabilities: ReplaySourceCapability[] = structuredClone([...(input.capabilities || [])]);
  const observations: ReplayEvidenceObservation[] = structuredClone([...(input.observations || [])]).map(observation => ({
    ...observation,
    explicitlyPresent: observation.explicitlyPresent === true,
    confidence: typeof observation.confidence === 'number' && Number.isFinite(observation.confidence)
      && observation.confidence >= 0 && observation.confidence <= 1
      ? observation.confidence
      : null,
  }));
  const playedRounds = new Set(input.rounds.map(round => round.roundNumber));
  const coverageBySignal = capabilities.map(capability => {
    const explicitlyObserved = new Set(observations
      .filter(observation => observation.signal === capability.signal && observation.explicitlyPresent && playedRounds.has(observation.roundNumber))
      .map(observation => observation.roundNumber));
    const declared = (capability.coveredRoundNumbers || []).filter(round => playedRounds.has(round));
    const coveredRounds = capability.support === 'complete'
      ? input.rounds.length
      : new Set([...declared, ...explicitlyObserved]).size;
    return {
      signal: capability.signal,
      support: capability.support,
      grade: capability.grade,
      coveredRounds,
      playedRounds: input.rounds.length,
    };
  });
  const explicitEventFacts = (signal: ReplayEvidenceSignal, playerId: string) => observations.filter(observation =>
    observation.signal === signal && observation.playerId === playerId && observation.explicitlyPresent
    && observation.grade === 'event-log' && playedRounds.has(observation.roundNumber));
  const countMetric = (signal: ReplayEvidenceSignal, playerId: string): number | null =>
    evidenceAllowed && deterministicCapability(input, signal) ? explicitEventFacts(signal, playerId).length : null;
  const damageMetric = (playerId: string): number | null => {
    if (!evidenceAllowed || !deterministicCapability(input, 'damage')) return null;
    const facts = explicitEventFacts('damage', playerId);
    if (facts.some(fact => !knownNonNegativeInteger(fact.attributes?.amount))) return null;
    return facts.reduce((total, fact) => total + (fact.attributes?.amount as number), 0);
  };
  const completeEliminations = evidenceAllowed && deterministicCapability(input, 'eliminations')
    && input.rounds.every(round => eliminationStreamComplete(round, identities));
  const allEliminations = completeEliminations
    ? input.rounds.flatMap(round => derivableEliminations(round, identities))
    : [];
  const playerMetrics = [...identities.keys()].map(playerId => ({
    playerId,
    kills: completeEliminations ? allEliminations.filter(item => item.killerPlayerId === playerId).length : null,
    deaths: completeEliminations ? allEliminations.filter(item => item.victimPlayerId === playerId).length : null,
    assists: countMetric('assists', playerId),
    damage: damageMetric(playerId),
    utilityCasts: countMetric('utility-cast', playerId),
    ultimateUses: countMetric('ultimate-use', playerId),
    plants: countMetric('plant', playerId),
    defuses: countMetric('defuse', playerId),
  }));
  return {
    tradeWindowMs,
    capabilities,
    observations,
    coverageBySignal,
    playerMetrics,
    rounds: input.rounds.map(round => deriveRoundEvidence(input, round, identities, tradeWindowMs, evidenceAllowed)),
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
  const crossChecks = buildCrossChecks(input, reference);
  const gateReason: ReplayUnknownReason | null = input.file.support === 'unsupported'
    ? 'unsupported-file'
    : input.file.support === 'incomplete'
      ? 'incomplete-file'
      : crossChecks.some(check => check.status === 'mismatch')
        ? 'cross-check-mismatch'
        : null;
  const identities = identityMap(input.identities).map;
  const rounds = input.rounds
    .slice()
    .sort((left, right) => left.roundNumber - right.roundNumber)
    .map(round => gateReason ? unknownRound(round.roundNumber, gateReason, 0) : evaluateRound(round, identities));
  const resolved = rounds.filter(round => round.status === 'resolved');
  const completeCoverage = rounds.length > 0 && resolved.length === rounds.length;
  const reasonCounts: Partial<Record<ReplayUnknownReason, number>> = {};
  for (const round of rounds) {
    if (round.reason) reasonCounts[round.reason] = (reasonCounts[round.reason] || 0) + 1;
  }
  const playerTotals = input.identities.map(identity => {
    const observedFirstKills = resolved.filter(round => round.firstKillPlayerId === identity.playerId).length;
    const observedFirstDeaths = resolved.filter(round => round.firstDeathPlayerId === identity.playerId).length;
    return {
      playerId: identity.playerId,
      observedFirstKills,
      observedFirstDeaths,
      firstKills: completeCoverage ? observedFirstKills : null,
      firstDeaths: completeCoverage ? observedFirstDeaths : null,
    };
  });
  return {
    contractVersion: 1,
    status: 'review-required',
    reviewRequired: true,
    writable: false,
    parser: structuredClone(input.parser),
    provenance: structuredClone(input.provenance),
    file: structuredClone(input.file),
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
    evidence: buildEvidence(input, identities, gateReason === null),
  };
}

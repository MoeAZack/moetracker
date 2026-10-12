import type {
  AppearanceType,
  EntrySourceMetadata,
  Match,
  PlayerStats,
  RosterContextKind,
  Round,
  TryoutBatch,
} from '../src/types';

export const COACH_ANALYTICS_TIME_ZONE = 'Africa/Cairo';
export const DEFAULT_SMALL_SAMPLE_MATCHES = 3;

export type AnalyticsAppearance = AppearanceType | 'unclassified' | 'all';
export type AnalyticsWarning =
  | 'small-match-sample'
  | 'partial-kd-coverage'
  | 'partial-acs-coverage'
  | 'partial-opening-coverage'
  | 'no-round-opening-coverage';

export interface CairoDateWindow {
  start: string;
  end: string;
}

export interface CoachAnalyticsQuery {
  window: CairoDateWindow;
  appearance?: AnalyticsAppearance;
  includeArchivedTryouts?: boolean;
  playerIds?: readonly string[];
  agents?: readonly string[];
  maps?: readonly string[];
  minimumMatchSample?: number;
}

export interface CoachAnalyticsData {
  matches: readonly Match[];
  playerStats: readonly PlayerStats[];
  rounds: readonly Round[];
  tryoutBatches: readonly TryoutBatch[];
}

export interface MetricValue {
  value: number | null;
  samples: number;
}

export interface CountMetric {
  total: number | null;
  samples: number;
}

export interface RatioMetric extends MetricValue {
  numerator: number | null;
  denominator: number | null;
}

export interface CoverageValue {
  covered: number;
  total: number;
}

export interface AnalyticsMetrics {
  kd: RatioMetric;
  acs: MetricValue;
  firstKills: CountMetric;
  firstDeaths: CountMetric;
  openingDifferential: CountMetric;
  matchCoverage: CoverageValue;
  roundCoverage: CoverageValue;
}

export interface AnalyticsContext {
  rosterKind: RosterContextKind;
  tryoutBatchId: string | null;
}

export interface PlayerAgentMapAggregate {
  key: string;
  playerId: string;
  displayName: string;
  appearance: Exclude<AnalyticsAppearance, 'all'>;
  agent: string | null;
  map: string | null;
  context: AnalyticsContext;
  matchCount: number;
  statRowCount: number;
  metrics: AnalyticsMetrics;
  warnings: AnalyticsWarning[];
}

export interface TeamMapAggregate {
  key: string;
  map: string | null;
  context: AnalyticsContext;
  matchCount: number;
  resultCoverage: CoverageValue;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  averageRoundDifferential: number | null;
  metrics: AnalyticsMetrics;
  comparisonToContext: {
    winRateDelta: number | null;
    roundDifferentialDelta: number | null;
  };
  warnings: AnalyticsWarning[];
}

export interface CoachAnalyticsResult {
  query: Required<Pick<CoachAnalyticsQuery, 'appearance' | 'includeArchivedTryouts' | 'minimumMatchSample'>> & {
    window: CairoDateWindow;
  };
  coverage: {
    matches: number;
    matchesWithSelectedStats: number;
    selectedStatRows: number;
    invalidDateMatches: number;
  };
  playerAgentMaps: PlayerAgentMapAggregate[];
  teamMaps: TeamMapAggregate[];
}

export interface MetricDelta {
  current: number | null;
  baseline: number | null;
  delta: number | null;
  currentSamples: number;
  baselineSamples: number;
}

export interface PeriodComparisonRow {
  key: string;
  currentMatches: number;
  baselineMatches: number;
  kd: MetricDelta;
  acs: MetricDelta;
  openingDifferential: MetricDelta;
  warnings: Array<'missing-current' | 'missing-baseline' | 'small-current-sample' | 'small-baseline-sample'>;
}

export interface CoachAnalyticsComparison {
  current: CoachAnalyticsResult;
  baseline: CoachAnalyticsResult;
  playerAgentMaps: PeriodComparisonRow[];
  teamMaps: Array<PeriodComparisonRow & {
    winRate: MetricDelta;
    averageRoundDifferential: MetricDelta;
  }>;
}

const cairoFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: COACH_ANALYTICS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function strictDateOnly(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : null;
}

/** Convert an ISO date or offset-bearing timestamp to its calendar date in Cairo. */
export function toCairoDateKey(value: string): string | null {
  const dateOnly = strictDateOnly(value);
  if (dateOnly) return dateOnly;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = Object.fromEntries(cairoFormatter.formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isInCairoDateWindow(value: string, window: CairoDateWindow): boolean {
  const start = strictDateOnly(window.start);
  const end = strictDateOnly(window.end);
  if (!start || !end || start > end) throw new RangeError('Analytics windows require valid ordered YYYY-MM-DD dates.');
  const key = toCairoDateKey(value);
  return key !== null && key >= start && key <= end;
}

function finiteNonnegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function supportedTotal(total: unknown, firstSide: unknown, secondSide: unknown): number | null {
  const explicitTotal = finiteNonnegative(total);
  if (explicitTotal !== null) return explicitTotal;
  const first = finiteNonnegative(firstSide);
  const second = finiteNonnegative(secondSide);
  return first !== null && second !== null ? first + second : null;
}

function exactScore(match: Match): { ours: number; theirs: number } | null {
  const ours = finiteNonnegative(match.ourScore);
  const theirs = finiteNonnegative(match.theirScore);
  if (ours !== null && theirs !== null) return { ours, theirs };
  const attW = finiteNonnegative(match.attW);
  const attL = finiteNonnegative(match.attL);
  const defW = finiteNonnegative(match.defW);
  const defL = finiteNonnegative(match.defL);
  return attW !== null && attL !== null && defW !== null && defL !== null
    ? { ours: attW + defW, theirs: attL + defL }
    : null;
}

function explicitEvidence(source: EntrySourceMetadata | undefined): boolean {
  return !!source && source.method !== 'unknown' && !!toCairoDateKey(source.capturedAt);
}

function contextFor(match: Match): AnalyticsContext {
  return {
    rosterKind: match.rosterContext?.kind || 'unclassified',
    tryoutBatchId: match.rosterContext?.tryoutBatchId || null,
  };
}

function contextKey(context: AnalyticsContext): string {
  return `${context.rosterKind}\u0000${context.tryoutBatchId || ''}`;
}

function appearanceFor(stat: PlayerStats): Exclude<AnalyticsAppearance, 'all'> {
  return stat.appearanceType || 'unclassified';
}

function displayFor(stat: PlayerStats): string {
  return stat.displayNameSnapshot?.trim() || stat.player?.trim() || 'Unknown player';
}

function identityFor(stat: PlayerStats): string {
  // Legacy rows lack a stable identity. Keeping each row separate is safer than
  // merging distinct people because their display names happen to match.
  return stat.playerId || `unclassified-row:${stat.id}`;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

interface MetricsAccumulator {
  rows: number;
  matchIds: Set<string>;
  kdKills: number;
  kdDeaths: number;
  kdSamples: number;
  acsTotal: number;
  acsSamples: number;
  firstKills: number;
  firstKillSamples: number;
  firstDeaths: number;
  firstDeathSamples: number;
  openingDifferential: number;
  openingDifferentialSamples: number;
  openingMatchIds: Set<string>;
}

function emptyMetrics(): MetricsAccumulator {
  return {
    rows: 0,
    matchIds: new Set(),
    kdKills: 0,
    kdDeaths: 0,
    kdSamples: 0,
    acsTotal: 0,
    acsSamples: 0,
    firstKills: 0,
    firstKillSamples: 0,
    firstDeaths: 0,
    firstDeathSamples: 0,
    openingDifferential: 0,
    openingDifferentialSamples: 0,
    openingMatchIds: new Set(),
  };
}

function addStat(accumulator: MetricsAccumulator, stat: PlayerStats, match: Match) {
  accumulator.rows += 1;
  accumulator.matchIds.add(match.id);
  const kills = supportedTotal(stat.kills, stat.kAtt, stat.kDef);
  const deaths = supportedTotal(stat.deaths, stat.dAtt, stat.dDef);
  if (kills !== null && deaths !== null) {
    accumulator.kdKills += kills;
    accumulator.kdDeaths += deaths;
    accumulator.kdSamples += 1;
  }
  const acs = finiteNonnegative(stat.acs);
  if (acs !== null) {
    accumulator.acsTotal += acs;
    accumulator.acsSamples += 1;
  }
  const hasEvidence = explicitEvidence(stat.sourceMetadata || match.sourceMetadata);
  const firstKills = hasEvidence ? finiteNonnegative(stat.fk) : null;
  const firstDeaths = hasEvidence ? finiteNonnegative(stat.fd) : null;
  if (firstKills !== null) {
    accumulator.firstKills += firstKills;
    accumulator.firstKillSamples += 1;
  }
  if (firstDeaths !== null) {
    accumulator.firstDeaths += firstDeaths;
    accumulator.firstDeathSamples += 1;
  }
  if (firstKills !== null && firstDeaths !== null) {
    accumulator.openingDifferential += firstKills - firstDeaths;
    accumulator.openingDifferentialSamples += 1;
    accumulator.openingMatchIds.add(match.id);
  }
}

function finishMetrics(accumulator: MetricsAccumulator, rounds: readonly Round[], matchesById: Map<string, Match>): AnalyticsMetrics {
  const relevantRounds = rounds.filter(round => accumulator.matchIds.has(round.matchId));
  const coveredRounds = relevantRounds.filter(round => {
    const match = matchesById.get(round.matchId);
    return !!match && explicitEvidence(match.sourceMetadata)
      && !!round.firstKillBy?.trim() && !!round.firstDeathBy?.trim();
  });
  return {
    kd: {
      value: accumulator.kdSamples > 0 && accumulator.kdDeaths > 0
        ? accumulator.kdKills / accumulator.kdDeaths
        : null,
      numerator: accumulator.kdSamples > 0 ? accumulator.kdKills : null,
      denominator: accumulator.kdSamples > 0 ? accumulator.kdDeaths : null,
      samples: accumulator.kdSamples,
    },
    acs: {
      value: accumulator.acsSamples > 0 ? accumulator.acsTotal / accumulator.acsSamples : null,
      samples: accumulator.acsSamples,
    },
    firstKills: {
      total: accumulator.firstKillSamples > 0 ? accumulator.firstKills : null,
      samples: accumulator.firstKillSamples,
    },
    firstDeaths: {
      total: accumulator.firstDeathSamples > 0 ? accumulator.firstDeaths : null,
      samples: accumulator.firstDeathSamples,
    },
    openingDifferential: {
      total: accumulator.openingDifferentialSamples > 0 ? accumulator.openingDifferential : null,
      samples: accumulator.openingDifferentialSamples,
    },
    matchCoverage: { covered: accumulator.openingMatchIds.size, total: accumulator.matchIds.size },
    roundCoverage: { covered: coveredRounds.length, total: relevantRounds.length },
  };
}

function warningsFor(metrics: AnalyticsMetrics, rows: number, matches: number, minimumMatches: number): AnalyticsWarning[] {
  const warnings: AnalyticsWarning[] = [];
  if (matches < minimumMatches) warnings.push('small-match-sample');
  if (metrics.kd.samples < rows) warnings.push('partial-kd-coverage');
  if (metrics.acs.samples < rows) warnings.push('partial-acs-coverage');
  if (metrics.firstKills.samples < rows || metrics.firstDeaths.samples < rows) warnings.push('partial-opening-coverage');
  if (metrics.roundCoverage.total > 0 && metrics.roundCoverage.covered === 0) warnings.push('no-round-opening-coverage');
  return warnings.sort();
}

interface PlayerAccumulator {
  playerId: string;
  appearance: Exclude<AnalyticsAppearance, 'all'>;
  agent: string | null;
  map: string | null;
  context: AnalyticsContext;
  labels: Array<{ date: string; statId: string; value: string }>;
  metrics: MetricsAccumulator;
}

interface TeamAccumulator {
  map: string | null;
  context: AnalyticsContext;
  matches: Match[];
  metrics: MetricsAccumulator;
}

function normalizeQuery(query: CoachAnalyticsQuery) {
  isInCairoDateWindow(query.window.start, query.window);
  const minimumMatchSample = query.minimumMatchSample ?? DEFAULT_SMALL_SAMPLE_MATCHES;
  if (!Number.isInteger(minimumMatchSample) || minimumMatchSample < 1) {
    throw new RangeError('minimumMatchSample must be a positive integer.');
  }
  return {
    ...query,
    appearance: query.appearance || 'all' as AnalyticsAppearance,
    includeArchivedTryouts: query.includeArchivedTryouts || false,
    minimumMatchSample,
  };
}

export function buildCoachAnalytics(data: CoachAnalyticsData, rawQuery: CoachAnalyticsQuery): CoachAnalyticsResult {
  const query = normalizeQuery(rawQuery);
  const archivedBatchIds = new Set(data.tryoutBatches.filter(batch => batch.status === 'archived').map(batch => batch.id));
  let invalidDateMatches = 0;
  const matches = data.matches.filter(match => {
    const date = toCairoDateKey(match.date);
    if (!date) {
      invalidDateMatches += 1;
      return false;
    }
    if (!isInCairoDateWindow(match.date, query.window)) return false;
    return query.includeArchivedTryouts
      || match.rosterContext?.kind !== 'tryout'
      || !match.rosterContext.tryoutBatchId
      || !archivedBatchIds.has(match.rosterContext.tryoutBatchId);
  });
  const matchesById = new Map(matches.map(match => [match.id, match]));
  const requestedPlayers = query.playerIds ? new Set(query.playerIds) : null;
  const requestedAgents = query.agents ? new Set(query.agents) : null;
  const requestedMaps = query.maps ? new Set(query.maps) : null;
  const stats = data.playerStats.filter(stat => {
    const match = matchesById.get(stat.matchId);
    if (!match) return false;
    const appearance = appearanceFor(stat);
    if (query.appearance !== 'all' && appearance !== query.appearance) return false;
    if (!query.includeArchivedTryouts
      && match.rosterContext?.kind === 'mixed'
      && match.rosterContext.tryoutBatchId
      && archivedBatchIds.has(match.rosterContext.tryoutBatchId)
      && appearance === 'tryout') return false;
    if (requestedPlayers && (!stat.playerId || !requestedPlayers.has(stat.playerId))) return false;
    if (requestedAgents && !requestedAgents.has(stat.agent)) return false;
    if (requestedMaps && !requestedMaps.has(match.map)) return false;
    return true;
  });
  const statMatchIds = new Set(stats.map(stat => stat.matchId));
  const selectedMatches = matches.filter(match => {
    if (requestedMaps && !requestedMaps.has(match.map)) return false;
    const hasStatDimensionFilter = query.appearance !== 'all' || !!requestedPlayers || !!requestedAgents;
    return !hasStatDimensionFilter || statMatchIds.has(match.id);
  });
  const selectedMatchesById = new Map(selectedMatches.map(match => [match.id, match]));

  const playerAccumulators = new Map<string, PlayerAccumulator>();
  for (const stat of stats) {
    const match = selectedMatchesById.get(stat.matchId);
    if (!match) continue;
    const context = contextFor(match);
    const playerId = identityFor(stat);
    const appearance = appearanceFor(stat);
    const agent = stat.agent?.trim() || null;
    const map = match.map?.trim() || null;
    const key = JSON.stringify([
      playerId, appearance, agent, map, context.rosterKind, context.tryoutBatchId,
    ]);
    let accumulator = playerAccumulators.get(key);
    if (!accumulator) {
      accumulator = { playerId, appearance, agent, map, context, labels: [], metrics: emptyMetrics() };
      playerAccumulators.set(key, accumulator);
    }
    accumulator.labels.push({ date: toCairoDateKey(match.date) || '', statId: stat.id, value: displayFor(stat) });
    addStat(accumulator.metrics, stat, match);
  }

  const playerAgentMaps = [...playerAccumulators.entries()].map(([key, accumulator]) => {
    const metrics = finishMetrics(accumulator.metrics, data.rounds, selectedMatchesById);
    const displayName = [...accumulator.labels]
      .sort((left, right) => right.date.localeCompare(left.date) || right.statId.localeCompare(left.statId))[0].value;
    return {
      key,
      playerId: accumulator.playerId,
      displayName,
      appearance: accumulator.appearance,
      agent: accumulator.agent,
      map: accumulator.map,
      context: accumulator.context,
      matchCount: accumulator.metrics.matchIds.size,
      statRowCount: accumulator.metrics.rows,
      metrics,
      warnings: warningsFor(metrics, accumulator.metrics.rows, accumulator.metrics.matchIds.size, query.minimumMatchSample),
    } satisfies PlayerAgentMapAggregate;
  }).sort((left, right) => left.key.localeCompare(right.key, 'en'));

  const statsByMatch = new Map<string, PlayerStats[]>();
  for (const stat of stats) statsByMatch.set(stat.matchId, [...(statsByMatch.get(stat.matchId) || []), stat]);
  const teamAccumulators = new Map<string, TeamAccumulator>();
  for (const match of selectedMatches) {
    const context = contextFor(match);
    const map = match.map?.trim() || null;
    const key = JSON.stringify([map, context.rosterKind, context.tryoutBatchId]);
    let accumulator = teamAccumulators.get(key);
    if (!accumulator) {
      accumulator = { map, context, matches: [], metrics: emptyMetrics() };
      teamAccumulators.set(key, accumulator);
    }
    accumulator.matches.push(match);
    accumulator.metrics.matchIds.add(match.id);
    for (const stat of statsByMatch.get(match.id) || []) addStat(accumulator.metrics, stat, match);
  }

  const contextBaselines = new Map<string, { scores: Array<{ ours: number; theirs: number }> }>();
  for (const match of selectedMatches) {
    const key = contextKey(contextFor(match));
    const baseline = contextBaselines.get(key) || { scores: [] };
    const score = exactScore(match);
    if (score) baseline.scores.push(score);
    contextBaselines.set(key, baseline);
  }
  const teamMaps = [...teamAccumulators.entries()].map(([key, accumulator]) => {
    const scores = accumulator.matches.map(exactScore).filter((score): score is { ours: number; theirs: number } => !!score);
    const wins = scores.filter(score => score.ours > score.theirs).length;
    const losses = scores.filter(score => score.ours < score.theirs).length;
    const draws = scores.length - wins - losses;
    const winRate = scores.length > 0 ? wins / scores.length : null;
    const averageRoundDifferential = scores.length > 0
      ? scores.reduce((total, score) => total + score.ours - score.theirs, 0) / scores.length
      : null;
    const baselineScores = contextBaselines.get(contextKey(accumulator.context))?.scores || [];
    const baselineWins = baselineScores.filter(score => score.ours > score.theirs).length;
    const baselineWinRate = baselineScores.length > 0 ? baselineWins / baselineScores.length : null;
    const baselineRoundDifferential = baselineScores.length > 0
      ? baselineScores.reduce((total, score) => total + score.ours - score.theirs, 0) / baselineScores.length
      : null;
    const metrics = finishMetrics(accumulator.metrics, data.rounds, selectedMatchesById);
    return {
      key,
      map: accumulator.map,
      context: accumulator.context,
      matchCount: accumulator.matches.length,
      resultCoverage: { covered: scores.length, total: accumulator.matches.length },
      wins,
      losses,
      draws,
      winRate,
      averageRoundDifferential,
      metrics,
      comparisonToContext: {
        winRateDelta: winRate !== null && baselineWinRate !== null ? winRate - baselineWinRate : null,
        roundDifferentialDelta: averageRoundDifferential !== null && baselineRoundDifferential !== null
          ? averageRoundDifferential - baselineRoundDifferential
          : null,
      },
      warnings: warningsFor(metrics, accumulator.metrics.rows, accumulator.matches.length, query.minimumMatchSample),
    } satisfies TeamMapAggregate;
  }).sort((left, right) => left.key.localeCompare(right.key, 'en'));

  return {
    query: {
      window: query.window,
      appearance: query.appearance,
      includeArchivedTryouts: query.includeArchivedTryouts,
      minimumMatchSample: query.minimumMatchSample,
    },
    coverage: {
      matches: selectedMatches.length,
      matchesWithSelectedStats: statMatchIds.size,
      selectedStatRows: stats.length,
      invalidDateMatches,
    },
    playerAgentMaps,
    teamMaps,
  };
}

function delta(
  current: number | null,
  baseline: number | null,
  currentSamples: number,
  baselineSamples: number,
): MetricDelta {
  return {
    current,
    baseline,
    delta: current !== null && baseline !== null ? current - baseline : null,
    currentSamples,
    baselineSamples,
  };
}

function comparisonWarnings(
  currentMatches: number,
  baselineMatches: number,
  minimumMatches: number,
): PeriodComparisonRow['warnings'] {
  const warnings: PeriodComparisonRow['warnings'] = [];
  if (currentMatches === 0) warnings.push('missing-current');
  else if (currentMatches < minimumMatches) warnings.push('small-current-sample');
  if (baselineMatches === 0) warnings.push('missing-baseline');
  else if (baselineMatches < minimumMatches) warnings.push('small-baseline-sample');
  return warnings.sort();
}

export function compareCoachAnalyticsPeriods(
  data: CoachAnalyticsData,
  currentQuery: CoachAnalyticsQuery,
  baselineQuery: CoachAnalyticsQuery,
): CoachAnalyticsComparison {
  const current = buildCoachAnalytics(data, currentQuery);
  const baseline = buildCoachAnalytics(data, baselineQuery);
  const minimumMatches = Math.max(current.query.minimumMatchSample, baseline.query.minimumMatchSample);
  const currentPlayers = new Map(current.playerAgentMaps.map(row => [row.key, row]));
  const baselinePlayers = new Map(baseline.playerAgentMaps.map(row => [row.key, row]));
  const playerAgentMaps = sortedUnique([...currentPlayers.keys(), ...baselinePlayers.keys()]).map(key => {
    const currentRow = currentPlayers.get(key);
    const baselineRow = baselinePlayers.get(key);
    const currentMatches = currentRow?.matchCount || 0;
    const baselineMatches = baselineRow?.matchCount || 0;
    return {
      key,
      currentMatches,
      baselineMatches,
      kd: delta(
        currentRow?.metrics.kd.value ?? null,
        baselineRow?.metrics.kd.value ?? null,
        currentRow?.metrics.kd.samples || 0,
        baselineRow?.metrics.kd.samples || 0,
      ),
      acs: delta(
        currentRow?.metrics.acs.value ?? null,
        baselineRow?.metrics.acs.value ?? null,
        currentRow?.metrics.acs.samples || 0,
        baselineRow?.metrics.acs.samples || 0,
      ),
      openingDifferential: delta(
        currentRow?.metrics.openingDifferential.total ?? null,
        baselineRow?.metrics.openingDifferential.total ?? null,
        currentRow?.metrics.openingDifferential.samples || 0,
        baselineRow?.metrics.openingDifferential.samples || 0,
      ),
      warnings: comparisonWarnings(currentMatches, baselineMatches, minimumMatches),
    };
  });
  const currentMaps = new Map(current.teamMaps.map(row => [row.key, row]));
  const baselineMaps = new Map(baseline.teamMaps.map(row => [row.key, row]));
  const teamMaps = sortedUnique([...currentMaps.keys(), ...baselineMaps.keys()]).map(key => {
    const currentRow = currentMaps.get(key);
    const baselineRow = baselineMaps.get(key);
    const currentMatches = currentRow?.matchCount || 0;
    const baselineMatches = baselineRow?.matchCount || 0;
    return {
      key,
      currentMatches,
      baselineMatches,
      kd: delta(
        currentRow?.metrics.kd.value ?? null,
        baselineRow?.metrics.kd.value ?? null,
        currentRow?.metrics.kd.samples || 0,
        baselineRow?.metrics.kd.samples || 0,
      ),
      acs: delta(
        currentRow?.metrics.acs.value ?? null,
        baselineRow?.metrics.acs.value ?? null,
        currentRow?.metrics.acs.samples || 0,
        baselineRow?.metrics.acs.samples || 0,
      ),
      openingDifferential: delta(
        currentRow?.metrics.openingDifferential.total ?? null,
        baselineRow?.metrics.openingDifferential.total ?? null,
        currentRow?.metrics.openingDifferential.samples || 0,
        baselineRow?.metrics.openingDifferential.samples || 0,
      ),
      winRate: delta(
        currentRow?.winRate ?? null,
        baselineRow?.winRate ?? null,
        currentRow?.resultCoverage.covered || 0,
        baselineRow?.resultCoverage.covered || 0,
      ),
      averageRoundDifferential: delta(
        currentRow?.averageRoundDifferential ?? null,
        baselineRow?.averageRoundDifferential ?? null,
        currentRow?.resultCoverage.covered || 0,
        baselineRow?.resultCoverage.covered || 0,
      ),
      warnings: comparisonWarnings(currentMatches, baselineMatches, minimumMatches),
    };
  });
  return { current, baseline, playerAgentMaps, teamMaps };
}

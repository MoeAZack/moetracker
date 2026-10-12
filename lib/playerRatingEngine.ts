/**
 * Domain-only shadow calculation for MoeTracker's custom performance score.
 *
 * This is not Riot Rank Rating, rank, hidden MMR, ACS, Performance Score,
 * Tracker Score, VLR Rating, or the app's separate map-ranking calculation.
 * It is intentionally advisory and must never be used as selection authority.
 */

export const SHADOW_RATING_ENGINE_VERSION = 'moe-shadow-rating-engine/1';
export const MOE_RATING_LABEL = 'MoeTracker shadow performance score';
export const MOE_RATING_ADVISORY =
  'Retrospective, non-selective coaching context only; never roster or player-selection authority.';

export const RATING_METRICS = [
  'killsPerRound',
  'deathsPerRound',
  'assistsPerRound',
  'averageDamagePerRound',
  'kastRate',
  'firstKillsPerRound',
  'firstDeathsPerRound',
] as const;

export type RatingMetric = typeof RATING_METRICS[number];
export type RatingMode = 'ranked' | 'scrim' | 'premier' | 'custom' | 'other';
export type RatingAppearance = 'core' | 'tryout' | 'standIn' | 'unclassified';
export type RatingRosterKind = 'core' | 'tryout' | 'mixed' | 'unclassified';
export type RatingWarning =
  | 'below-minimum-coverage'
  | 'below-minimum-match-sample'
  | 'below-minimum-round-sample'
  | 'below-minimum-metric-sample'
  | 'missing-metric'
  | 'missing-baseline'
  | 'zero-baseline-dispersion'
  | 'below-minimum-baseline-sample'
  | 'shadow-only-not-authoritative';

export interface RatingMetricEvidence {
  /** Aggregate rate/value. Null means unknown; it never means zero. */
  value: number | null;
  /** Independent observed rounds contributing to this metric. */
  samples: number;
}

export interface RatingSourceIdentity {
  /** Provider/import family, not a secret or URL. */
  id: string;
  /** Parser/schema/provider version that produced the facts. */
  version: string;
}

export interface RatingContext {
  playerId: string;
  displayName: string;
  mode: RatingMode;
  source: RatingSourceIdentity;
  appearance: RatingAppearance;
  rosterKind: RatingRosterKind;
  tryoutBatchId: string | null;
  matchIds: readonly string[];
  rounds: number;
  maps: readonly string[];
  agents: readonly string[];
  roles: readonly string[];
}

export interface PlayerRatingInput {
  context: RatingContext;
  metrics: Record<RatingMetric, RatingMetricEvidence>;
}

export interface RatingBaselineMetric {
  median: number;
  /** Median absolute deviation. Zero is retained and makes this metric unrated. */
  mad: number;
  rounds: number;
}

export interface RatingBaseline {
  id: string;
  version: string;
  mode: RatingMode;
  source: RatingSourceIdentity;
  metrics: Partial<Record<RatingMetric, RatingBaselineMetric>>;
}

export interface RatingThresholds {
  minimumCoverage: number;
  minimumMatches: number;
  minimumRounds: number;
  minimumMetricSamples: number;
  minimumBaselineRounds: number;
}

export interface PlayerRatingFormula {
  /** Immutable identity. Any settings change must use a new version. */
  version: string;
  /** Normalized weights. They must total exactly 1 within numeric tolerance. */
  weights: Record<RatingMetric, number>;
  thresholds: RatingThresholds;
  zCap: number;
  center: number;
  scale: number;
  bounds: { minimum: number; maximum: number };
}

export interface RatingMetricContribution {
  metric: RatingMetric;
  direction: 'positive' | 'negative';
  input: RatingMetricEvidence;
  weight: number;
  baseline: RatingBaselineMetric | null;
  rawZ: number | null;
  cappedZ: number | null;
  weightedContribution: number | null;
  included: boolean;
  exclusions: Array<
    'missing-input' | 'missing-baseline' | 'zero-baseline-dispersion' | 'baseline-sample-too-small'
  >;
}

export interface ShadowPlayerRating {
  engineVersion: typeof SHADOW_RATING_ENGINE_VERSION;
  label: typeof MOE_RATING_LABEL;
  advisory: typeof MOE_RATING_ADVISORY;
  mode: 'shadow';
  selectionAuthority: false;
  officialRiotRankOrRR: false;
  hiddenMmrEstimate: false;
  mapRankingScore: false;
  formulaVersion: string;
  formula: PlayerRatingFormula;
  baseline: { id: string; version: string };
  source: RatingSourceIdentity;
  seriesKey: string;
  context: RatingContext & { matchIds: string[]; maps: string[]; agents: string[]; roles: string[] };
  metrics: RatingMetricContribution[];
  coverage: {
    availableWeight: number;
    totalWeight: number;
    ratio: number;
  };
  samples: {
    matches: number;
    rounds: number;
    minimumMetricSamplesObserved: number | null;
  };
  calculation: {
    normalizedWeightedZ: number | null;
    uncappedScore: number | null;
    bounds: { minimum: number; maximum: number };
    shadowScore: number | null;
    /** Always null while this engine is in shadow mode. */
    authoritativeScore: null;
  };
  eligibleForShadowAggregate: boolean;
  warnings: RatingWarning[];
}

export interface RatingWeightPreview {
  kind: 'pure-shadow-weight-preview';
  current: ShadowPlayerRating;
  candidate: ShadowPlayerRating;
  scoreDelta: number | null;
  persisted: false;
}

const DIRECTIONS: Record<RatingMetric, 1 | -1> = {
  killsPerRound: 1,
  deathsPerRound: -1,
  assistsPerRound: 1,
  averageDamagePerRound: 1,
  kastRate: 1,
  firstKillsPerRound: 1,
  firstDeathsPerRound: -1,
};

const RANGES: Record<RatingMetric, readonly [number, number]> = {
  killsPerRound: [0, 5],
  deathsPerRound: [0, 2],
  assistsPerRound: [0, 5],
  averageDamagePerRound: [0, 1000],
  kastRate: [0, 1],
  firstKillsPerRound: [0, 1],
  firstDeathsPerRound: [0, 1],
};

const WEIGHT_EPSILON = 1e-9;
const RATING_MODES = ['ranked', 'scrim', 'premier', 'custom', 'other'] as const;
const APPEARANCES = ['core', 'tryout', 'standIn', 'unclassified'] as const;
const ROSTER_KINDS = ['core', 'tryout', 'mixed', 'unclassified'] as const;

function fail(message: string): never {
  throw new RangeError(`Invalid shadow player rating input: ${message}`);
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name} must be finite.`);
  return value;
}

function bounded(value: unknown, minimum: number, maximum: number, name: string): number {
  const result = finite(value, name);
  if (result < minimum || result > maximum) fail(`${name} must be between ${minimum} and ${maximum}.`);
  return result;
}

function nonnegativeInteger(value: unknown, name: string): number {
  const result = finite(value, name);
  if (!Number.isInteger(result) || result < 0) fail(`${name} must be a non-negative integer.`);
  return result;
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} must be a non-empty string.`);
  return value.trim();
}

function memberOf<const T extends readonly string[]>(value: unknown, choices: T, name: string): T[number] {
  if (typeof value !== 'string' || !choices.includes(value)) fail(`${name} is not supported.`);
  return value as T[number];
}

function normalizedStrings(values: readonly string[], name: string, allowEmpty = true): string[] {
  if (!Array.isArray(values)) fail(`${name} must be an array.`);
  const clean = values.map((value, index) => nonempty(value, `${name}[${index}]`));
  if (!allowEmpty && clean.length === 0) fail(`${name} cannot be empty.`);
  if (new Set(clean).size !== clean.length) fail(`${name} cannot contain duplicates.`);
  return clean.sort((left, right) => left.localeCompare(right, 'en'));
}

function validateSource(source: RatingSourceIdentity, name: string): RatingSourceIdentity {
  if (!source || typeof source !== 'object') fail(`${name} is required.`);
  return { id: nonempty(source.id, `${name}.id`), version: nonempty(source.version, `${name}.version`) };
}

function sameSource(left: RatingSourceIdentity, right: RatingSourceIdentity): boolean {
  return left.id === right.id && left.version === right.version;
}

function validateFormula(formula: PlayerRatingFormula): PlayerRatingFormula {
  if (!formula || typeof formula !== 'object') fail('formula is required.');
  const version = nonempty(formula.version, 'formula.version');
  const weights = {} as Record<RatingMetric, number>;
  let totalWeight = 0;
  for (const metric of RATING_METRICS) {
    const weight = bounded(formula.weights?.[metric], 0, 1, `formula.weights.${metric}`);
    weights[metric] = weight;
    totalWeight += weight;
  }
  if (Math.abs(totalWeight - 1) > WEIGHT_EPSILON) fail('formula weights must be normalized to a total of 1.');

  const thresholds: RatingThresholds = {
    minimumCoverage: bounded(formula.thresholds?.minimumCoverage, 0, 1, 'formula.thresholds.minimumCoverage'),
    minimumMatches: nonnegativeInteger(formula.thresholds?.minimumMatches, 'formula.thresholds.minimumMatches'),
    minimumRounds: nonnegativeInteger(formula.thresholds?.minimumRounds, 'formula.thresholds.minimumRounds'),
    minimumMetricSamples: nonnegativeInteger(
      formula.thresholds?.minimumMetricSamples,
      'formula.thresholds.minimumMetricSamples',
    ),
    minimumBaselineRounds: nonnegativeInteger(
      formula.thresholds?.minimumBaselineRounds,
      'formula.thresholds.minimumBaselineRounds',
    ),
  };
  const zCap = finite(formula.zCap, 'formula.zCap');
  if (zCap <= 0) fail('formula.zCap must be greater than zero.');
  const center = finite(formula.center, 'formula.center');
  const scale = finite(formula.scale, 'formula.scale');
  if (scale <= 0) fail('formula.scale must be greater than zero.');
  const minimum = finite(formula.bounds?.minimum, 'formula.bounds.minimum');
  const maximum = finite(formula.bounds?.maximum, 'formula.bounds.maximum');
  if (minimum >= maximum) fail('formula bounds must be ordered.');
  if (center < minimum || center > maximum) fail('formula center must be within score bounds.');
  return { version, weights, thresholds, zCap, center, scale, bounds: { minimum, maximum } };
}

function validateMetricEvidence(
  metric: RatingMetric,
  evidence: RatingMetricEvidence,
  totalRounds: number,
): RatingMetricEvidence {
  if (!evidence || typeof evidence !== 'object') fail(`metrics.${metric} is required; use { value: null, samples: 0 } when unknown.`);
  const samples = nonnegativeInteger(evidence.samples, `metrics.${metric}.samples`);
  if (samples > totalRounds) fail(`metrics.${metric}.samples cannot exceed context.rounds.`);
  if (evidence.value === null) {
    if (samples !== 0) fail(`metrics.${metric} cannot have samples when its value is null.`);
    return { value: null, samples: 0 };
  }
  const [minimum, maximum] = RANGES[metric];
  const value = bounded(evidence.value, minimum, maximum, `metrics.${metric}.value`);
  if (samples === 0) fail(`metrics.${metric} must have samples when its value is present.`);
  return { value, samples };
}

function validateBaselineMetric(metric: RatingMetric, baseline: RatingBaselineMetric): RatingBaselineMetric {
  if (!baseline || typeof baseline !== 'object') fail(`baseline.metrics.${metric} must be an object.`);
  const [minimum, maximum] = RANGES[metric];
  const median = bounded(baseline.median, minimum, maximum, `baseline.metrics.${metric}.median`);
  const mad = finite(baseline.mad, `baseline.metrics.${metric}.mad`);
  if (mad < 0 || mad > maximum - minimum) fail(`baseline.metrics.${metric}.mad is out of range.`);
  const rounds = nonnegativeInteger(baseline.rounds, `baseline.metrics.${metric}.rounds`);
  return { median, mad, rounds };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteCalculation(value: number, name: string): number {
  if (!Number.isFinite(value)) fail(`${name} produced a non-finite intermediate calculation.`);
  return value;
}

function formulaTotalWeight(formula: PlayerRatingFormula): number {
  return finiteCalculation(
    RATING_METRICS.reduce((sum, metric) => sum + formula.weights[metric], 0),
    'formula total weight',
  );
}

function meetsMinimum(value: number, minimum: number): boolean {
  return value + WEIGHT_EPSILON >= minimum;
}

function addWarning(warnings: Set<RatingWarning>, warning: RatingWarning) {
  warnings.add(warning);
}

/** Calculate one deterministic, non-persisting shadow result from explicit facts. */
export function calculateShadowPlayerRating(
  rawInput: PlayerRatingInput,
  rawBaseline: RatingBaseline,
  rawFormula: PlayerRatingFormula,
): ShadowPlayerRating {
  if (!rawInput || typeof rawInput !== 'object' || !rawInput.context) fail('input context is required.');
  const formula = validateFormula(rawFormula);
  const context = rawInput.context;
  const playerId = nonempty(context.playerId, 'context.playerId');
  const displayName = nonempty(context.displayName, 'context.displayName');
  const source = validateSource(context.source, 'context.source');
  const ratingMode = memberOf(context.mode, RATING_MODES, 'context.mode');
  const appearance = memberOf(context.appearance, APPEARANCES, 'context.appearance');
  const rosterKind = memberOf(context.rosterKind, ROSTER_KINDS, 'context.rosterKind');
  const matchIds = normalizedStrings(context.matchIds, 'context.matchIds');
  const rounds = nonnegativeInteger(context.rounds, 'context.rounds');
  const maps = normalizedStrings(context.maps, 'context.maps');
  const agents = normalizedStrings(context.agents, 'context.agents');
  const roles = normalizedStrings(context.roles, 'context.roles');
  if (matchIds.length === 0 && rounds > 0) fail('context.matchIds is required when rounds are present.');
  const tryoutBatchId = context.tryoutBatchId === null
    ? null
    : nonempty(context.tryoutBatchId, 'context.tryoutBatchId');

  if (!rawBaseline || typeof rawBaseline !== 'object') fail('baseline is required.');
  const baselineId = nonempty(rawBaseline.id, 'baseline.id');
  const baselineVersion = nonempty(rawBaseline.version, 'baseline.version');
  const baselineSource = validateSource(rawBaseline.source, 'baseline.source');
  const baselineMode = memberOf(rawBaseline.mode, RATING_MODES, 'baseline.mode');
  if (baselineMode !== ratingMode) fail('baseline.mode must match context.mode; modes cannot be pooled.');
  if (!sameSource(source, baselineSource)) fail('baseline source id/version must match the input source.');

  const warnings = new Set<RatingWarning>(['shadow-only-not-authoritative']);
  const contributions: RatingMetricContribution[] = [];
  const totalWeight = formulaTotalWeight(formula);
  let availableWeight = 0;
  let weightedSum = 0;
  const includedSamples: number[] = [];

  for (const metric of RATING_METRICS) {
    const input = validateMetricEvidence(metric, rawInput.metrics?.[metric], rounds);
    const baselineRaw = rawBaseline.metrics?.[metric];
    const baseline = baselineRaw ? validateBaselineMetric(metric, baselineRaw) : null;
    const exclusions: RatingMetricContribution['exclusions'] = [];
    if (input.value === null) {
      exclusions.push('missing-input');
      addWarning(warnings, 'missing-metric');
    }
    if (!baseline) {
      exclusions.push('missing-baseline');
      addWarning(warnings, 'missing-baseline');
    } else if (baseline.mad === 0) {
      exclusions.push('zero-baseline-dispersion');
      addWarning(warnings, 'zero-baseline-dispersion');
    } else if (baseline.rounds < formula.thresholds.minimumBaselineRounds) {
      exclusions.push('baseline-sample-too-small');
      addWarning(warnings, 'below-minimum-baseline-sample');
    }

    const included = exclusions.length === 0 && formula.weights[metric] > 0;
    let rawZ: number | null = null;
    let cappedZ: number | null = null;
    let weightedContribution: number | null = null;
    if (included && input.value !== null && baseline) {
      rawZ = finiteCalculation(
        (input.value - baseline.median) / baseline.mad,
        `metric ${metric} normalized value`,
      );
      cappedZ = finiteCalculation(
        clamp(rawZ, -formula.zCap, formula.zCap) * DIRECTIONS[metric],
        `metric ${metric} capped normalized value`,
      );
      weightedContribution = finiteCalculation(
        formula.weights[metric] * cappedZ,
        `metric ${metric} weighted contribution`,
      );
      availableWeight = finiteCalculation(
        availableWeight + formula.weights[metric],
        'available weight sum',
      );
      weightedSum = finiteCalculation(weightedSum + weightedContribution, 'weighted contribution sum');
      includedSamples.push(input.samples);
      if (input.samples < formula.thresholds.minimumMetricSamples) addWarning(warnings, 'below-minimum-metric-sample');
    }
    contributions.push({
      metric,
      direction: DIRECTIONS[metric] === 1 ? 'positive' : 'negative',
      input,
      weight: formula.weights[metric],
      baseline,
      rawZ,
      cappedZ,
      weightedContribution,
      included,
      exclusions,
    });
  }

  const rawCoverageRatio = finiteCalculation(availableWeight / totalWeight, 'coverage ratio');
  const coverageRatio = finiteCalculation(clamp(rawCoverageRatio, 0, 1), 'bounded coverage ratio');
  const sufficientCoverage = meetsMinimum(coverageRatio, formula.thresholds.minimumCoverage);
  if (!sufficientCoverage) addWarning(warnings, 'below-minimum-coverage');
  if (matchIds.length < formula.thresholds.minimumMatches) addWarning(warnings, 'below-minimum-match-sample');
  if (rounds < formula.thresholds.minimumRounds) addWarning(warnings, 'below-minimum-round-sample');
  const minimumMetricSamplesObserved = includedSamples.length > 0 ? Math.min(...includedSamples) : null;
  const eligible = availableWeight > 0
    && sufficientCoverage
    && matchIds.length >= formula.thresholds.minimumMatches
    && rounds >= formula.thresholds.minimumRounds
    && minimumMetricSamplesObserved !== null
    && minimumMetricSamplesObserved >= formula.thresholds.minimumMetricSamples;
  const normalizedWeightedZ = availableWeight > 0
    ? finiteCalculation(weightedSum / availableWeight, 'normalized weighted value')
    : null;
  const uncappedScore = eligible && normalizedWeightedZ !== null
    ? finiteCalculation(
      formula.center + finiteCalculation(formula.scale * normalizedWeightedZ, 'scaled normalized value'),
      'uncapped score',
    )
    : null;
  const shadowScore = uncappedScore === null
    ? null
    : finiteCalculation(
      clamp(uncappedScore, formula.bounds.minimum, formula.bounds.maximum),
      'bounded shadow score',
    );

  const normalizedContext: ShadowPlayerRating['context'] = {
    playerId,
    displayName,
    mode: ratingMode,
    source,
    appearance,
    rosterKind,
    tryoutBatchId,
    matchIds,
    rounds,
    maps,
    agents,
    roles,
  };
  return {
    engineVersion: SHADOW_RATING_ENGINE_VERSION,
    label: MOE_RATING_LABEL,
    advisory: MOE_RATING_ADVISORY,
    mode: 'shadow',
    selectionAuthority: false,
    officialRiotRankOrRR: false,
    hiddenMmrEstimate: false,
    mapRankingScore: false,
    formulaVersion: formula.version,
    formula,
    baseline: { id: baselineId, version: baselineVersion },
    source,
    seriesKey: JSON.stringify([ratingMode, source.id, source.version, formula.version, baselineId, baselineVersion]),
    context: normalizedContext,
    metrics: contributions,
    coverage: { availableWeight, totalWeight, ratio: coverageRatio },
    samples: { matches: matchIds.length, rounds, minimumMetricSamplesObserved },
    calculation: {
      normalizedWeightedZ,
      uncappedScore,
      bounds: formula.bounds,
      shadowScore,
      authoritativeScore: null,
    },
    eligibleForShadowAggregate: eligible,
    warnings: [...warnings].sort(),
  };
}

/** Pure owner/coach preview. It changes no settings and writes no result. */
export function previewShadowRatingWeights(
  input: PlayerRatingInput,
  baseline: RatingBaseline,
  currentFormula: PlayerRatingFormula,
  candidateFormula: PlayerRatingFormula,
): RatingWeightPreview {
  const canonicalCurrentFormula = validateFormula(currentFormula);
  const canonicalCandidateFormula = validateFormula(candidateFormula);
  if (canonicalCurrentFormula.version === canonicalCandidateFormula.version
    && JSON.stringify(canonicalCurrentFormula) !== JSON.stringify(canonicalCandidateFormula)) {
    fail('a changed formula must use a new immutable formula version.');
  }
  const current = calculateShadowPlayerRating(input, baseline, canonicalCurrentFormula);
  const candidate = calculateShadowPlayerRating(input, baseline, canonicalCandidateFormula);
  const currentScore = current.calculation.shadowScore;
  const candidateScore = candidate.calculation.shadowScore;
  const scoreDelta = currentScore === null || candidateScore === null
    ? null
    : finiteCalculation(candidateScore - currentScore, 'preview score delta');
  return {
    kind: 'pure-shadow-weight-preview',
    current,
    candidate,
    scoreDelta,
    persisted: false,
  };
}

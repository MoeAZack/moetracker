import { describe, expect, it } from 'vitest';
import {
  calculateShadowPlayerRating,
  previewShadowRatingWeights,
  type PlayerRatingFormula,
  type PlayerRatingInput,
  type RatingBaseline,
} from '../lib/playerRatingEngine';

const formula = (): PlayerRatingFormula => ({
  version: 'mpr-shadow/v1.0.0',
  weights: {
    killsPerRound: 0.25,
    deathsPerRound: 0.20,
    assistsPerRound: 0.10,
    averageDamagePerRound: 0.15,
    kastRate: 0.15,
    firstKillsPerRound: 0.10,
    firstDeathsPerRound: 0.05,
  },
  thresholds: {
    minimumCoverage: 0.75,
    minimumMatches: 3,
    minimumRounds: 50,
    minimumMetricSamples: 40,
    minimumBaselineRounds: 300,
  },
  zCap: 3,
  center: 1,
  scale: 0.15,
  bounds: { minimum: 0, maximum: 2 },
});

const input = (): PlayerRatingInput => ({
  context: {
    playerId: 'player-1',
    displayName: 'Alpha',
    mode: 'scrim',
    source: { id: 'reviewed-replay-events', version: '2.1.0' },
    appearance: 'core',
    rosterKind: 'mixed',
    tryoutBatchId: 'batch-7',
    matchIds: ['match-c', 'match-a', 'match-b'],
    rounds: 60,
    maps: ['Haven', 'Ascent'],
    agents: ['Sova', 'Omen'],
    roles: ['initiator', 'controller'],
  },
  metrics: {
    killsPerRound: { value: 0.8, samples: 60 },
    deathsPerRound: { value: 0.6, samples: 60 },
    assistsPerRound: { value: 0.4, samples: 60 },
    averageDamagePerRound: { value: 160, samples: 60 },
    kastRate: { value: 0.8, samples: 60 },
    firstKillsPerRound: { value: 0.15, samples: 60 },
    firstDeathsPerRound: { value: 0.05, samples: 60 },
  },
});

const baseline = (): RatingBaseline => ({
  id: 'scrim-replay-role-baseline',
  version: '2026-10-12.1',
  mode: 'scrim',
  source: { id: 'reviewed-replay-events', version: '2.1.0' },
  metrics: {
    killsPerRound: { median: 0.7, mad: 0.1, rounds: 500 },
    deathsPerRound: { median: 0.7, mad: 0.1, rounds: 500 },
    assistsPerRound: { median: 0.3, mad: 0.1, rounds: 500 },
    averageDamagePerRound: { median: 140, mad: 20, rounds: 500 },
    kastRate: { median: 0.7, mad: 0.1, rounds: 500 },
    firstKillsPerRound: { median: 0.1, mad: 0.05, rounds: 500 },
    firstDeathsPerRound: { median: 0.1, mad: 0.05, rounds: 500 },
  },
});

describe('shadow player rating engine', () => {
  it('produces a transparent deterministic shadow calculation with preserved context', () => {
    const result = calculateShadowPlayerRating(input(), baseline(), formula());

    expect(result.label).toBe('MoeTracker shadow performance score');
    expect(result.mode).toBe('shadow');
    expect(result.selectionAuthority).toBe(false);
    expect(result.officialRiotRankOrRR).toBe(false);
    expect(result.hiddenMmrEstimate).toBe(false);
    expect(result.mapRankingScore).toBe(false);
    expect(result.formulaVersion).toBe('mpr-shadow/v1.0.0');
    expect(result.formula).toEqual(formula());
    expect(result.source).toEqual({ id: 'reviewed-replay-events', version: '2.1.0' });
    expect(result.context).toMatchObject({
      appearance: 'core',
      rosterKind: 'mixed',
      tryoutBatchId: 'batch-7',
      matchIds: ['match-a', 'match-b', 'match-c'],
      maps: ['Ascent', 'Haven'],
      agents: ['Omen', 'Sova'],
      roles: ['controller', 'initiator'],
    });
    expect(result.metrics).toHaveLength(7);
    expect(result.metrics.every(metric => metric.included)).toBe(true);
    const deaths = result.metrics.find(metric => metric.metric === 'deathsPerRound');
    expect(deaths?.direction).toBe('negative');
    expect(deaths?.rawZ).toBeCloseTo(-1);
    expect(deaths?.cappedZ).toBeCloseTo(1);
    expect(deaths?.weightedContribution).toBeCloseTo(0.2);
    expect(result.coverage).toEqual({ availableWeight: 1, totalWeight: 1, ratio: 1 });
    expect(result.calculation.normalizedWeightedZ).toBeCloseTo(1);
    expect(result.calculation.shadowScore).toBeCloseTo(1.15);
    expect(result.calculation.authoritativeScore).toBeNull();
    expect(result.eligibleForShadowAggregate).toBe(true);
    expect(result.warnings).toEqual(['shadow-only-not-authoritative']);
    expect(calculateShadowPlayerRating(input(), baseline(), formula())).toEqual(result);
  });

  it('keeps missing facts null, excludes their weights, exposes coverage, and withholds the score', () => {
    const partial = input();
    partial.metrics.averageDamagePerRound = { value: null, samples: 0 };
    partial.metrics.kastRate = { value: null, samples: 0 };
    const result = calculateShadowPlayerRating(partial, baseline(), formula());

    expect(result.metrics.find(metric => metric.metric === 'averageDamagePerRound')).toMatchObject({
      input: { value: null, samples: 0 },
      included: false,
      weightedContribution: null,
      exclusions: ['missing-input'],
    });
    expect(result.coverage.ratio).toBeCloseTo(0.7);
    expect(result.eligibleForShadowAggregate).toBe(false);
    expect(result.calculation.normalizedWeightedZ).toBeCloseTo(1);
    expect(result.calculation.uncappedScore).toBeNull();
    expect(result.calculation.shadowScore).toBeNull();
    expect(result.warnings).toEqual(expect.arrayContaining(['missing-metric', 'below-minimum-coverage']));
  });

  it('uses the validated actual total weight and tolerance for complete fractional coverage', () => {
    const sevenths = formula();
    for (const metric of Object.keys(sevenths.weights) as Array<keyof typeof sevenths.weights>) {
      sevenths.weights[metric] = 1 / 7;
    }
    sevenths.thresholds.minimumCoverage = 1;
    const complete = calculateShadowPlayerRating(input(), baseline(), sevenths);

    expect(complete.coverage.availableWeight).toBeCloseTo(7 / 7);
    expect(complete.coverage.totalWeight).toBeCloseTo(7 / 7);
    expect(complete.coverage.ratio).toBe(1);
    expect(complete.eligibleForShadowAggregate).toBe(true);
    expect(complete.warnings).not.toContain('below-minimum-coverage');

    const incompleteInput = input();
    incompleteInput.metrics.firstDeathsPerRound = { value: null, samples: 0 };
    const incomplete = calculateShadowPlayerRating(incompleteInput, baseline(), sevenths);
    expect(incomplete.coverage.ratio).toBeCloseTo(6 / 7);
    expect(incomplete.eligibleForShadowAggregate).toBe(false);
    expect(incomplete.warnings).toContain('below-minimum-coverage');
  });

  it('makes absent, under-sampled, and zero-dispersion baselines explicit exclusions', () => {
    const reference = baseline();
    delete reference.metrics.kastRate;
    reference.metrics.killsPerRound = { median: 0.7, mad: 0, rounds: 500 };
    reference.metrics.assistsPerRound = { median: 0.3, mad: 0.1, rounds: 299 };
    const result = calculateShadowPlayerRating(input(), reference, formula());

    expect(result.metrics.find(metric => metric.metric === 'kastRate')).toMatchObject({
      baseline: null,
      exclusions: ['missing-baseline'],
    });
    expect(result.metrics.find(metric => metric.metric === 'killsPerRound')?.exclusions)
      .toEqual(['zero-baseline-dispersion']);
    expect(result.metrics.find(metric => metric.metric === 'assistsPerRound')?.exclusions)
      .toEqual(['baseline-sample-too-small']);
    expect(result.warnings).toEqual(expect.arrayContaining([
      'missing-baseline',
      'zero-baseline-dispersion',
      'below-minimum-baseline-sample',
    ]));
  });

  it('withholds aggregates below configurable match, round, or per-metric samples', () => {
    const sparse = input();
    sparse.context.matchIds = ['only-one'];
    sparse.context.rounds = 30;
    for (const metric of Object.values(sparse.metrics)) metric.samples = 30;
    const result = calculateShadowPlayerRating(sparse, baseline(), formula());

    expect(result.eligibleForShadowAggregate).toBe(false);
    expect(result.calculation.shadowScore).toBeNull();
    expect(result.samples).toEqual({ matches: 1, rounds: 30, minimumMetricSamplesObserved: 30 });
    expect(result.warnings).toEqual(expect.arrayContaining([
      'below-minimum-match-sample',
      'below-minimum-round-sample',
      'below-minimum-metric-sample',
    ]));
  });

  it('caps normalized components and the final score while exposing both caps', () => {
    const extreme = input();
    extreme.metrics.killsPerRound.value = 5;
    const narrow = formula();
    narrow.bounds.maximum = 1.05;
    const result = calculateShadowPlayerRating(extreme, baseline(), narrow);
    const kills = result.metrics.find(metric => metric.metric === 'killsPerRound');

    expect(kills?.rawZ).toBeCloseTo(43);
    expect(kills?.cappedZ).toBe(3);
    expect(result.calculation.uncappedScore).toBeGreaterThan(1.05);
    expect(result.calculation.shadowScore).toBe(1.05);
    expect(result.calculation.bounds).toEqual({ minimum: 0, maximum: 1.05 });
  });

  it('rejects overflow from extreme but finite baseline dispersion and score settings', () => {
    const tinyDispersion = baseline();
    tinyDispersion.metrics.killsPerRound!.mad = Number.MIN_VALUE;
    expect(() => calculateShadowPlayerRating(input(), tinyDispersion, formula())).toThrow(
      /non-finite intermediate calculation/,
    );

    const extremeScoreInput = input();
    extremeScoreInput.metrics.killsPerRound.value = 0.9;
    const extremeScoreFormula = formula();
    extremeScoreFormula.center = 0;
    extremeScoreFormula.scale = Number.MAX_VALUE;
    extremeScoreFormula.bounds = { minimum: -Number.MAX_VALUE, maximum: Number.MAX_VALUE };
    expect(() => calculateShadowPlayerRating(extremeScoreInput, baseline(), extremeScoreFormula)).toThrow(
      /non-finite intermediate calculation/,
    );
  });

  it('recomputes solely from corrected inputs and returns to the exact prior result', () => {
    const originalInput = input();
    const original = calculateShadowPlayerRating(originalInput, baseline(), formula());
    const corrected = input();
    corrected.metrics.killsPerRound.value = 0.9;
    const afterCorrection = calculateShadowPlayerRating(corrected, baseline(), formula());

    expect(afterCorrection.calculation.shadowScore).not.toBe(original.calculation.shadowScore);
    expect(calculateShadowPlayerRating(originalInput, baseline(), formula())).toEqual(original);
  });

  it('previews changed weights as a pure, non-persisted calculation with a new formula version', () => {
    const currentInput = input();
    const currentFormula = formula();
    const candidate = formula();
    candidate.version = 'mpr-shadow/v1.1.0-preview';
    candidate.weights.killsPerRound = 0.35;
    candidate.weights.deathsPerRound = 0.10;
    const before = structuredClone(currentInput);
    const preview = previewShadowRatingWeights(currentInput, baseline(), currentFormula, candidate);

    expect(preview.kind).toBe('pure-shadow-weight-preview');
    expect(preview.persisted).toBe(false);
    expect(preview.current.formulaVersion).toBe('mpr-shadow/v1.0.0');
    expect(preview.candidate.formulaVersion).toBe('mpr-shadow/v1.1.0-preview');
    expect(preview.candidate.calculation.authoritativeScore).toBeNull();
    expect(currentInput).toEqual(before);
  });

  it('never pools competition modes or source versions', () => {
    const wrongMode = baseline();
    wrongMode.mode = 'ranked';
    expect(() => calculateShadowPlayerRating(input(), wrongMode, formula())).toThrow(/modes cannot be pooled/);

    const wrongSource = baseline();
    wrongSource.source.version = 'older';
    expect(() => calculateShadowPlayerRating(input(), wrongSource, formula())).toThrow(/source id\/version/);
  });

  it.each([
    ['non-finite metric', () => { const value = input(); value.metrics.killsPerRound.value = Number.NaN; return [value, baseline(), formula()] as const; }],
    ['out-of-range metric', () => { const value = input(); value.metrics.kastRate.value = 1.01; return [value, baseline(), formula()] as const; }],
    ['samples above rounds', () => { const value = input(); value.metrics.killsPerRound.samples = 61; return [value, baseline(), formula()] as const; }],
    ['null with samples', () => { const value = input(); value.metrics.killsPerRound = { value: null, samples: 2 }; return [value, baseline(), formula()] as const; }],
    ['unnormalized weights', () => { const value = formula(); value.weights.killsPerRound = 0.2; return [input(), baseline(), value] as const; }],
    ['negative baseline dispersion', () => { const value = baseline(); value.metrics.killsPerRound!.mad = -0.1; return [input(), value, formula()] as const; }],
    ['duplicate match IDs', () => { const value = input(); value.context.matchIds = ['same', 'same']; return [value, baseline(), formula()] as const; }],
    ['unknown competition mode', () => { const value = input(); value.context.mode = 'deathmatch' as 'scrim'; return [value, baseline(), formula()] as const; }],
    ['unknown appearance', () => { const value = input(); value.context.appearance = 'bench' as 'core'; return [value, baseline(), formula()] as const; }],
  ])('fails closed for %s', (_name, build) => {
    const [ratingInput, ratingBaseline, ratingFormula] = build();
    expect(() => calculateShadowPlayerRating(ratingInput, ratingBaseline, ratingFormula)).toThrow(
      /Invalid shadow player rating input/,
    );
  });

  it('requires a new version when preview settings change', () => {
    const candidate = formula();
    candidate.weights.killsPerRound = 0.35;
    candidate.weights.deathsPerRound = 0.10;
    expect(() => previewShadowRatingWeights(input(), baseline(), formula(), candidate)).toThrow(
      /new immutable formula version/,
    );
  });

  it('canonicalizes formula versions before comparison and series-key construction', () => {
    const padded = formula();
    padded.version = '  mpr-shadow/v1.0.0  ';
    const canonical = calculateShadowPlayerRating(input(), baseline(), formula());
    const normalized = calculateShadowPlayerRating(input(), baseline(), padded);
    expect(normalized.formulaVersion).toBe('mpr-shadow/v1.0.0');
    expect(normalized.seriesKey).toBe(canonical.seriesKey);

    const changed = formula();
    changed.weights.killsPerRound = 0.35;
    changed.weights.deathsPerRound = 0.10;
    expect(() => previewShadowRatingWeights(input(), baseline(), padded, changed)).toThrow(
      /new immutable formula version/,
    );
  });

  it('rejects a non-finite preview delta even when both bounded scores are finite', () => {
    const divergent = input();
    divergent.metrics.killsPerRound.value = 0.775;
    divergent.metrics.deathsPerRound.value = 0.775;
    const positive = formula();
    positive.version = 'positive/extreme';
    positive.weights = {
      killsPerRound: 1,
      deathsPerRound: 0,
      assistsPerRound: 0,
      averageDamagePerRound: 0,
      kastRate: 0,
      firstKillsPerRound: 0,
      firstDeathsPerRound: 0,
    };
    positive.center = 0;
    positive.scale = Number.MAX_VALUE;
    positive.bounds = { minimum: -Number.MAX_VALUE, maximum: Number.MAX_VALUE };
    positive.thresholds.minimumCoverage = 1;
    const negative = structuredClone(positive);
    negative.version = 'negative/extreme';
    negative.weights.killsPerRound = 0;
    negative.weights.deathsPerRound = 1;

    expect(() => previewShadowRatingWeights(divergent, baseline(), positive, negative)).toThrow(
      /preview score delta produced a non-finite intermediate calculation/,
    );
  });

  it('treats observed zero as data rather than missingness', () => {
    const zero = input();
    zero.metrics.firstDeathsPerRound = { value: 0, samples: 60 };
    const result = calculateShadowPlayerRating(zero, baseline(), formula());
    expect(result.metrics.find(metric => metric.metric === 'firstDeathsPerRound')).toMatchObject({
      input: { value: 0, samples: 60 },
      included: true,
      exclusions: [],
    });
  });
});

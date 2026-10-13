import { describe, expect, it } from 'vitest';
import { addPlayerEvidence, emptyPlayerEvidence, headshotRate, knownResult, knownRoundSide, matchOutcome, untradedRate } from '../lib/analyticsEvidence';

describe('analytics evidence rules', () => {
  it('does not turn unknown sides or results into defense losses', () => {
    expect(knownRoundSide(undefined)).toBeNull();
    expect(knownRoundSide('something else')).toBeNull();
    expect(knownRoundSide('Def')).toBe('Defense');
    expect(knownResult(undefined)).toBeNull();
    expect(knownResult('pending')).toBeNull();
    expect(knownResult('L')).toBe('loss');
  });

  it('does not turn missing match scores into draws', () => {
    expect(matchOutcome({ ourScore: null, theirScore: null, attW: null, attL: null, defW: null, defL: null })).toBeNull();
    expect(matchOutcome({ ourScore: 13, theirScore: 13 })).toBe('draw');
    expect(matchOutcome({ attW: 7, attL: 5, defW: 6, defL: 4 })).toBe('win');
  });

  it('does not infer zero traded deaths when trade evidence is unknown', () => {
    const acc = emptyPlayerEvidence();
    addPlayerEvidence(acc, { deaths: 10, dTraded: undefined });
    expect(untradedRate(acc)).toBeNull();
    addPlayerEvidence(acc, { deaths: 10, dTraded: 4 });
    expect(untradedRate(acc)).toBe(60);
  });

  it('uses kill counters when supplied and otherwise kill-weights percentage rows including zero', () => {
    const raw = emptyPlayerEvidence();
    addPlayerEvidence(raw, { kills: 20, hs: 5, headshots: 8, headshotEligibleKills: 10 });
    addPlayerEvidence(raw, { kills: 2, hs: 100 });
    expect(headshotRate(raw)).toEqual({ value: 80, basis: 'kills' });

    const percentages = emptyPlayerEvidence();
    addPlayerEvidence(percentages, { kills: 10, hs: 0 });
    addPlayerEvidence(percentages, { kills: 30, hs: 100 });
    expect(headshotRate(percentages)).toEqual({ value: 75, basis: 'weighted-percent' });
  });
});

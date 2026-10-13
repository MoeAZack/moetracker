export type KnownRoundSide = 'Attack' | 'Defense';
export type KnownResult = 'win' | 'loss';

const finiteNonnegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export function knownRoundSide(value: unknown): KnownRoundSide | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'attack' || normalized === 'att') return 'Attack';
  if (normalized === 'defense' || normalized === 'defence' || normalized === 'def') return 'Defense';
  return null;
}

export function knownResult(value: unknown): KnownResult | null {
  if (value === true) return 'win';
  if (value === false) return 'loss';
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'w' || normalized === 'win' || normalized === 'won') return 'win';
  if (normalized === 'l' || normalized === 'loss' || normalized === 'lost') return 'loss';
  return null;
}

export function matchOutcome(match: {
  ourScore?: unknown; theirScore?: unknown;
  attW?: unknown; attL?: unknown; defW?: unknown; defL?: unknown;
}): KnownResult | 'draw' | null {
  let ours = finiteNonnegative(match.ourScore);
  let theirs = finiteNonnegative(match.theirScore);
  if (ours === null || theirs === null) {
    const attW = finiteNonnegative(match.attW);
    const attL = finiteNonnegative(match.attL);
    const defW = finiteNonnegative(match.defW);
    const defL = finiteNonnegative(match.defL);
    if (attW === null || attL === null || defW === null || defL === null) return null;
    ours = attW + defW;
    theirs = attL + defL;
  }
  return ours > theirs ? 'win' : ours < theirs ? 'loss' : 'draw';
}

export interface PlayerEvidenceAccumulator {
  untradedDeaths: number;
  tradeKnownDeaths: number;
  headshots: number;
  headshotEligibleKills: number;
  hsPercentWeightedSum: number;
  hsPercentWeight: number;
}

export const emptyPlayerEvidence = (): PlayerEvidenceAccumulator => ({
  untradedDeaths: 0,
  tradeKnownDeaths: 0,
  headshots: 0,
  headshotEligibleKills: 0,
  hsPercentWeightedSum: 0,
  hsPercentWeight: 0,
});

export function addPlayerEvidence(acc: PlayerEvidenceAccumulator, row: {
  deaths?: unknown; dTraded?: unknown; kills?: unknown; hs?: unknown;
  headshots?: unknown; headshotEligibleKills?: unknown;
}): void {
  const deaths = finiteNonnegative(row.deaths);
  const traded = finiteNonnegative(row.dTraded);
  if (deaths !== null && traded !== null) {
    acc.tradeKnownDeaths += deaths;
    acc.untradedDeaths += Math.max(0, deaths - Math.min(deaths, traded));
  }

  const headshots = finiteNonnegative(row.headshots);
  const eligible = finiteNonnegative(row.headshotEligibleKills);
  if (headshots !== null && eligible !== null && eligible > 0) {
    acc.headshots += Math.min(headshots, eligible);
    acc.headshotEligibleKills += eligible;
    return;
  }

  const hs = finiteNonnegative(row.hs);
  const kills = finiteNonnegative(row.kills);
  if (hs !== null && hs <= 100 && kills !== null && kills > 0) {
    acc.hsPercentWeightedSum += hs * kills;
    acc.hsPercentWeight += kills;
  }
}

export function untradedRate(acc: PlayerEvidenceAccumulator): number | null {
  return acc.tradeKnownDeaths > 0 ? Math.round((acc.untradedDeaths / acc.tradeKnownDeaths) * 100) : null;
}

export function headshotRate(acc: PlayerEvidenceAccumulator): { value: number | null; basis: 'kills' | 'weighted-percent' | null } {
  if (acc.headshotEligibleKills > 0) {
    return { value: Math.round((acc.headshots / acc.headshotEligibleKills) * 100), basis: 'kills' };
  }
  if (acc.hsPercentWeight > 0) {
    return { value: Math.round(acc.hsPercentWeightedSum / acc.hsPercentWeight), basis: 'weighted-percent' };
  }
  return { value: null, basis: null };
}

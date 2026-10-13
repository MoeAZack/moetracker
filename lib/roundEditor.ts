type ScoreSplits = { ourScore?: unknown; theirScore?: unknown; attW?: unknown; attL?: unknown; defW?: unknown; defL?: unknown };
type ExistingRound = { roundNo: number; [key: string]: unknown };

const knownCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;

export function roundEditorRowCount(match: ScoreSplits, existing: ExistingRound[]): number {
  const splits = [match.attW, match.attL, match.defW, match.defL];
  const finalScores = [match.ourScore, match.theirScore];
  const knownScoreTotal = finalScores.every(knownCount)
    ? (finalScores as number[]).reduce((sum, value) => sum + value, 0)
    : splits.every(knownCount) ? (splits as number[]).reduce((sum, value) => sum + value, 0) : 0;
  const highestExistingRound = existing.reduce((highest, round) => knownCount(round.roundNo) ? Math.max(highest, round.roundNo) : highest, 0);
  return Math.max(24, knownScoreTotal, highestExistingRound);
}

const evidenceFields = [
  'side', 'buy', 'enemyBuy', 'result', 'winBy', 'plant', 'site', 'notes',
  'isThrow', 'thrownBy', 'throwReason', 'firstKillBy', 'firstDeathBy',
  'clutchType', 'clutchPlayer', 'clutchResult', 'iglPlayer', 'iglRole',
  'midRoundIglChange', 'strategies', 'sourceMetadata', 'replayEvidence', 'corrections',
] as const;

export function roundHasEvidence(round: Record<string, unknown>): boolean {
  if (typeof round.id === 'string' && round.id.trim()) return true;
  return evidenceFields.some(field => {
    const value = round[field];
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== false;
  });
}

export function savableRoundEditorRows<T extends Record<string, unknown>>(rounds: T[]): T[] {
  return rounds.filter(roundHasEvidence);
}

export function buildRoundEditorRows(match: ScoreSplits & { id: string }, existing: ExistingRound[]) {
  const byNumber = new Map(existing.filter(round => knownCount(round.roundNo)).map(round => [round.roundNo, round]));
  return Array.from({ length: roundEditorRowCount(match, existing) }, (_, index) => {
    const roundNo = index + 1;
    const saved = byNumber.get(roundNo);
    if (saved) return { ...saved, side: saved.side === 'Att' ? 'Attack' : saved.side === 'Def' ? 'Defense' : saved.side };
    return {
      id: '', matchId: match.id, roundNo,
      side: '', buy: '', enemyBuy: '', result: '', winBy: '',
      plant: '', site: '', notes: '', isThrow: '', thrownBy: '', throwReason: '',
    };
  });
}

import { describe, expect, it } from 'vitest';
import { buildRoundEditorRows, roundEditorRowCount, savableRoundEditorRows } from '../lib/roundEditor';

describe('round editor rows', () => {
  it('uses a 24-row minimum without treating unknown splits as numbers', () => {
    expect(roundEditorRowCount({ attW: null, attL: undefined, defW: null, defL: null }, [])).toBe(24);
    const rows = buildRoundEditorRows({ id: 'm1', attW: null, attL: null, defW: null, defL: null }, []);
    expect(rows[0]).toMatchObject({ roundNo: 1, side: '', buy: '', enemyBuy: '', result: '', winBy: '', site: '' });
  });

  it('uses a fully known score total and retains high-numbered existing evidence', () => {
    expect(roundEditorRowCount({ attW: 13, attL: 11, defW: 0, defL: 0 }, [])).toBe(24);
    const existing = [{ id: 'r31', matchId: 'm1', roundNo: 31, side: 'Defense', result: '', notes: 'overtime evidence with unknown result' }];
    const rows = buildRoundEditorRows({ id: 'm1', attW: 14, attL: 12, defW: 1, defL: 1 }, existing);
    expect(rows).toHaveLength(31);
    expect(rows[30]).toEqual(existing[0]);
  });

  it('prefers known final scores over conflicting split totals', () => {
    expect(roundEditorRowCount({ ourScore: 16, theirScore: 14, attW: 1, attL: 1, defW: 1, defL: 1 }, [])).toBe(30);
  });

  it('saves unknown-result evidence but discards untouched generated placeholders', () => {
    const rows = buildRoundEditorRows(
      { id: 'm1', ourScore: 13, theirScore: 9 },
      [{ id: 'persisted', matchId: 'm1', roundNo: 25, side: '', result: '', notes: '' }],
    );
    rows[1].notes = 'Coach annotation with result unknown';
    const saved = savableRoundEditorRows(rows);
    expect(saved.map(round => round.roundNo)).toEqual([2, 25]);
    expect(saved[0].result).toBe('');
  });
});

import { expect, it } from 'vitest';
import { partitionScreenshotRows } from '../lib/screenshotRosterDraft';

it('retains duplicate, unknown and substitute rows for explicit mapping without overwriting', () => {
  const rows = [{ matchedPlayerId: 'a', kills: 1 }, { matchedPlayerId: 'a', kills: 2 }, { matchedPlayerId: 'b', kills: 3 }, { matchedPlayerId: 'sub', kills: 4 }, { matchedPlayerId: null, kills: 5 }];
  const result = partitionScreenshotRows(rows, new Set(['a', 'b']));
  expect([...result.resolved.keys()]).toEqual(['b']);
  expect(result.unresolved.map(row => row.kills)).toEqual([1, 2, 4, 5]);
  expect(result.unresolved.length + result.resolved.size).toBe(rows.length);
});

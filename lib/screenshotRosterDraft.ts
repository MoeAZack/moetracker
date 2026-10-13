/** Only unique, active-core identity matches may be prefilled without a choice. */
export function partitionScreenshotRows<T extends { matchedPlayerId?: string | null }>(rows: T[], activeCoreIds: Set<string>) {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.matchedPlayerId) counts.set(row.matchedPlayerId, (counts.get(row.matchedPlayerId) || 0) + 1);
  const resolved = new Map<string, T>();
  const unresolved: T[] = [];
  for (const row of rows) {
    const id = row.matchedPlayerId;
    if (id && activeCoreIds.has(id) && counts.get(id) === 1) resolved.set(id, row);
    else unresolved.push(row);
  }
  return { resolved, unresolved };
}

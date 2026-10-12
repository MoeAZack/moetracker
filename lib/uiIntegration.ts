import type { CoreMembership, Match, PlayerStats, TrackerData, VodReview } from '../src/types';
import { toCairoDateKey } from './coachAnalytics';

export type IntegrationReadiness =
  | { status: 'ready'; detail: string }
  | { status: 'unavailable'; reason: 'adapter-not-persisted' | 'provider-ineligible' | 'consent-missing' | 'evidence-missing' | 'baseline-missing'; detail: string };

export function normalizedMatchDate(value: string): string | null { return toCairoDateKey(value); }

export function matchDateWindow(matches: readonly Match[]) {
  const dates = matches.map(match => normalizedMatchDate(match.date)).filter((date): date is string => date !== null).sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
}

export function activeRosterCount(data: { coreMemberships?: CoreMembership[]; settings: TrackerData['settings'] }): { count: number; source: 'membership' | 'legacy' } {
  if (Array.isArray(data.coreMemberships)) return { count: data.coreMemberships.filter((member: CoreMembership) => !member.endedAt).length, source: 'membership' };
  return { count: data.settings.players.length, source: 'legacy' };
}

export function resolveInitialVodSelection(reviews: readonly VodReview[], initialMatchId: string | null | undefined): string | null {
  return initialMatchId ? reviews.find(review => review.matchId === initialMatchId)?.id || null : reviews[0]?.id || null;
}

export function selectedVodMatchId(reviews: readonly VodReview[], selectedId: string | null): string | null {
  return reviews.find(review => review.id === selectedId)?.matchId || null;
}

export function vodContextMatchId(reviews: readonly VodReview[], selectedId: string | null, initialMatchId: string | null | undefined, explicitlySelected: boolean): string | null {
  const selected = selectedVodMatchId(reviews, selectedId);
  return selected || (!explicitlySelected && selectedId === null ? initialMatchId || null : null);
}

export interface ObservedPlayerKd {
  identity: string; playerId: string | null; displayName: string; recordedRows: number; pairedSamples: number; kd: number | null;
}

export function aggregateObservedPlayerKd(rows: readonly PlayerStats[]): ObservedPlayerKd[] {
  const groups = new Map<string, { playerId: string | null; displayName: string; rows: PlayerStats[] }>();
  rows.forEach((row, index) => {
    const displayName = row.displayNameSnapshot?.trim() || row.player?.trim() || 'Unknown player';
    const identity = row.playerId?.trim() || `legacy:${displayName.toLocaleLowerCase('en')}`;
    const current = groups.get(identity) || { playerId: row.playerId || null, displayName, rows: [] };
    current.rows.push(row); groups.set(identity, current);
    void index;
  });
  return [...groups.entries()].map(([identity, group]) => {
    const paired = group.rows.filter(row => typeof row.kills === 'number' && Number.isFinite(row.kills) && row.kills >= 0 && typeof row.deaths === 'number' && Number.isFinite(row.deaths) && row.deaths >= 0);
    const kills = paired.reduce((sum, row) => sum + Number(row.kills), 0);
    const deaths = paired.reduce((sum, row) => sum + Number(row.deaths), 0);
    return { identity, playerId: group.playerId, displayName: group.displayName, recordedRows: group.rows.length, pairedSamples: paired.length, kd: paired.length && deaths > 0 ? kills / deaths : null };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName, 'en') || a.identity.localeCompare(b.identity, 'en'));
}

export const rankedIntegrationReadiness = (): IntegrationReadiness => ({ status: 'unavailable', reason: 'adapter-not-persisted', detail: 'No provider capability, versioned consent, exact account identity, or sync state is persisted.' });
export const shadowRatingReadiness = (): IntegrationReadiness => ({ status: 'unavailable', reason: 'adapter-not-persisted', detail: 'No versioned rating input and baseline adapter is persisted.' });
export const canOpenPrivateMatchReview = (role: string | null): boolean => role === 'coach';

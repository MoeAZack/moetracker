import type { CoreMembership, Match, TrackerData, VodReview } from '../src/types';
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

export const rankedIntegrationReadiness = (): IntegrationReadiness => ({ status: 'unavailable', reason: 'adapter-not-persisted', detail: 'No provider capability, versioned consent, exact account identity, or sync state is persisted.' });
export const shadowRatingReadiness = (): IntegrationReadiness => ({ status: 'unavailable', reason: 'adapter-not-persisted', detail: 'No versioned rating input and baseline adapter is persisted.' });

import type { CoreMembership, Match, PlayerStats, TrackerData, VodReview } from '../src/types';
import { toCairoDateKey } from './coachAnalytics';

export type IntegrationReadiness =
  | { status: 'ready'; detail: string }
  | { status: 'unavailable'; reason: 'provider-ineligible' | 'consent-missing' | 'evidence-missing' | 'baseline-missing'; detail: string };

export function normalizedMatchDate(value: string): string | null { return toCairoDateKey(value); }

export function cairoDateKeyAt(date: Date = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

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

const values = (value: any): any[] => Array.isArray(value) ? value : Object.values(value || {});
export function replayIntegrationReadiness(payload: any): IntegrationReadiness {
  const records = values(payload?.replay);
  const accepted = records.filter(item => item?.status === 'accepted').length;
  return records.length ? { status: 'ready', detail: `${records.length} persisted replay review${records.length === 1 ? '' : 's'}; ${accepted} accepted.` } : { status: 'unavailable', reason: 'evidence-missing', detail: 'No persisted replay evidence exists for the active season.' };
}
export function shadowRatingReadiness(payload?: any): IntegrationReadiness {
  const records = values(Array.isArray(payload?.ratings) ? payload.ratings : payload?.ratings?.records);
  const eligible = records.filter(item => item?.status === 'accepted' && item?.result?.eligibleForShadowAggregate).length;
  const calibrated = records.filter(item => item?.calibrationStatus === 'calibrated').length;
  return records.length ? { status: 'ready', detail: `${records.length} persisted shadow record${records.length === 1 ? '' : 's'}; ${eligible} accepted with coverage; ${calibrated} calibrated.` } : { status: 'unavailable', reason: 'baseline-missing', detail: 'No recomputed rating record exists for the active season.' };
}
export function rankedIntegrationReadiness(payload?: any): IntegrationReadiness {
  const providers = values(payload?.ranked?.providers); const accounts = values(payload?.ranked?.accounts);
  const consents = values(payload?.ranked?.consents).filter(item => !item?.revokedAt); const states = values(payload?.ranked?.states);
  if (!providers.length && !accounts.length && !states.length) return { status: 'unavailable', reason: 'provider-ineligible', detail: 'No persisted ranked provider capability or active-season account exists.' };
  if (!consents.length) return { status: 'unavailable', reason: 'consent-missing', detail: `${accounts.length} persisted account${accounts.length === 1 ? '' : 's'}; explicit player consent is missing.` };
  const counts = ['fresh', 'partial', 'stale', 'error', 'blocked', 'never-synced'].map(status => `${states.filter(item => item?.status === status).length} ${status}`).join(', ');
  return { status: 'ready', detail: `${consents.length} active consent${consents.length === 1 ? '' : 's'}; sync remains disabled. Health: ${counts}.` };
}
export const canOpenPrivateMatchReview = (role: string | null): boolean => role === 'coach';

export function engineAdapterUiSummary(payload: any) {
  const replay = Array.isArray(payload?.replay) ? payload.replay : Object.values(payload?.replay || {});
  const ratings = Array.isArray(payload?.ratings) ? payload.ratings : Object.values(payload?.ratings?.records || {});
  const consents = Object.values(payload?.ranked?.consents || {});
  return {
    replay: { configured: replay.some((item: any) => item?.status === 'accepted'), note: `${replay.length} persisted review${replay.length === 1 ? '' : 's'}; acceptance required` },
    shadowRating: { configured: ratings.some((item: any) => item?.status === 'accepted'), note: `${ratings.length} recomputed shadow record${ratings.length === 1 ? '' : 's'}; uncalibrated results stay experimental and never authoritative` },
    rankedConsent: { configured: consents.some((item: any) => !item?.revokedAt), note: 'Offline consent/status only; provider sync remains disabled' },
  };
}

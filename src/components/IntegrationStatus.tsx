import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api';
import { engineAdapterUiSummary } from '../../lib/uiIntegration';

interface Entry { configured: boolean; note?: string; }
type StatusMap = Record<string, Entry>;
export interface RankedAccountView { playerId: string; providerId: string; account: { providerAccountId: string; region: string; platform: string }; revision: number; fingerprint: string; }
export interface RankedConsentView { playerId: string; providerId: string; scopes: string[]; consentVersion: string; grantedAt: string; revokedAt: string | null; revision: number; }
const LABELS: Record<string, string> = { gemini: 'Gemini AI', henrik: 'HenrikDev', grid: 'GRID', discord: 'Discord', vlr: 'VLR.gg', dailySync: 'Daily Sync', replay: 'Replay Evidence', shadowRating: 'Shadow Rating', rankedConsent: 'Ranked Consent' };
const REQUESTED_SCOPES = ['Ranked match history', 'Official rank and RR'];
const asArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value : [];

export function RankedConsentPanel({ role, accounts, consents, onChanged, initialSelection = '' }: { role: string | null; accounts: RankedAccountView[]; consents: RankedConsentView[]; onChanged?: (consent: RankedConsentView) => void; initialSelection?: string }) {
  const [selection, setSelection] = useState(initialSelection); const [confirmed, setConfirmed] = useState(false); const [pending, setPending] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const account = accounts.find(item => `${item.playerId}:${item.providerId}` === selection) || null;
  const consent = account ? consents.find(item => item.playerId === account.playerId && item.providerId === account.providerId) || null : null;
  if (role !== 'player') return <p className="text-[10px] text-gray-500">Ranked consent is granted only by each bound player. Coaches can inspect status but cannot fabricate consent.</p>;
  if (accounts.length === 0) return <p className="text-[10px] text-gray-500">No coach-confirmed ranked account is linked to this player.</p>;
  const update = async (revoke: boolean) => {
    if (!account || (!revoke && !confirmed)) return;
    setPending(true); setError(''); setMessage('');
    try {
      const response = await apiFetch(`/api/engine-adapters/ranked/${revoke ? 'revoke' : 'consent'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId: account.providerId, expectedRevision: consent?.revision || 0, requestId: crypto.randomUUID(), consentVersion: 'moetracker-ranked-consent/1', scopes: ['ranked-match-history', 'official-rank-rr'], ...(!revoke ? { account: account.account, accountRevision: account.revision, accountFingerprint: account.fingerprint } : {}) }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Ranked consent update failed.');
      onChanged?.(result); setConfirmed(false); setMessage(revoke ? 'Ranked consent revoked.' : 'Ranked consent granted. Sync remains disabled.');
    } catch (cause: any) { setError(cause.message || 'Ranked consent update failed.'); } finally { setPending(false); }
  };
  return <div className="border-t border-white/5 pt-2.5 space-y-2">
    <label htmlFor="ranked-account" className="block text-[10px] font-semibold text-gray-300">Choose the exact ranked account</label>
    <select id="ranked-account" value={selection} onChange={event => { setSelection(event.target.value); setConfirmed(false); setError(''); setMessage(''); }} className="w-full rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-[10px]"><option value="">Select an account…</option>{accounts.map(item => <option key={`${item.playerId}:${item.providerId}`} value={`${item.playerId}:${item.providerId}`}>{item.providerId} · {item.account.providerAccountId} · {item.account.region}/{item.account.platform}</option>)}</select>
    {account && <div className="rounded-md border border-white/10 bg-black/10 p-2 text-[10px] text-gray-400"><p><strong className="text-gray-200">Provider:</strong> {account.providerId}</p><p><strong className="text-gray-200">Account:</strong> {account.account.providerAccountId}</p><p><strong className="text-gray-200">Region / platform:</strong> {account.account.region} / {account.account.platform}</p><p className="mt-1 text-gray-200">Requested scopes:</p><ul className="list-disc pl-4">{REQUESTED_SCOPES.map(scope => <li key={scope}>{scope}</li>)}</ul>{(!consent || consent.revokedAt) && <label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>I confirm this exact account and these scopes.</span></label>}</div>}
    {account && <button type="button" disabled={pending || ((!consent || !!consent.revokedAt) && !confirmed)} onClick={() => update(!!consent && !consent.revokedAt)} className="rounded-md border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-gray-300 disabled:opacity-40">{pending ? 'Saving…' : consent && !consent.revokedAt ? 'Revoke ranked consent' : 'Grant ranked consent'}</button>}
    <p aria-live="polite" className="text-[10px] text-emerald-400">{message}</p>{error && <p role="alert" className="text-[10px] text-rose-400">{error}</p>}<p className="text-[10px] text-gray-500">Consent is optional. Provider network sync remains disabled.</p>
  </div>;
}

export function CoachEngineReadiness({ role, engineState }: { role: string | null; engineState: any }) {
  if (role !== 'coach' && role !== 'owner') return null;
  const replay = asArray<any>(engineState?.replay);
  const ratings = Object.values(engineState?.ratings?.records || {}) as any[];
  const configs = Object.values(engineState?.ratings?.configs || {}) as any[];
  const providers = asArray<any>(engineState?.ranked?.providers);
  const accounts = asArray<any>(engineState?.ranked?.accounts);
  const consents = asArray<any>(engineState?.ranked?.consents);
  const states = asArray<any>(engineState?.ranked?.states);
  return <div className="border-t border-white/5 pt-2.5 space-y-2" aria-label="Persisted engine readiness"><p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Coach evidence readiness</p><div className="grid gap-2 sm:grid-cols-3"><ReadinessCard title="Replay" detail={`${replay.length} active · ${replay.filter(item => item.status === 'review-required').length} awaiting review`} /><ReadinessCard title="Shadow rating" detail={`${ratings.length} recomputed · ${ratings.filter(item => item.calibrationStatus === 'calibrated').length} calibrated`} /><ReadinessCard title="Ranked" detail={`${providers.filter(item => item.approvedStatus === 'approved' && item.configured).length} eligible · ${accounts.length} accounts · ${consents.filter(item => !item.revokedAt).length} consented · ${states.filter(item => item.status === 'healthy').length} healthy`} /></div>{ratings.length > 0 && <details><summary className="cursor-pointer text-[10px] text-gray-300">Inspect rating contributions and coverage</summary><div className="mt-2 space-y-2">{ratings.map(record => <div key={record.recordKey} className="rounded-md border border-white/10 bg-black/10 p-2 text-[10px]"><p className="font-semibold text-gray-200">{record.result?.context?.playerId || 'Unknown player'} · {record.status}</p><p className="text-gray-500">Coverage {record.result?.coverage?.ratio === null || record.result?.coverage?.ratio === undefined ? 'unknown' : `${Math.round(record.result.coverage.ratio * 100)}%`} · calibration {record.calibrationStatus || 'unknown'} · authoritative score unavailable</p><ul className="mt-1 text-gray-400">{asArray<any>(record.result?.metrics).map(metric => <li key={metric.metric}>{metric.metric}: {metric.included ? metric.weightedContribution ?? 'computed' : 'excluded'}</li>)}</ul></div>)}</div></details>}{configs.length > 0 && <details><summary className="cursor-pointer text-[10px] text-gray-300">Current versioned weight configuration</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[9px] text-gray-500">{JSON.stringify(configs.map(config => ({ key: config.key, calibrationStatus: config.calibrationStatus, weights: config.formula?.weights })), null, 2)}</pre></details>}</div>;
}

function ReadinessCard({ title, detail }: { title: string; detail: string }) { return <div className="rounded-md border border-white/10 bg-black/10 p-2"><p className="text-[10px] font-semibold text-gray-200">{title}</p><p className="mt-0.5 text-[9px] text-gray-500">{detail}</p></div>; }

export default function IntegrationStatus({ role = null }: { role?: string | null }) {
  const [status, setStatus] = useState<StatusMap | null>(null); const [engineState, setEngineState] = useState<any>(null);
  useEffect(() => { let alive = true; Promise.all([apiFetch('/api/integrations-status'), apiFetch('/api/engine-adapters')]).then(async ([integrations, engines]) => { const engineJson = engines.ok ? await engines.json() : null; if (alive) setEngineState(engineJson); return { ...(integrations.ok ? await integrations.json() : {}), ...(engineJson ? engineAdapterUiSummary(engineJson) : {}) }; }).then(json => { if (alive) setStatus(json); }).catch(() => {}); return () => { alive = false; }; }, []);
  const accounts = useMemo(() => asArray<RankedAccountView>(engineState?.ranked?.accounts), [engineState]); const consents = useMemo(() => asArray<RankedConsentView>(engineState?.ranked?.consents), [engineState]);
  if (!status) return null;
  const entries = Object.entries(status) as [string, Entry][]; const configuredCount = entries.filter(([, value]) => value.configured).length;
  const updateConsent = (next: RankedConsentView) => setEngineState((current: any) => ({ ...current, ranked: { ...current.ranked, consents: [...asArray<RankedConsentView>(current?.ranked?.consents).filter(item => item.playerId !== next.playerId || item.providerId !== next.providerId), next] } }));
  return <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2.5"><div className="flex items-center justify-between"><span className="text-[9px] uppercase font-bold tracking-widest text-gray-500">Evidence & integrations</span><span className="text-[9px] font-mono text-gray-500">{configuredCount}/{entries.length} configured</span></div><div className="grid grid-cols-2 gap-1.5">{entries.map(([key, value]) => <div key={key} className="flex items-center gap-1.5" title={`${value.configured ? 'Configured; runtime success not verified' : 'Unavailable or not configured'} — ${value.note || ''}`}><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${value.configured ? 'bg-emerald-400' : 'bg-gray-600'}`} /><span className={`text-[10px] font-mono truncate ${value.configured ? 'text-gray-300' : 'text-gray-600'}`}>{LABELS[key] || key}</span></div>)}</div><CoachEngineReadiness role={role} engineState={engineState} /><RankedConsentPanel role={role} accounts={accounts} consents={consents} onChanged={updateConsent} /></div>;
}

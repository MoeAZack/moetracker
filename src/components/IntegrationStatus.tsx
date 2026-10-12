import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { engineAdapterUiSummary } from '../../lib/uiIntegration';

interface Entry { configured: boolean; note?: string; }
type StatusMap = Record<string, Entry>;

const LABELS: Record<string, string> = {
  gemini: 'Gemini AI',
  henrik: 'HenrikDev',
  grid: 'GRID',
  discord: 'Discord',
  vlr: 'VLR.gg',
  dailySync: 'Daily Sync',
  replay: 'Replay Evidence',
  shadowRating: 'Shadow Rating',
  rankedConsent: 'Ranked Consent'
};

// Compact integration health panel: shows which external services are wired up.
export default function IntegrationStatus() {
  const [status, setStatus] = useState<StatusMap | null>(null);
  const [engineState, setEngineState] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([apiFetch('/api/integrations-status'), apiFetch('/api/engine-adapters')])
      .then(async ([integrations, engines]) => {
        const engineJson = engines.ok ? await engines.json() : null;
        if (alive) setEngineState(engineJson);
        return { ...(integrations.ok ? await integrations.json() : {}), ...(engineJson ? engineAdapterUiSummary(engineJson) : {}) };
      })
      .then((json) => { if (alive) setStatus(json); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!status) return null;

  const entries = Object.entries(status) as [string, Entry][];
  const configuredCount = entries.filter(([, v]) => v.configured).length;
  const rankedAccount = engineState?.ranked?.accounts?.[0];
  const rankedConsent = engineState?.ranked?.consents?.find((item: any) => item.providerId === rankedAccount?.providerId);
  const updateConsent = async (revoke: boolean) => {
    if (!rankedAccount) return;
    const response = await apiFetch(`/api/engine-adapters/ranked/${revoke ? 'revoke' : 'consent'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        providerId: rankedAccount.providerId, expectedRevision: rankedConsent?.revision || 0,
        requestId: crypto.randomUUID(), consentVersion: 'moetracker-ranked-consent/1', scopes: ['ranked-match-history', 'official-rank-rr'],
      }),
    });
    if (!response.ok) return;
    const next = await response.json();
    setEngineState((current: any) => ({ ...current, ranked: { ...current.ranked, consents: [...(current.ranked.consents || []).filter((item: any) => item.providerId !== next.providerId), next] } }));
  };

  return (
    <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase font-bold tracking-widest text-gray-500">Evidence & integrations</span>
        <span className="text-[9px] font-mono text-gray-500">{configuredCount}/{entries.length} configured</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {entries.map(([key, v]) => (
          <div key={key} className="flex items-center gap-1.5" title={`${v.configured ? 'Configured; runtime success not verified' : 'Unavailable or not configured'} — ${v.note || ''}`}>
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${v.configured ? 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/50' : 'bg-gray-600'}`}
            />
            <span className={`text-[10px] font-mono truncate ${v.configured ? 'text-gray-300' : 'text-gray-600'}`}>
              {LABELS[key] || key}
            </span>
          </div>
        ))}
      </div>
      {rankedAccount && <div className="border-t border-white/5 pt-2.5"><p className="text-[10px] text-gray-500">Ranked access is optional and remains offline until an eligible provider adapter exists.</p><button type="button" onClick={() => updateConsent(!!rankedConsent && !rankedConsent.revokedAt)} className="mt-2 rounded-md border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-gray-300 hover:border-white/20">{rankedConsent && !rankedConsent.revokedAt ? 'Revoke ranked consent' : 'Grant ranked consent'}</button></div>}
    </div>
  );
}

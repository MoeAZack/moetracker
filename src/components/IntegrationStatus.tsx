import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';

interface Entry { configured: boolean; note?: string; }
type StatusMap = Record<string, Entry>;

const LABELS: Record<string, string> = {
  gemini: 'Gemini AI',
  henrik: 'HenrikDev',
  grid: 'GRID',
  discord: 'Discord',
  vlr: 'VLR.gg',
  dailySync: 'Daily Sync'
};

// Compact integration health panel: shows which external services are wired up.
export default function IntegrationStatus() {
  const [status, setStatus] = useState<StatusMap | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/integrations-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (alive && json) setStatus(json); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!status) return null;

  const entries = Object.entries(status) as [string, Entry][];
  const liveCount = entries.filter(([, v]) => v.configured).length;

  return (
    <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase font-bold tracking-widest text-gray-500">Integrations</span>
        <span className="text-[9px] font-mono text-gray-500">{liveCount}/{entries.length} live</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {entries.map(([key, v]) => (
          <div key={key} className="flex items-center gap-1.5" title={`${v.configured ? 'Connected' : 'Not configured'} — ${v.note || ''}`}>
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${v.configured ? 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/50' : 'bg-gray-600'}`}
            />
            <span className={`text-[10px] font-mono truncate ${v.configured ? 'text-gray-300' : 'text-gray-600'}`}>
              {LABELS[key] || key}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

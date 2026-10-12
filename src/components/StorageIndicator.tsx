import { useEffect, useState } from 'react';
import { HardDrive, Info } from 'lucide-react';
import { apiFetch } from '../utils/api';

export default function StorageIndicator({ expanded = false }: { expanded?: boolean }) {
  const [status, setStatus] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; apiFetch('/api/storage/status').then(async response => {
    if (!response.ok) throw new Error('unavailable'); const value = await response.json(); if (live) setStatus(value);
  }).catch(() => { if (live) setFailed(true); }); return () => { live = false; }; }, []);
  const size = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MiB` : `${Math.max(0, value / 1024).toFixed(1)} KiB`;
  const label = !status ? (failed ? 'Unavailable' : 'Measuring…') : status.status === 'tracked-below-cap' ? 'Tracked below cap' : status.status === 'warning' ? 'Near safety cap' : 'Over baseline';
  const percent = status ? Math.max(0, Math.min(100, Number(status.percentOfBaseline || 0))) : 0;
  const content = <div className="storage-detail">
    <p className="text-sm font-semibold">Storage overview</p>
    <p className="mt-1 text-xs leading-relaxed text-slate-400">{status ? 'Measured active MoeTracker payload against a 1 GiB reference baseline.' : failed ? 'Storage measurements are temporarily unavailable.' : 'Measuring storage…'}</p>
    {status && <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Tracked storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-teal-300 to-violet-400 transition-[width] duration-500" style={{ width: `${Math.max(1, percent)}%` }} /></div>}
    <dl className="storage-values">
      <div><dt>Active database payload</dt><dd>{status ? size(status.usedBytes) : 'Unavailable'}</dd></div>
      <div><dt>Tracked room to baseline</dt><dd>{status ? size(status.remainingBytes) : 'Unavailable'}</dd></div>
      <div><dt>Percentage used</dt><dd>{status ? `${percent.toFixed(2)}%` : 'Unavailable'}</dd></div>
      <div><dt>Tracked-data status</dt><dd>{status ? label : 'Not reported'}</dd></div>
      <div><dt>Cloud billing status</dt><dd>{status?.freeTierVerified ? 'Verified free' : 'Verify in Cloud console'}</dd></div>
      <div><dt>Temporary raw replays</dt><dd>{status ? size(status.temporaryRawBytes) : 'Not measured'}</dd></div>
      <div><dt>Retained evidence</dt><dd>{status ? size(status.retainedEvidenceBytes) : 'Not measured'}</dd></div>
    </dl>
    <p className="flex gap-2 text-xs leading-relaxed text-slate-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{status?.note || 'Unknown usage does not mean storage is empty or within a free allowance.'}</p>
  </div>;
  if (expanded) return <section className="storage-panel liquid-panel rounded-xl" aria-label="Storage status">{content}</section>;
  return <details className="storage-indicator">
    <summary className="ui-button flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs" aria-label={`Storage status: ${label}. Show storage details.`}><HardDrive className="h-4 w-4" aria-hidden="true" /><span>Storage</span><span className="storage-status">{label}</span></summary>
    <div className="storage-popover liquid-panel rounded-xl">{content}</div>
  </details>;
}

import { HardDrive, Info } from 'lucide-react';

// Provider usage is not exposed by the current API. Missing telemetry is never zero usage.
export default function StorageIndicator({ expanded = false }: { expanded?: boolean }) {
  const content = <div className="storage-detail">
    <p className="text-sm font-semibold">Storage overview</p>
    <p className="mt-1 text-xs leading-relaxed text-slate-400">Storage measurements are not available from the server yet.</p>
    <dl className="storage-values">
      <div><dt>Used</dt><dd>Unavailable</dd></div>
      <div><dt>Remaining</dt><dd>Unavailable</dd></div>
      <div><dt>Percentage used</dt><dd>Unavailable</dd></div>
      <div><dt>Free-tier status</dt><dd>Not reported</dd></div>
      <div><dt>Temporary raw replays</dt><dd>Not measured</dd></div>
      <div><dt>Retained evidence</dt><dd>Not measured</dd></div>
    </dl>
    <p className="flex gap-2 text-xs leading-relaxed text-slate-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Unknown usage does not mean storage is empty or within a free allowance.</p>
  </div>;
  if (expanded) return <section className="storage-panel liquid-panel rounded-xl" aria-label="Storage status">{content}</section>;
  return <details className="storage-indicator">
    <summary className="ui-button flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs" aria-label="Storage status: usage unavailable. Show storage details."><HardDrive className="h-4 w-4" aria-hidden="true" /><span>Storage</span><span className="storage-status">Unavailable</span></summary>
    <div className="storage-popover liquid-panel rounded-xl">{content}</div>
  </details>;
}

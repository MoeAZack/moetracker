import React from 'react';
import type { MatchRosterContext, TrackerData } from '../types';

interface Props {
  data: TrackerData;
  value: MatchRosterContext;
  onChange: (value: MatchRosterContext) => void;
  allowUnclassified?: boolean;
}

export default function RosterContextSelector({ data, value, onChange, allowUnclassified = false }: Props) {
  const batches = (data.tryoutBatches || []).filter(batch => batch.status === 'active' || batch.id === value.tryoutBatchId);
  const defaultBatchId = batches.find(batch => batch.id === data.settings.activeTryoutBatchId)?.id || batches.find(batch => batch.status === 'active')?.id || '';
  const needsBatch = value.kind === 'tryout' || value.kind === 'mixed';
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5">
      <label className="space-y-1 text-[10px] uppercase font-black text-gray-400 font-mono">
        Historical lineup context
        <select
          value={value.kind}
          onChange={event => {
            const kind = event.target.value as MatchRosterContext['kind'];
            onChange(kind === 'tryout' ? { kind, tryoutBatchId: value.tryoutBatchId || defaultBatchId } : kind === 'mixed' ? { kind, tryoutBatchId: value.tryoutBatchId } : { kind });
          }}
          className="w-full p-2 bg-black/30 rounded border border-white/10 text-xs text-white"
        >
          <option value="core">Core lineup</option>
          <option value="tryout">Tryout lineup</option>
          <option value="mixed">Mixed lineup / stand-in</option>
          {allowUnclassified && <option value="unclassified">Unclassified legacy/import</option>}
        </select>
      </label>
      {needsBatch && (
        <label className="space-y-1 text-[10px] uppercase font-black text-gray-400 font-mono">
          Tryout batch {value.kind === 'mixed' ? '(optional unless a tryout appears)' : ''}
          <select
            value={value.tryoutBatchId || ''}
            required={value.kind === 'tryout'}
            onChange={event => onChange({ ...value, tryoutBatchId: event.target.value || undefined })}
            className="w-full p-2 bg-black/30 rounded border border-white/10 text-xs text-white"
          >
            <option value="">No batch selected</option>
            {batches.map(batch => <option key={batch.id} value={batch.id}>{batch.name} ({batch.status})</option>)}
          </select>
        </label>
      )}
      <p className="md:col-span-2 text-[10px] normal-case font-normal text-gray-400">
        Saved as historical context. Later promotion or membership changes do not rewrite past appearances.
      </p>
    </div>
  );
}

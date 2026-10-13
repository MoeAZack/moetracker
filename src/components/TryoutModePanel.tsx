import React, { useState } from 'react';
import { Archive, ChevronDown } from 'lucide-react';
import type { RosterPlayer, TryoutBatch } from '../types';

interface Props {
  enabled: boolean;
  activeBatchId: string | null;
  batches: TryoutBatch[];
  players: RosterPlayer[];
  corePlayerIds: Set<string>;
  busy: boolean;
  mutate: (route: string, body: unknown) => Promise<boolean>;
}

export default function TryoutModePanel({ enabled, activeBatchId, batches, players, corePlayerIds, busy, mutate }: Props) {
  const [candidateId, setCandidateId] = useState('');
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const active = enabled ? batches.find(batch => batch.id === activeBatchId && batch.status === 'active') : undefined;
  const historical = batches.filter(batch => batch.id !== active?.id);
  const name = (playerId: string) => players.find(player => player.id === playerId)?.displayName || 'Unknown player';
  const savedAliases = (batch: TryoutBatch, playerId: string) => ((batch as any).aliases || []).filter((item: any) => item.playerId === playerId);

  const saveAlias = async (playerId: string) => {
    if (!active) return;
    const alias = (aliases[playerId] || '').trim();
    if (alias && await mutate('/api/roster/tryouts/aliases', { batchId: active.id, playerId, alias })) setAliases(current => ({ ...current, [playerId]: '' }));
  };

  return <div className="space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
    <div><h4 className="text-sm font-black uppercase tracking-wide">Tryout workspace</h4><p className="mt-1 text-xs text-gray-400">Each phase keeps its candidate aliases and history. Core membership is unchanged.</p></div>
    {!enabled && <p className="rounded-lg border border-white/10 bg-black/15 p-3 text-xs text-gray-400">Tryouts mode is off. The last phase is archived, not deleted. Turn it on in Settings to start a fresh active phase.</p>}
    {enabled && !active && <p role="alert" className="text-xs text-amber-300">Tryouts mode is on, but no active phase is available. Turn the mode off and on again to create a fresh phase.</p>}
    {active && <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-black/10 p-3">
      <div><p className="font-bold">{active.name}</p><p className="text-[10px] uppercase tracking-wider text-cyan-300">Active phase · {active.candidatePlayerIds.length} candidates</p></div>
      {active.candidatePlayerIds.length === 0 && <p className="text-xs text-gray-400">No candidates in this phase yet.</p>}
      {active.candidatePlayerIds.map(playerId => <div key={playerId} className="grid gap-2 rounded-lg bg-black/15 p-2 md:grid-cols-[minmax(8rem,1fr)_minmax(10rem,1fr)_auto_auto] md:items-center">
        <div><span className="text-sm font-bold">{name(playerId)}</span><div className="mt-1 flex flex-wrap gap-1">{savedAliases(active, playerId).map((entry: any) => <span key={entry.alias.toLocaleLowerCase()} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-100">{entry.alias}<button type="button" aria-label={`Remove alias ${entry.alias} from ${name(playerId)}`} disabled={busy} onClick={() => mutate('/api/roster/tryouts/aliases/remove', { batchId: active.id, playerId, alias: entry.alias })} className="ml-1 text-rose-300">×</button></span>)}</div></div>
        <input aria-label={`Add tryout alias for ${name(playerId)}`} value={aliases[playerId] || ''} onChange={event => setAliases(current => ({ ...current, [playerId]: event.target.value }))} maxLength={100} placeholder="Add another in-game alias" className="ui-field min-h-10 px-3 text-sm" />
        <button type="button" disabled={busy || !aliases[playerId]?.trim()} onClick={() => saveAlias(playerId)} className="ui-button min-h-10 px-3 text-xs disabled:opacity-50">Add alias</button>
        <button type="button" disabled={busy || corePlayerIds.has(playerId)} onClick={() => mutate('/api/roster/tryouts/promote', { batchId: active.id, playerId })} className="ui-button ui-button-primary min-h-10 px-3 text-xs disabled:opacity-50">{corePlayerIds.has(playerId) ? 'Already core' : 'Promote to core'}</button>
      </div>)}
      <div className="flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row">
        <select aria-label={`Candidate for ${active.name}`} value={candidateId} onChange={event => setCandidateId(event.target.value)} className="ui-field min-h-11 flex-1 px-3">
          <option value="">Select existing player identity</option>
          {players.filter(player => !active.candidatePlayerIds.includes(player.id)).map(player => <option key={player.id} value={player.id}>{player.displayName}</option>)}
        </select>
        <button type="button" disabled={busy || !candidateId} onClick={async () => { if (await mutate('/api/roster/tryouts/candidates', { batchId: active.id, playerId: candidateId })) setCandidateId(''); }} className="ui-button ui-button-primary min-h-11 px-4 text-xs disabled:opacity-50">Add candidate</button>
      </div>
    </div>}
    <details className="rounded-xl border border-white/10 bg-black/10 p-3"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold uppercase tracking-wide"><ChevronDown className="h-4 w-4" />Historical phases ({historical.length})</summary>
      <div className="mt-3 space-y-2">{historical.length === 0 ? <p className="text-xs text-gray-500">No historical phases yet.</p> : historical.map(batch => <div key={batch.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-black/15 p-2"><div><p className="text-sm font-bold">{batch.name}</p><p className="text-[10px] text-gray-400">{batch.status} · {batch.candidatePlayerIds.length} candidates</p></div>{batch.status === 'archived' && <span className="flex items-center gap-1 text-[10px] text-gray-500"><Archive className="h-3 w-3" />Archived safely</span>}</div>)}</div>
    </details>
  </div>;
}

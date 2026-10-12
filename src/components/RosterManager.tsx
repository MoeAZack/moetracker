import React, { useMemo, useState } from 'react';
import { AlertTriangle, Archive, RotateCcw, UserPlus, Users } from 'lucide-react';
import type { TrackerData } from '../types';
import { apiFetch } from '../utils/api';

interface Props {
  data: TrackerData;
  theme: any;
  onRefresh: () => Promise<void>;
}

export default function RosterManager({ data, theme, onRefresh }: Props) {
  const players = data.rosterPlayers || [];
  const memberships = data.coreMemberships || [];
  const batches = data.tryoutBatches || [];
  const seasonArchives = data.seasonArchives || [];
  const activeCore = useMemo(
    () => new Set(memberships.filter(membership => !membership.endedAt).map(membership => membership.playerId)),
    [memberships],
  );
  const [displayName, setDisplayName] = useState('');
  const [batchName, setBatchName] = useState('');
  const [candidateSelections, setCandidateSelections] = useState<Record<string, string>>({});
  const [replacementNames, setReplacementNames] = useState<Record<string, string>>({});
  const [archiveName, setArchiveName] = useState('');
  const [newSeasonName, setNewSeasonName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playerName = (id: string) => players.find(player => player.id === id)?.displayName || 'Unknown player';

  const mutate = async (route: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Roster update failed.');
      await onRefresh();
      return true;
    } catch (err: any) {
      setError(err?.message || 'Roster update failed.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createPlayer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await mutate('/api/roster/players', { displayName })) setDisplayName('');
  };

  const createBatch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await mutate('/api/roster/tryouts', { name: batchName })) setBatchName('');
  };

  const archiveSeason = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!window.confirm('Archive the complete active roster season and start a clean one? The snapshot can be restored later.')) return;
    if (await mutate('/api/roster/seasons/archive-reset', { archiveName, newSeasonName })) {
      setArchiveName('');
      setNewSeasonName('');
    }
  };

  const restoreSeason = async (archiveId: string, name: string) => {
    if (!window.confirm(`Restore season archive "${name}"? The active season must be empty.`)) return;
    await mutate('/api/roster/seasons/restore', { archiveId });
  };

  return (
    <section className={`rounded-2xl border ${theme.border} ${theme.cardBg} p-6 space-y-6`}>
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-[#ff4655]" />
        <h3 className="text-lg font-black tracking-tight uppercase">Roster & Tryout Batches</h3>
      </div>

      <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          Confirmed manual and live lineups save stable identities and core, tryout, or stand-in appearances. Archiving
          a batch hides only explicitly linked tryout history from read-only analytics by default; it never deletes match
          statistics. Legacy and unresolved import rows stay visible as unclassified until a coach confirms them.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <div className="p-4 rounded-xl border border-rose-500/25 bg-rose-500/5 space-y-4">
        <div>
          <h4 className="font-black uppercase text-sm">Full roster-season archive</h4>
          <p className="text-xs text-gray-400 mt-1">
            Archives identities, memberships, tryout batches, schedule/goals, matches, statistics, SoloQ, rounds,
            vetoes, linked strategy runs, VOD reviews, and Riot IDs in one snapshot, then starts an empty active season.
          </p>
        </div>
        <form onSubmit={archiveSeason} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
          <input
            aria-label="Season archive name"
            value={archiveName}
            onChange={event => setArchiveName(event.target.value)}
            maxLength={100}
            required
            placeholder="Archive name, e.g. 2026 Spring"
            className="p-2 rounded bg-black/25 border border-white/10"
          />
          <input
            aria-label="New active season name"
            value={newSeasonName}
            onChange={event => setNewSeasonName(event.target.value)}
            maxLength={100}
            required
            placeholder="New season name"
            className="p-2 rounded bg-black/25 border border-white/10"
          />
          <button disabled={busy} className="flex items-center justify-center gap-1 px-3 py-2 rounded bg-rose-600 text-xs font-bold disabled:opacity-50">
            <Archive className="w-3.5 h-3.5" /> Archive & reset
          </button>
        </form>
        <div className="space-y-2">
          {seasonArchives.length === 0 && <p className="text-xs text-gray-500">No full-season archives yet.</p>}
          {seasonArchives.map(archive => (
            <div key={archive.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded bg-black/15">
              <div>
                <p className="font-bold text-sm">{archive.name}</p>
                <p className="text-[10px] text-gray-400">
                  {archive.seasonName} · {archive.rosterPlayers.length || archive.legacyPlayers.length} identities · {archive.matches.length} matches · {archive.playerStats.length} stat rows
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => restoreSeason(archive.id, archive.name)}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-600/70 text-xs font-bold disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore into empty active season
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-3 p-4 rounded-xl border border-white/10 bg-black/10">
          <h4 className="font-black uppercase text-sm">Player identities & core</h4>
          <form onSubmit={createPlayer} className="flex gap-2">
            <input
              aria-label="New player display name"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              maxLength={100}
              required
              placeholder="Player display name"
              className="flex-1 p-2 rounded bg-black/25 border border-white/10"
            />
            <button disabled={busy} className="flex items-center gap-1 px-3 py-2 rounded bg-[#ff4655] text-white text-xs font-bold disabled:opacity-50">
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              Add player
            </button>
          </form>
          {players.length === 0 ? (
            <p className="text-xs text-gray-400">No player identities yet. Core membership starts empty.</p>
          ) : players.map(player => {
            const isCore = activeCore.has(player.id);
            return (
              <div key={player.id} className="flex items-center justify-between gap-3 p-2 rounded bg-black/15">
                <div>
                  <p className="font-bold">{player.displayName}</p>
                  <p className="text-[10px] text-gray-400 font-mono">{player.id}</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => mutate(isCore ? '/api/roster/core/remove' : '/api/roster/core/add', { playerId: player.id })}
                  className={`px-3 py-1.5 rounded text-xs font-bold disabled:opacity-50 ${isCore ? 'bg-gray-600/40' : 'bg-emerald-600/70'}`}
                >
                  {isCore ? 'End core membership' : 'Add to core'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="space-y-3 p-4 rounded-xl border border-white/10 bg-black/10">
          <h4 className="font-black uppercase text-sm">Named tryout batches</h4>
          <form onSubmit={createBatch} className="flex gap-2">
            <input
              aria-label="New tryout batch name"
              value={batchName}
              onChange={event => setBatchName(event.target.value)}
              maxLength={100}
              required
              placeholder="Batch name"
              className="flex-1 p-2 rounded bg-black/25 border border-white/10"
            />
            <button disabled={busy} className="px-3 py-2 rounded bg-cyan-600 text-white text-xs font-bold disabled:opacity-50">
              Create
            </button>
          </form>
          {batches.length === 0 && <p className="text-xs text-gray-400">No tryout batches yet.</p>}
        </div>
      </div>

      {batches.map(batch => (
        <div key={batch.id} className="p-4 rounded-xl border border-white/10 bg-black/10 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="font-black">{batch.name}</h4>
              <p className="text-[10px] uppercase tracking-wider text-gray-400">{batch.status} · {batch.candidatePlayerIds.length} candidates</p>
            </div>
            {batch.status === 'archived' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => mutate('/api/roster/tryouts/restore', { batchId: batch.id })}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-indigo-600/70 text-xs font-bold disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore same batch
              </button>
            )}
          </div>

          <div className="space-y-2">
            {batch.candidatePlayerIds.length === 0 ? (
              <p className="text-xs text-gray-400">No candidates in this batch.</p>
            ) : batch.candidatePlayerIds.map(playerId => (
              <div key={playerId} className="flex items-center justify-between gap-2 p-2 rounded bg-black/15">
                <span className="font-bold text-sm">{playerName(playerId)}</span>
                {batch.status === 'active' && (
                  <button
                    type="button"
                    disabled={busy || activeCore.has(playerId)}
                    onClick={() => mutate('/api/roster/tryouts/promote', { batchId: batch.id, playerId })}
                    className="px-3 py-1 rounded bg-emerald-600/70 text-xs font-bold disabled:opacity-50"
                  >
                    {activeCore.has(playerId) ? 'Already core' : 'Promote to core'}
                  </button>
                )}
              </div>
            ))}
          </div>

          {batch.status === 'active' && (
            <>
              <div className="flex gap-2">
                <select
                  aria-label={`Candidate for ${batch.name}`}
                  value={candidateSelections[batch.id] || ''}
                  onChange={event => setCandidateSelections(current => ({ ...current, [batch.id]: event.target.value }))}
                  className="flex-1 p-2 rounded bg-black/25 border border-white/10"
                >
                  <option value="">Select existing player identity</option>
                  {players.filter(player => !batch.candidatePlayerIds.includes(player.id)).map(player => (
                    <option key={player.id} value={player.id}>{player.displayName}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !candidateSelections[batch.id]}
                  onClick={() => mutate('/api/roster/tryouts/candidates', { batchId: batch.id, playerId: candidateSelections[batch.id] })}
                  className="px-3 py-2 rounded bg-cyan-600/70 text-xs font-bold disabled:opacity-50"
                >
                  Add candidate
                </button>
              </div>
              <div className="flex flex-col md:flex-row gap-2 pt-2 border-t border-white/10">
                <input
                  aria-label={`Replacement batch name for ${batch.name}`}
                  value={replacementNames[batch.id] || ''}
                  onChange={event => setReplacementNames(current => ({ ...current, [batch.id]: event.target.value }))}
                  maxLength={100}
                  placeholder="New empty batch name"
                  className="flex-1 p-2 rounded bg-black/25 border border-white/10"
                />
                <button
                  type="button"
                  disabled={busy || !replacementNames[batch.id]?.trim()}
                  onClick={() => mutate('/api/roster/tryouts/archive-reset', {
                    batchId: batch.id,
                    newBatchName: replacementNames[batch.id],
                  })}
                  className="flex items-center justify-center gap-1 px-3 py-2 rounded bg-amber-600/70 text-xs font-bold disabled:opacity-50"
                  title="Archives this candidate list and creates an empty batch. Match statistics are unchanged."
                >
                  <Archive className="w-3.5 h-3.5" /> Archive list + create empty batch
                </button>
              </div>
              <p className="text-[10px] text-amber-300">This action changes candidate-list records only. Existing matches and statistics stay unchanged.</p>
            </>
          )}
        </div>
      ))}
    </section>
  );
}

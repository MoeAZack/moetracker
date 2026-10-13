import React, { useMemo, useState } from 'react';
import { AlertTriangle, Archive, RotateCcw, Trash2, UserPlus, Users } from 'lucide-react';
import type { TrackerData } from '../types';
import { apiFetch } from '../utils/api';
import PlayerPasswordForm from './PlayerPasswordForm';
import TryoutModePanel from './TryoutModePanel';

interface Props {
  data: TrackerData;
  theme: any;
  onRefresh: () => Promise<void>;
}

export default function RosterManager({ data, theme, onRefresh }: Props) {
  const players = (data.rosterPlayers || []).filter(player => !player.retiredAt);
  const memberships = data.coreMemberships || [];
  const batches = data.tryoutBatches || [];
  const seasonArchives = data.seasonArchives || [];
  const activeCore = useMemo(
    () => new Set(memberships.filter(membership => !membership.endedAt).map(membership => membership.playerId)),
    [memberships],
  );
  const [displayName, setDisplayName] = useState('');
  const [newPlayerPassword, setNewPlayerPassword] = useState('');
  const [pendingPasswordPlayer, setPendingPasswordPlayer] = useState<{ id: string; displayName: string } | null>(null);
  const [freshLogin, setFreshLogin] = useState<{ displayName: string; password: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'fallback' | null>(null);
  const [archiveName, setArchiveName] = useState('');
  const [newSeasonName, setNewSeasonName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setBusy(true); setError(null);
    try {
      let player = pendingPasswordPlayer;
      if (!player) {
        const response = await apiFetch('/api/roster/players', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
        const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Player creation failed.');
        player = { id: result.id, displayName: result.displayName || displayName.trim() };
        setPendingPasswordPlayer(player);
        await onRefresh();
      }
      if (newPlayerPassword) {
        const response = await apiFetch('/api/player-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: player.id, password: newPlayerPassword }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) { setPendingPasswordPlayer(player); throw new Error(`${result.error || 'Password setup failed.'} The player was created; retry password setup without adding a duplicate.`); }
        setFreshLogin({ displayName: player.displayName, password: newPlayerPassword });
      }
      setPendingPasswordPlayer(null); setDisplayName(''); setNewPlayerPassword('');
    } catch (err: any) { setError(err?.message || 'Player creation failed.'); }
    finally { setBusy(false); }
  };

  const copyFreshLogin = async () => {
    if (!freshLogin) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(`Player: ${freshLogin.displayName}\nPassword: ${freshLogin.password}`);
      setCopyStatus('copied');
    } catch { setCopyStatus('fallback'); }
  };

  const removePlayer = async (playerId: string, name: string) => {
    if (!window.confirm(`Remove “${name}” from the active roster? Their historical match evidence will be preserved, while active membership, access keys, and collection devices are revoked.`)) return;
    await mutate('/api/roster/players/remove', { playerId });
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
  const activeTryoutBatchId = (data.settings as any)?.activeTryoutBatchId || null;
  const tryoutsMode = Boolean((data.settings as any)?.tryoutsMode);
  const activeCandidateIds = new Set(batches.filter(batch => batch.status === 'active' && batch.id === activeTryoutBatchId).flatMap(batch => batch.candidatePlayerIds));
  const archivedCandidateIds = new Set(batches.filter(batch => batch.status === 'archived').flatMap(batch => batch.candidatePlayerIds));
  const visibleRosterPlayers = players.filter(player => activeCore.has(player.id) || activeCandidateIds.has(player.id) || !archivedCandidateIds.has(player.id));

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
          <form onSubmit={createPlayer} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              aria-label="New player display name"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              maxLength={100}
              required
              placeholder="Player display name"
              className="flex-1 p-2 rounded bg-black/25 border border-white/10"
            />
            <div><input aria-label="Optional player password" type="password" minLength={3} value={newPlayerPassword} onChange={event => setNewPlayerPassword(event.target.value)} placeholder="Password (optional, e.g. xyz)" autoComplete="new-password" className="w-full p-2 rounded bg-black/25 border border-white/10" /><p className="mt-1 text-[10px] text-gray-500">Use a longer password for better protection.</p></div>
            <button disabled={busy} className="flex items-center gap-1 px-3 py-2 rounded bg-[#ff4655] text-white text-xs font-bold disabled:opacity-50">
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              {pendingPasswordPlayer ? 'Retry password' : 'Add player'}
            </button>
          </form>
          {pendingPasswordPlayer && <p className="text-xs text-amber-300">{pendingPasswordPlayer.displayName} already exists. This button will retry password setup only.</p>}
          {freshLogin && <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-2"><div className="flex justify-between gap-2"><span>Login: <strong>{freshLogin.displayName}</strong> / <code>{freshLogin.password}</code></span><button type="button" onClick={() => { setFreshLogin(null); setCopyStatus(null); }}>Dismiss</button></div><button type="button" className="ui-button px-2 py-1" onClick={copyFreshLogin}>{copyStatus === 'copied' ? 'Copied' : 'Copy login details'}</button>{copyStatus === 'fallback' && <label className="block text-amber-200">Copy unavailable. Select these login details:<textarea readOnly className="mt-1 w-full rounded bg-black/25 p-2" value={`Player: ${freshLogin.displayName}\nPassword: ${freshLogin.password}`} /></label>}</div>}
          {visibleRosterPlayers.length === 0 ? (
            <p className="text-xs text-gray-400">No player identities yet. Core membership starts empty.</p>
          ) : visibleRosterPlayers.map(player => {
            const isCore = activeCore.has(player.id);
            return (
              <div key={player.id} className="flex flex-wrap items-center justify-between gap-3 p-2 rounded bg-black/15">
                <div>
                  <p className="font-bold">{player.displayName}</p>
                  <p className="text-xs text-gray-400">{isCore ? 'Core player' : 'Squad player'}</p>
                </div>
                <PlayerPasswordForm playerId={player.id} playerName={player.displayName} />
                <div className="flex flex-wrap justify-end gap-2"><button
                    type="button"
                    disabled={busy}
                    onClick={() => mutate(isCore ? '/api/roster/core/remove' : '/api/roster/core/add', { playerId: player.id })}
                    className={`px-3 py-1.5 rounded text-xs font-bold disabled:opacity-50 ${isCore ? 'bg-gray-600/40' : 'bg-emerald-600/70'}`}
                  >
                    {isCore ? 'End core membership' : 'Add to core'}
                  </button><button type="button" disabled={busy} onClick={() => void removePlayer(player.id, player.displayName)} className="flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Remove</button></div>
              </div>
            );
          })}
        </div>

        <TryoutModePanel enabled={tryoutsMode} activeBatchId={activeTryoutBatchId} batches={batches} players={players} corePlayerIds={activeCore} busy={busy} mutate={mutate} />
      </div>
    </section>
  );
}

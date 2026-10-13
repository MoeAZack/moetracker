import React, { useMemo } from 'react';
import { ChevronRight, Film, ShieldCheck } from 'lucide-react';
import type { Match, PlayerStats, TrackerData } from '../types';

interface Props {
  data: TrackerData;
  theme: any;
  title?: string;
  description?: string;
  limit?: number;
  map?: string;
}

const cairo = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium' });
const date = (value: string) => {
  const parsed = new Date(/T/.test(value) ? value : `${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value || 'Date unknown' : cairo.format(parsed);
};
const score = (match: Match) => {
  if (match.ourScore !== null && match.ourScore !== undefined && match.theirScore !== null && match.theirScore !== undefined) return `${match.ourScore}–${match.theirScore}`;
  if ([match.attW, match.attL, match.defW, match.defL].every(value => typeof value === 'number')) return `${Number(match.attW) + Number(match.defW)}–${Number(match.attL) + Number(match.defL)}`;
  return '—';
};
const known = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value);

export function replayBackedMatches(data: TrackerData) {
  const replayMatchIds = new Set((data.playerStats || []).filter(row => row.sourceMetadata?.provider === 'vrfkit').map(row => row.matchId));
  return (data.matches || []).filter(match => match.sourceMetadata?.provider === 'vrfkit' || replayMatchIds.has(match.id));
}

export default function ReplayMatchLog({ data, theme, title = 'Accepted replay match log', description = 'The same reviewed scoreboard and round evidence used throughout MoeTracker.', limit = 6, map }: Props) {
  const rows = useMemo(() => replayBackedMatches(data)
    .filter(match => !map || match.map === map)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, limit)
    .map(match => ({
      match,
      stats: (data.playerStats || []).filter(row => row.matchId === match.id),
      rounds: (data.rounds || []).filter(row => row.matchId === match.id),
    })), [data.matches, data.playerStats, data.rounds, limit, map]);

  return <section className="liquid-panel overflow-hidden rounded-2xl" aria-label={title}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold"><Film className="h-4 w-4 text-cyan-300" aria-hidden="true" />{title}</p>
        <p className="mt-1 text-xs text-slate-400">{description}</p>
      </div>
      <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-200">{rows.length} replay-backed</span>
    </div>
    <div className="divide-y divide-white/8">
      {rows.map(({ match, stats, rounds }) => {
        const buyRounds = rounds.filter(round => String(round.buy || '').trim()).length;
        return <details key={match.id} className="group">
          <summary className="grid cursor-pointer list-none gap-3 px-4 py-3.5 transition hover:bg-cyan-300/[0.045] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:items-center sm:px-5">
            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-100">{match.map || 'Map pending'} · {match.opponent || 'Opponent pending'}</span><span className="mt-1 block text-[11px] text-slate-500">{date(match.date)} · {match.type || 'Practice'}</span></span>
            <span className="flex flex-wrap gap-1.5 text-[10px]"><EvidenceBadge ready={stats.length > 0}>{stats.length ? `${stats.length} players` : 'Scoreboard missing'}</EvidenceBadge><EvidenceBadge ready={rounds.length > 0}>{rounds.length ? `${rounds.length} rounds` : 'Rounds missing'}</EvidenceBadge><EvidenceBadge ready={buyRounds > 0}>{buyRounds ? `${buyRounds} buys` : 'Economy unknown'}</EvidenceBadge></span>
            <span className="flex items-center justify-between gap-3 sm:justify-end"><span className="font-mono text-lg font-bold text-white">{score(match)}</span><ChevronRight className="h-4 w-4 text-slate-500 transition group-open:rotate-90" aria-hidden="true" /></span>
          </summary>
          <div className="border-t border-white/8 bg-slate-950/35 px-3 py-3 sm:px-5">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" />Coach-accepted replay evidence</div>
            <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-2 py-2">Player</th><th className="px-2 py-2">Agent</th><th className="px-2 py-2 text-center">K / D / A</th><th className="px-2 py-2 text-center">FB / FD</th><th className="px-2 py-2 text-center">Plants / Defuses</th><th className="px-2 py-2 text-center">HS%</th><th className="px-2 py-2 text-center">Orbs</th><th className="px-2 py-2 text-center">ADR</th></tr></thead><tbody className="divide-y divide-white/5">{stats.map((player: PlayerStats) => <tr key={player.id} className="hover:bg-white/[0.035]"><td className="px-2 py-2.5 font-semibold text-slate-100">{player.displayNameSnapshot || player.player}</td><td className="px-2 py-2.5 text-slate-400">{player.agent || 'Unknown'}</td><td className="px-2 py-2.5 text-center font-mono">{known(player.kills)} / {known(player.deaths)} / {known(player.assists)}</td><td className="px-2 py-2.5 text-center font-mono text-rose-300">{known(player.fk)} / {known(player.fd)}</td><td className="px-2 py-2.5 text-center font-mono text-violet-300">{known(player.plants)} / {known(player.defuses)}</td><td className="px-2 py-2.5 text-center text-amber-300">{player.hs === null || player.hs === undefined ? '—' : `${player.hs}%`}</td><td className="px-2 py-2.5 text-center text-cyan-300">{known(player.orbPoints)}</td><td className="px-2 py-2.5 text-center">{player.adr === null || player.adr === undefined ? '—' : player.adr.toFixed(1)}</td></tr>)}</tbody></table>{!stats.length && <p className="py-4 text-sm text-slate-500">No accepted player rows are attached to this match.</p>}</div>
          </div>
        </details>;
      })}
      {!rows.length && <p className="px-5 py-8 text-center text-sm text-slate-500">No coach-accepted replay matches yet.</p>}
    </div>
  </section>;
}

function EvidenceBadge({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return <span className={`rounded-full border px-2 py-1 ${ready ? 'border-teal-400/20 bg-teal-400/10 text-teal-200' : 'border-slate-700 bg-slate-900/50 text-slate-500'}`}>{children}</span>;
}

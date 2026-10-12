import React, { useMemo } from 'react';
import { TrackerData } from '../types';
import { Activity, ShieldAlert, Users } from 'lucide-react';
import { shadowRatingReadiness, rankedIntegrationReadiness } from '../../lib/uiIntegration';

interface Props { data: TrackerData; theme: any; onSyncSoloQ: (player: string) => Promise<any>; }

export default function PlayerSoloTracker({ data }: Props) {
  const roster = useMemo(() => (data.settings.players || []).map(player => {
    const rows = (data.playerStats || []).filter(row => row.player === player);
    const knownKills = rows.filter(row => row.kills !== null && row.kills !== undefined);
    const knownDeaths = rows.filter(row => row.deaths !== null && row.deaths !== undefined);
    const kills = knownKills.reduce((sum, row) => sum + Number(row.kills), 0);
    const deaths = knownDeaths.reduce((sum, row) => sum + Number(row.deaths), 0);
    return { player, maps: rows.length, kd: knownKills.length && knownDeaths.length && deaths > 0 ? (kills / deaths).toFixed(2) : null, coverage: `${Math.min(knownKills.length, knownDeaths.length)}/${rows.length}` };
  }), [data.playerStats, data.settings.players]);
  const shadow = shadowRatingReadiness();
  const ranked = rankedIntegrationReadiness();

  return <div className="space-y-6">
    <header><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Roster evidence</p><h2 className="mt-1 text-2xl font-semibold">Player overview</h2><p className="mt-1 text-sm text-gray-400">Observed statistics only. Missing values are not replaced with average scores.</p></header>
    <div className="grid gap-4 lg:grid-cols-2">
      <Readiness icon={ShieldAlert} title="MoeTracker shadow performance score" badge="Experimental · unavailable" detail={`${shadow.detail} Deferred adapter: persist validated PlayerRatingInput, RatingBaseline and formula version, then render engine coverage and per-metric contributions.`} />
      <Readiness icon={Activity} title="Ranked consent & health" badge="Inactive" detail={`${ranked.detail} Manual ranked entries remain available; no network sync is attempted.`} />
    </div>
    <section className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.035]" aria-labelledby="roster-observed-title"><div className="flex items-center gap-2 border-b border-white/10 px-5 py-4"><Users className="h-4 w-4 text-gray-500" aria-hidden="true" /><h3 id="roster-observed-title" className="text-sm font-semibold">Observed roster statistics</h3></div><div className="overflow-x-auto"><table className="min-w-[520px] w-full text-left text-sm"><thead className="text-[10px] uppercase tracking-wider text-gray-500"><tr><th className="px-5 py-3">Player</th><th className="px-5 py-3">Recorded maps</th><th className="px-5 py-3">Observed K/D</th><th className="px-5 py-3">K/D coverage</th></tr></thead><tbody className="divide-y divide-white/[0.07]">{roster.map(row => <tr key={row.player}><td className="px-5 py-3 font-semibold">{row.player}</td><td className="px-5 py-3 text-gray-400">{row.maps}</td><td className="px-5 py-3 font-mono">{row.kd ?? 'Unknown'}</td><td className="px-5 py-3 text-gray-500">{row.coverage}</td></tr>)}</tbody></table>{!roster.length && <p className="p-8 text-center text-sm text-gray-500">No roster players configured.</p>}</div></section>
  </div>;
}

function Readiness({ icon: Icon, title, badge, detail }: { icon: React.ComponentType<any>; title: string; badge: string; detail: string }) { return <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-amber-400" aria-hidden="true" />{title}</h3><span className="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[9px] uppercase tracking-wider text-amber-300">{badge}</span></div><p className="mt-3 text-xs leading-relaxed text-gray-500">{detail}</p></section>; }

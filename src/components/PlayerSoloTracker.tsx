import React, { useMemo } from 'react';
import { TrackerData } from '../types';
import { Activity, ShieldAlert, Users } from 'lucide-react';
import { aggregateObservedPlayerKd, shadowRatingReadiness, rankedIntegrationReadiness } from '../../lib/uiIntegration';

interface Props { data: TrackerData; theme: any; onSyncSoloQ: (player: string) => Promise<any>; }

export default function PlayerSoloTracker({ data, theme }: Props) {
  const roster = useMemo(() => aggregateObservedPlayerKd(data.playerStats || []), [data.playerStats]);
  const light = data.settings.theme === 'daylight';
  const surface = `${theme.cardBg} ${theme.border}`;
  const muted = light ? 'text-slate-600' : 'text-gray-400';
  const shadow = shadowRatingReadiness();
  const ranked = rankedIntegrationReadiness();

  return <div className="space-y-6">
    <header><p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${muted}`}>Roster evidence</p><h2 className="mt-1 text-2xl font-semibold">Player overview</h2><p className={`mt-1 text-sm ${muted}`}>Observed statistics only. Missing values are not replaced with average scores.</p></header>
    <div className="grid gap-4 lg:grid-cols-2">
      <Readiness surface={surface} muted={muted} icon={ShieldAlert} title="MoeTracker shadow performance score" badge="Experimental · unavailable" detail={`${shadow.detail} Deferred adapter: persist validated PlayerRatingInput, RatingBaseline and formula version, then render engine coverage and per-metric contributions.`} />
      <Readiness surface={surface} muted={muted} icon={Activity} title="Ranked consent & health" badge="Inactive" detail={`${ranked.detail} Manual ranked entries remain available; no network sync is attempted.`} />
    </div>
    <section className={`overflow-hidden rounded-xl border ${surface}`} aria-labelledby="roster-observed-title"><div className={`flex items-center gap-2 border-b px-5 py-4 ${theme.border}`}><Users className={`h-4 w-4 ${muted}`} aria-hidden="true" /><h3 id="roster-observed-title" className="text-sm font-semibold">Observed roster statistics</h3></div><div className="overflow-x-auto"><table className="min-w-[560px] w-full text-left text-sm"><thead className={`text-[10px] uppercase tracking-wider ${muted}`}><tr><th className="px-5 py-3">Player</th><th className="px-5 py-3">Recorded rows</th><th className="px-5 py-3">Observed K/D</th><th className="px-5 py-3">Paired K/D coverage</th></tr></thead><tbody>{roster.map(row => <tr key={row.identity} className={`border-t ${theme.border}`}><td className="px-5 py-3 font-semibold">{row.displayName}{row.playerId && <span className={`ml-2 text-[9px] font-normal ${muted}`}>{row.playerId}</span>}</td><td className={`px-5 py-3 ${muted}`}>{row.recordedRows}</td><td className="px-5 py-3 font-mono">{row.kd === null ? 'Unknown' : row.kd.toFixed(2)}</td><td className={`px-5 py-3 ${muted}`}>{row.pairedSamples}/{row.recordedRows} same-row samples</td></tr>)}</tbody></table>{!roster.length && <p className={`p-8 text-center text-sm ${muted}`}>No player evidence recorded.</p>}</div></section>
  </div>;
}

function Readiness({ icon: Icon, title, badge, detail, surface, muted }: { icon: React.ComponentType<any>; title: string; badge: string; detail: string; surface: string; muted: string }) { return <section className={`rounded-xl border p-4 ${surface}`}><div className="flex items-center justify-between gap-3"><h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />{title}</h3><span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[9px] uppercase tracking-wider text-amber-600">{badge}</span></div><p className={`mt-3 text-xs leading-relaxed ${muted}`}>{detail}</p></section>; }

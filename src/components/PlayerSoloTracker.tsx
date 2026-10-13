import React, { useEffect, useMemo, useState } from 'react';
import { TrackerData } from '../types';
import { Activity, ShieldAlert, Users } from 'lucide-react';
import { aggregateObservedPlayerKd, shadowRatingReadiness, rankedIntegrationReadiness } from '../../lib/uiIntegration';
import { apiFetch } from '../utils/api';
import { practiceDatasetCoverage } from '../../lib/practiceCompleteness';

interface Props { data: TrackerData; theme: any; onSyncSoloQ: (player: string) => Promise<any>; }

export default function PlayerSoloTracker({ data, theme }: Props) {
  const roster = useMemo(() => aggregateObservedPlayerKd(data.playerStats || []), [data.playerStats]);
  const [engineState, setEngineState] = useState<any>(null);
  useEffect(() => { let active = true; apiFetch('/api/engine-adapters').then(async response => response.ok ? response.json() : null).then(value => { if (active) setEngineState(value); }).catch(() => {}); return () => { active = false; }; }, []);
  const light = data.settings.theme === 'daylight';
  const surface = `${theme.cardBg} ${theme.border}`;
  const muted = light ? 'text-slate-600' : 'text-gray-400';
  const shadow = shadowRatingReadiness(engineState);
  const ranked = rankedIntegrationReadiness(engineState);
  const practice = useMemo(() => practiceDatasetCoverage(data), [data]);

  return <div className="space-y-6">
    <header><p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${muted}`}>Roster evidence</p><h2 className="mt-1 text-2xl font-semibold">Player overview</h2><p className={`mt-1 text-sm ${muted}`}>Observed statistics only. Missing values are not replaced with average scores.</p></header>
    <div className="grid gap-4 lg:grid-cols-2">
      <Readiness surface={surface} muted={muted} icon={ShieldAlert} title="MoeTracker shadow performance score" badge={shadow.status === 'ready' ? 'Experimental · persisted' : 'Not rated'} detail={`${shadow.detail} Scores remain simplified, non-authoritative and read-only.`} />
      <Readiness surface={surface} muted={muted} icon={Activity} title="Ranked consent & health" badge={ranked.status === 'ready' ? 'Persisted · offline' : 'Inactive'} detail={`${ranked.detail} Manual ranked entries remain available; no network sync is attempted.`} />
    </div>
    <section className={`rounded-xl border p-4 ${surface}`} aria-labelledby="practice-readiness-title"><h3 id="practice-readiness-title" className="text-sm font-semibold">Practice review readiness</h3><div className="mt-3 grid gap-3 sm:grid-cols-3"><EvidenceCount label="Recorded matches" value={practice.matches} available={practice.matches > 0} muted={muted} /><EvidenceCount label="With player stats" value={practice.withStats} available={practice.withStats > 0} muted={muted} /><EvidenceCount label="With round logs" value={practice.withRounds} available={practice.withRounds > 0} muted={muted} /></div><p className={`mt-3 text-xs leading-relaxed ${muted}`}>This view was not given an authenticated roster identity, so it does not guess which performance rows or goals are yours. Personal goals remain hidden until identity is explicitly supplied.</p></section>
    <section className={`overflow-hidden rounded-xl border ${surface}`} aria-labelledby="roster-observed-title"><div className={`flex items-center gap-2 border-b px-5 py-4 ${theme.border}`}><Users className={`h-4 w-4 ${muted}`} aria-hidden="true" /><h3 id="roster-observed-title" className="text-sm font-semibold">Observed roster statistics</h3></div><div className="overflow-x-auto"><table className="min-w-[560px] w-full text-left text-sm"><thead className={`text-[10px] uppercase tracking-wider ${muted}`}><tr><th className="px-5 py-3">Player</th><th className="px-5 py-3">Recorded rows</th><th className="px-5 py-3">Observed K/D</th><th className="px-5 py-3">Paired K/D coverage</th></tr></thead><tbody>{roster.map(row => <tr key={row.identity} className={`border-t ${theme.border}`}><td className="px-5 py-3 font-semibold">{row.displayName}{row.playerId && <span className={`ml-2 text-[9px] font-normal ${muted}`}>{row.playerId}</span>}</td><td className={`px-5 py-3 ${muted}`}>{row.recordedRows}</td><td className="px-5 py-3 font-mono">{row.kd === null ? 'Unknown' : row.kd.toFixed(2)}</td><td className={`px-5 py-3 ${muted}`}>{row.pairedSamples}/{row.recordedRows} same-row samples</td></tr>)}</tbody></table>{!roster.length && <p className={`p-8 text-center text-sm ${muted}`}>No player evidence recorded.</p>}</div></section>
  </div>;
}

function Readiness({ icon: Icon, title, badge, detail, surface, muted }: { icon: React.ComponentType<any>; title: string; badge: string; detail: string; surface: string; muted: string }) { return <section className={`rounded-xl border p-4 ${surface}`}><div className="flex items-center justify-between gap-3"><h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />{title}</h3><span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[9px] uppercase tracking-wider text-amber-600">{badge}</span></div><p className={`mt-3 text-xs leading-relaxed ${muted}`}>{detail}</p></section>; }
function EvidenceCount({ label, value, available, muted }: { label: string; value: number; available: boolean; muted: string }) { return <div className="rounded-lg border border-white/10 bg-black/10 p-3"><span className={`block text-[9px] uppercase tracking-wider ${muted}`}>{label}</span><span className={`mt-1 block text-lg font-semibold ${available ? '' : muted}`}>{available ? value : 'Unknown'}</span></div>; }

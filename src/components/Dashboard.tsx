import React, { useMemo } from 'react';
import { TrackerData, Match } from '../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import { Trophy, Compass, Swords, Shield, Target, Award, CalendarDays, TrendingUp, Sparkles, Info, Users, Zap, CheckCircle } from 'lucide-react';

interface ComponentProps {
  data: TrackerData;
  theme: any;
}

export default function Dashboard({ data, theme }: ComponentProps) {
  const matches = data.matches || [];
  const isLight = data.settings.theme === 'daylight';
  
  // Basic stats
  const stats = useMemo(() => {
    let played = matches.length;
    let won = 0;
    let lost = 0;
    let drawn = 0;
    let attWon = 0;
    let attTotal = 0;
    let defWon = 0;
    let defTotal = 0;
    let closeCount = 0;
    let otCount = 0;

    matches.forEach((m) => {
      const ourScore = m.attW + m.defW;
      const enemyScore = m.attL + m.defL;
      
      if (ourScore > enemyScore) won++;
      else if (ourScore < enemyScore) lost++;
      else drawn++;

      attWon += m.attW;
      attTotal += (m.attW + m.attL);
      defWon += m.defW;
      defTotal += (m.defW + m.defL);

      const diff = Math.abs(ourScore - enemyScore);
      if (diff <= 2) closeCount++;
      if (ourScore > 12 && enemyScore > 12) otCount++;
    });

    const winRate = played > 0 ? ((won / played) * 100).toFixed(0) : '0';
    const attWinRate = attTotal > 0 ? ((attWon / attTotal) * 100).toFixed(0) : '0';
    const defWinRate = defTotal > 0 ? ((defWon / defTotal) * 100).toFixed(0) : '0';

    return { played, won, lost, drawn, winRate, attWon, attTotal, attWinRate, defWon, defTotal, defWinRate, closeCount, otCount };
  }, [matches]);

  const totalThrowsOnDashboard = useMemo(() => {
    return (data.rounds || []).filter(r => (r.isThrow as any) === 'TRUE' || (r.isThrow as any) === true).length;
  }, [data.rounds]);

  // Map win rates chart data
  const mapChartData = useMemo(() => {
    const mapStats: Record<string, { won: number; total: number }> = {};
    matches.forEach((m) => {
      if (!mapStats[m.map]) mapStats[m.map] = { won: 0, total: 0 };
      mapStats[m.map].total++;
      if (m.attW + m.defW > m.attL + m.defL) {
        mapStats[m.map].won++;
      }
    });

    return Object.entries(mapStats)
      .map(([name, s]) => ({
        name,
        winRate: Math.round((s.won / s.total) * 100),
        count: s.total
      }))
      .sort((a, b) => b.winRate - a.winRate);
  }, [matches]);

  // Historical form trend lines
  const formTrendData = useMemo(() => {
    let runningWin = 0;
    return [...matches]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((m, idx) => {
        const won = (m.attW + m.defW) > (m.attL + m.defL);
        if (won) runningWin++;
        const wr = Math.round((runningWin / (idx + 1)) * 100);
        return {
          name: m.map,
          winrate: wr,
          score: `${m.attW + m.defW}-${m.attL + m.defL}`
        };
      });
  }, [matches]);

  const recentMatches = useMemo(() => {
    return [...matches]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);
  }, [matches]);

  // --- COMPILE SD-PPR POWER LEADERBOARD ---
  const compiledSdPprLeaderboard = useMemo(() => {
    const players = data.settings?.players || [];
    const playerStatsList = data.playerStats || [];
    const roundsList = data.rounds || [];
    const scheduleList = data.schedule || [];

    return players.map((player) => {
      const pStats = playerStatsList.filter(ps => ps.player === player);
      const playerMatchIds = new Set(pStats.map(ps => ps.matchId));
      
      let mapsCount = pStats.length;
      let totalK = 0, totalD = 0;
      let totalAcs = 0, totalAdr = 0, totalHs = 0;
      let totalFk = 0, totalFd = 0;
      let kAtt = 0, dAtt = 0, kDef = 0, dDef = 0;
      let sumRating = 0;

      pStats.forEach((ps) => {
        totalK += (ps.kills || 0);
        totalD += (ps.deaths || 0);
        totalAcs += (ps.acs || 0);
        totalAdr += (ps.adr || 0);
        totalHs += (ps.hs || 0);
        totalFk += (ps.fk || 0);
        totalFd += (ps.fd || 0);
        kAtt += (ps.kAtt || 0);
        dAtt += (ps.dAtt || 0);
        kDef += (ps.kDef || 0);
        dDef += (ps.dDef || 0);
        sumRating += Number(ps.rating || 1.0);
      });

      const avgAcs = mapsCount > 0 ? Math.round(totalAcs / mapsCount) : 0;
      const avgAdr = mapsCount > 0 ? Math.round(totalAdr / mapsCount) : 0;
      const avgHs = mapsCount > 0 ? Math.round(totalHs / mapsCount) : 0;
      const avgRating = mapsCount > 0 ? (sumRating / mapsCount).toFixed(2) : '1.0';

      const kd = totalD > 0 ? (totalK / totalD).toFixed(2) : '0.00';

      // Team swing win rate analysis
      let winsWith = 0;
      let playsWith = 0;
      pStats.forEach((ps) => {
        const match = matches.find(m => m.id === ps.matchId);
        if (match) {
          playsWith++;
          if ((match.attW + match.defW) > (match.attL + match.defL)) winsWith++;
        }
      });
      const winrateWith = playsWith > 0 ? (winsWith / playsWith) * 100 : 50;

      // Practice/Attendance Reliability score
      let totalSchedules = 0;
      let presentSchedules = 0;
      scheduleList.forEach((s) => {
        if (s.calendarKey === 'practice') {
          totalSchedules++;
          const att = s.attendance?.[player];
          if (att === 'Prac' || att === 'Late') presentSchedules++;
        }
      });
      const attendancePct = totalSchedules > 0 ? Math.round((presentSchedules / totalSchedules) * 100) : 100;

      // Real rounds-based overthrow (throws) analysis
      const playerThrows = roundsList.filter(
        r => r.isThrow === 'TRUE' && r.thrownBy === player && playerMatchIds.has(r.matchId)
      );
      const throwsCount = playerThrows.length;

      // --- ADVANCED SD-PPR CALCULATION ---
      const kdNum = Number(kd);
      const baseCombat = (avgAcs / 225) * 0.35 + (avgAdr / 145) * 0.35 + (kdNum / 1.05) * 0.30;
      const hsBonus = (avgHs - 20) * 0.005;
      const combatIndex = Math.min(2.0, Math.max(0.4, baseCombat + hsBonus));

      const avgFk = mapsCount > 0 ? totalFk / mapsCount : 0;
      const avgFd = mapsCount > 0 ? totalFd / mapsCount : 0;
      const openerIndex = Math.min(1.8, Math.max(0.4, 1.0 + (avgFk - avgFd) * 0.12));

      const avgThrows = mapsCount > 0 ? throwsCount / mapsCount : 0;
      const disciplineIndex = Math.min(1.0, Math.max(0.3, 1.0 - (avgThrows * 0.18)));

      const swingFactor = 0.85 + (winrateWith / 100) * 0.30;
      const attendanceFactor = 0.9 + (attendancePct / 100) * 0.2;
      const synergyMultiplier = (swingFactor * 0.7) + (attendanceFactor * 0.3);

      const rawSdPpr = (combatIndex * 0.45 + openerIndex * 0.25 + disciplineIndex * 0.30) * synergyMultiplier;
      const sdPpr = mapsCount > 0 ? Number(rawSdPpr.toFixed(2)) : 1.00;

      return {
        player,
        maps: mapsCount,
        rating: avgRating,
        sdPpr: sdPpr.toFixed(2),
        kd,
        acs: avgAcs,
        throwsCount
      };
    }).sort((a, b) => Number(b.sdPpr) - Number(a.sdPpr));
  }, [data, matches]);

  const getSdPprBadge = (ratingStr: string) => {
    const val = Number(ratingStr);
    if (val >= 1.20) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (val >= 1.05) return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20';
    if (val >= 0.90) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-[#ff4655] bg-rose-500/10 border border-rose-500/20';
  };

  return (
    <div className="space-y-6">
      {/* Metric Tiles Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Play Record Card */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} relative overflow-hidden group`}>
          <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform">
            <Trophy className="w-24 h-24" />
          </div>
          <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">RECORD</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black">{stats.won}</span>
            <span className="text-xs text-gray-400">W</span>
            <span className="text-3xl font-black text-gray-400">/</span>
            <span className="text-3xl font-black">{stats.lost}</span>
            <span className="text-xs text-gray-400">L</span>
            {stats.drawn > 0 && (
              <>
                <span className="text-3xl font-black text-gray-400">/</span>
                <span className="text-3xl font-black">{stats.drawn}</span>
                <span className="text-xs text-gray-400">D</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-2 font-mono">Total Maps: {stats.played}</p>
        </div>

        {/* Win Rate Card */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} relative overflow-hidden group`}>
          <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">WIN RATE</p>
          <div className="flex items-baseline gap-1">
            <span className={`text-4xl font-black ${theme.text}`}>{stats.winRate}%</span>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-gray-700/20 rounded-full h-1.5 mt-3">
            <div className={`h-1.5 rounded-full ${theme.primaryBg}`} style={{ width: `${stats.winRate}%` }}></div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2 font-mono">Form: {matches.slice(0, 5).map(m => (m.attW+m.defW)>(m.attL+m.defL)? 'W':'L').join('') || '-'}</p>
        </div>

        {/* Attack Round Winrate */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'}`}>
          <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">ATTACK SPLIT</p>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-black text-amber-500">{stats.attWinRate}%</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-3 font-mono">Rounds: {stats.attWon} / {stats.attTotal}</p>
        </div>

        {/* Defense Round Winrate */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'}`}>
          <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">DEFENSE SPLIT</p>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-black text-cyan-500">{stats.defWinRate}%</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-3 font-mono">Rounds: {stats.defWon} / {stats.defTotal}</p>
        </div>
      </div>

      {/* Flagged Tactical Warning Banner */}
      {totalThrowsOnDashboard > 0 && (
        <div className="p-4 rounded-xl border border-rose-500/15 bg-rose-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-mono">
          <div className="space-y-0.5">
            <h4 className="text-xs font-black text-rose-500 uppercase tracking-wider flex items-center gap-1.5">
              ⚠️ Tactical Discipline Warning
            </h4>
            <p className="text-[11px] text-gray-300">
              Coaches have logged <strong className="text-[#ff4655] font-black">{totalThrowsOnDashboard}</strong> round loss(es) as costly tactical throws. Review overpeek logs and team loss drivers in the <strong className="text-white">Map Best Stats &gt; Tactical Error & Throws</strong> tab.
            </p>
          </div>
        </div>
      )}

      {/* Charts section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Map Winrates */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} flex flex-col h-[320px]`}>
          <div className="flex items-center gap-2 mb-4">
            <Compass className={`w-5 h-5 ${theme.text}`} />
            <h3 className="font-black text-sm tracking-wide uppercase">Map Pool Win Rates</h3>
          </div>
          <div className="flex-grow min-h-0 w-full">
            {mapChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mapChartData} layout="vertical" margin={{ left: 5, right: 15, top: 0, bottom: 0 }}>
                  <XAxis type="number" domain={[0, 100]} stroke={isLight ? '#475569' : '#94a3b8'} fontSize={10} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" stroke={isLight ? '#475569' : '#94a3b8'} fontSize={11} width={65} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: isLight ? '#ffffff' : '#0f1923', borderColor: isLight ? '#cbd5e1' : '#334155', color: isLight ? '#0f172a' : '#ffffff', fontSize: '11px' }} 
                    formatter={(v) => [`${v}% Win Rate`]}
                  />
                  <Bar dataKey="winRate" fill={theme.primary} radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-gray-500 font-mono">No matches logged yet</div>
            )}
          </div>
        </div>

        {/* Rating and Rolling Form */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} flex flex-col h-[320px]`}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className={`w-5 h-5 ${theme.text}`} />
            <h3 className="font-black text-sm tracking-wide uppercase">Rolling Win Rate Trend</h3>
          </div>
          <div className="flex-grow min-h-0 w-full">
            {formTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={formTrendData} margin={{ left: -10, right: 15, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e2e8f0' : '#1e293b'} />
                  <XAxis dataKey="name" stroke={isLight ? '#475569' : '#94a3b8'} fontSize={9} />
                  <YAxis domain={[0, 100]} stroke={isLight ? '#475569' : '#94a3b8'} fontSize={10} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: isLight ? '#ffffff' : '#0f1923', borderColor: isLight ? '#cbd5e1' : '#334155', color: isLight ? '#0f172a' : '#ffffff', fontSize: '11px' }}
                    formatter={(v, name, props) => [`${v}% Win Rate`, `Score: ${props.payload.score}`]}
                  />
                  <Line type="monotone" dataKey="winrate" stroke={theme.primary} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-gray-500 font-mono">No matches logged yet</div>
            )}
          </div>
        </div>
      </div>

      {/* DUAL SECTION GRID: Recent Maps (Left) + SD-PPR Leaderboard (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* Recent Matches - Left Column */}
        <div className={`xl:col-span-8 p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} flex flex-col justify-between`}>
          <div>
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Swords className={`w-5 h-5 ${theme.text}`} />
                <h3 className="font-black text-sm tracking-wide uppercase">Recent Matches</h3>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead>
                  <tr className={`border-b ${isLight ? 'border-slate-100 text-slate-500' : 'border-white/10 text-gray-400'} uppercase font-bold`}>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Opponent</th>
                    <th className="py-3 px-4">Map</th>
                    <th className="py-3 px-4 text-center">Score</th>
                    <th className="py-3 px-4 text-center">ATT Split</th>
                    <th className="py-3 px-4 text-center">DEF Split</th>
                    <th className="py-3 px-4 text-center">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {recentMatches.map((m) => {
                    const totalOur = m.attW + m.defW;
                    const totalTheir = m.attL + m.defL;
                    const won = totalOur > totalTheir;
                    const tied = totalOur === totalTheir;
                    return (
                      <tr key={m.id} className={`hover:${isLight ? 'bg-slate-50' : 'bg-white/5'} transition-colors`}>
                        <td className="py-3.5 px-4">{m.date}</td>
                        <td className="py-3.5 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            m.type === 'Official' 
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' 
                              : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                          }`}>
                            {m.type}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-bold">{m.opponent}</td>
                        <td className="py-3.5 px-4">{m.map}</td>
                        <td className="py-3.5 px-4 text-center font-bold text-sm">
                          <span className={won ? 'text-emerald-400' : tied ? 'text-slate-400' : 'text-rose-400'}>
                            {totalOur}
                          </span>
                          <span className="text-gray-500"> - </span>
                          <span className={won ? 'text-rose-400' : tied ? 'text-slate-400' : 'text-emerald-400'}>
                            {totalTheir}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center text-gray-400">{m.attW}W - {m.attL}L</td>
                        <td className="py-3.5 px-4 text-center text-gray-400">{m.defW}W - {m.defL}L</td>
                        <td className="py-3.5 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                            won 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                              : tied 
                                ? 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {won ? 'WIN' : tied ? 'DRAW' : 'LOSS'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {recentMatches.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-gray-500 font-mono">
                        No matches played yet. Go to the Import or Match Log tab to add one!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* SD-PPR Leaderboard - Right Column */}
        <div className={`xl:col-span-4 p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#ff4655]" />
              <h3 className="font-black text-sm tracking-wide uppercase">SD-PPR Standings</h3>
            </div>
            <span className="text-[9px] font-mono font-black text-[#ff4655] px-1.5 py-0.5 bg-rose-500/10 border border-rose-500/20 rounded animate-pulse">LIVE</span>
          </div>

          <p className="text-[10px] text-gray-400 leading-normal font-mono">
            Unified team roster standing ranked by <span className="text-rose-400">Synergy-Discipline Adjusted Player Performance Ratings</span>.
          </p>

          <div className="space-y-3 pt-2">
            {compiledSdPprLeaderboard.map((item, index) => (
              <div 
                key={item.player} 
                className={`p-3 rounded-xl border border-white/5 bg-black/15 font-mono flex items-center justify-between transition-all hover:scale-[1.01]`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center text-[10px] font-black text-gray-400 border border-white/5">
                    #{index + 1}
                  </div>
                  <div>
                    <p className="text-xs font-black text-white">{item.player}</p>
                    <p className="text-[9px] text-gray-500">Maps: {item.maps} | K/D: {item.kd}</p>
                  </div>
                </div>

                <div className="text-right">
                  <span className={`p-1 px-2.5 rounded-lg font-black text-xs border ${getSdPprBadge(item.sdPpr)}`}>
                    {item.sdPpr}
                  </span>
                  <p className="text-[8px] text-gray-500 uppercase font-bold mt-1">SD-PPR Rating</p>
                </div>
              </div>
            ))}
            {compiledSdPprLeaderboard.length === 0 && (
              <p className="text-center text-gray-500 text-xs py-10 font-mono">No roster data available</p>
            )}
          </div>

          <div className="p-2.5 bg-black/20 border border-white/5 rounded-lg text-[9px] text-gray-400 font-mono leading-relaxed flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
            <span>Go to the <strong>Roster &amp; Solo Q</strong> tab and click on any player row to read their personalized 4-pillar actionable blueprint recommendations!</span>
          </div>
        </div>

      </div>
    </div>
  );
}

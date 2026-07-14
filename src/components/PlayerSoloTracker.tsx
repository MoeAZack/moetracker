import React, { useState, useMemo } from 'react';
import { TrackerData, PlayerStats, SoloQ } from '../types';
import { 
  Award, Zap, RefreshCw, BarChart2, ShieldAlert, ArrowUpRight, ArrowDownRight, 
  Activity, Target, Sliders, Shield, Crosshair, Users, Info, Calendar, 
  CheckCircle2, AlertTriangle, ThumbsDown, BookOpen, Sparkles
} from 'lucide-react';

interface ComponentProps {
  data: TrackerData;
  theme: any;
  onSyncSoloQ: (player: string) => Promise<any>;
}

export default function PlayerSoloTracker({ data, theme, onSyncSoloQ }: ComponentProps) {
  const isLight = data.settings.theme === 'daylight';
  const [activeSubTab, setActiveSubTab] = useState<'roster' | 'soloq'>('roster');

  // --- DRILLDOWN & SELECTED SCORECARD STATE ---
  const [selectedPlayer, setSelectedPlayer] = useState<string>(data.settings.players[0] || '');
  const [selectedMap, setSelectedMap] = useState<string>('All');

  // Syncing states
  const [syncingMap, setSyncingMap] = useState<Record<string, boolean>>({});
  const [syncError, setSyncError] = useState<string | null>(null);

  const players = data.settings.players || [];
  const matches = data.matches || [];
  const playerStatsList = data.playerStats || [];
  const soloqList = data.soloq || [];
  const scheduleList = data.schedule || [];
  const roundsList = data.rounds || [];

  // --- COMPILING PLAYER ROSTER METRICS WITH SD-PPR ---
  const compiledRosterStats = useMemo(() => {
    return players.map((player) => {
      const pStats = playerStatsList.filter(ps => ps.player === player);
      const playerMatchIds = new Set(pStats.map(ps => ps.matchId));
      
      let mapsCount = pStats.length;
      let totalK = 0, totalD = 0, totalA = 0;
      let totalAcs = 0, totalAdr = 0, totalHs = 0;
      let totalFk = 0, totalFd = 0;
      let kAtt = 0, dAtt = 0, kDef = 0, dDef = 0;
      let sumRating = 0;

      pStats.forEach((ps) => {
        totalK += (ps.kills || 0);
        totalD += (ps.deaths || 0);
        totalA += (ps.assists || 0);
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
      const attKd = dAtt > 0 ? (kAtt / dAtt).toFixed(2) : '0.00';
      const defKd = dDef > 0 ? (kDef / dDef).toFixed(2) : '0.00';

      // Team swing win rate analysis (when player plays)
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
      // 1. Combat Index (Standardized ACS, ADR, K/D, HS% around average baselines)
      const kdNum = Number(kd);
      const baseCombat = (avgAcs / 225) * 0.35 + (avgAdr / 145) * 0.35 + (kdNum / 1.05) * 0.30;
      const hsBonus = (avgHs - 20) * 0.005; // ~20% HS is baseline. 30% HS gives a +0.05 bonus
      const combatIndex = Math.min(2.0, Math.max(0.4, baseCombat + hsBonus));

      // 2. Opener Index (Ratio of First Kills to First Deaths per map)
      const avgFk = mapsCount > 0 ? totalFk / mapsCount : 0;
      const avgFd = mapsCount > 0 ? totalFd / mapsCount : 0;
      const openerIndex = Math.min(1.8, Math.max(0.4, 1.0 + (avgFk - avgFd) * 0.12));

      // 3. Discipline Index (Choke penalty per average maps played)
      const avgThrows = mapsCount > 0 ? throwsCount / mapsCount : 0;
      const disciplineIndex = Math.min(1.0, Math.max(0.3, 1.0 - (avgThrows * 0.18)));

      // 4. Team Synergy Multiplier (Swing Coeff & Practice Reliability combo)
      const swingFactor = 0.85 + (winrateWith / 100) * 0.30; // Scale 50% wr to 1.0, 100% to 1.15
      const attendanceFactor = 0.9 + (attendancePct / 100) * 0.2; // Scale 100% attendance to 1.10
      const synergyMultiplier = (swingFactor * 0.7) + (attendanceFactor * 0.3);

      // Final Unified Rating
      const rawSdPpr = (combatIndex * 0.45 + openerIndex * 0.25 + disciplineIndex * 0.30) * synergyMultiplier;
      const sdPpr = mapsCount > 0 ? Number(rawSdPpr.toFixed(2)) : 1.00;

      return {
        player,
        maps: mapsCount,
        rating: avgRating, // Henrik/VLR Rating
        sdPpr: sdPpr.toFixed(2), // Custom Synergy & Discipline Rating
        combatIndex: Math.round(combatIndex * 100),
        openerIndex: Math.round(openerIndex * 100),
        disciplineIndex: Math.round(disciplineIndex * 100),
        synergyIndex: Math.round(synergyMultiplier * 100),
        acs: avgAcs,
        adr: avgAdr,
        hs: avgHs,
        kda: `${totalK} / ${totalD} / ${totalA}`,
        kd,
        attKd,
        defKd,
        fkFd: `${totalFk} / ${totalFd}`,
        diff: totalFk - totalFd,
        swing: Math.round(winrateWith),
        attendance: `${attendancePct}% (${presentSchedules}/${totalSchedules})`,
        attendancePct,
        throwsCount,
        playerThrows
      };
    });
  }, [players, playerStatsList, matches, scheduleList, roundsList]);

  // Find currently selected player stats for deep scorecard
  const selectedRosterStats = useMemo(() => {
    return compiledRosterStats.find(r => r.player === selectedPlayer) || null;
  }, [compiledRosterStats, selectedPlayer]);

  // --- DRILLDOWN STATS PER PLAYER, PER MAP ---
  const drilldownStats = useMemo(() => {
    if (!selectedPlayer) return null;
    const pStats = playerStatsList.filter(ps => {
      if (ps.player !== selectedPlayer) return false;
      if (selectedMap !== 'All') {
        const match = matches.find(m => m.id === ps.matchId);
        if (!match || match.map !== selectedMap) return false;
      }
      return true;
    });

    let count = pStats.length;
    let k = 0, d = 0, a = 0, acs = 0, adr = 0, hs = 0, fk = 0, fd = 0;
    let rating = 0;

    pStats.forEach(ps => {
      k += (ps.kills || 0);
      d += (ps.deaths || 0);
      a += (ps.assists || 0);
      acs += (ps.acs || 0);
      adr += (ps.adr || 0);
      hs += (ps.hs || 0);
      fk += (ps.fk || 0);
      fd += (ps.fd || 0);
      rating += Number(ps.rating || 1.0);
    });

    return {
      played: count,
      avgRating: count > 0 ? (rating / count).toFixed(2) : '-',
      avgAcs: count > 0 ? Math.round(acs / count) : '-',
      avgAdr: count > 0 ? Math.round(adr / count) : '-',
      avgHs: count > 0 ? Math.round(hs / count) : '-',
      kda: `${k} / ${d} / ${a}`,
      kd: d > 0 ? (k / d).toFixed(2) : '-',
      fkFd: `${fk} / ${fd}`
    };
  }, [selectedPlayer, selectedMap, playerStatsList, matches]);

  // --- COMPILING SOLOQ SUMMARY LEADERBOARD ---
  const compiledSoloQLeaderboard = useMemo(() => {
    return players.map((player) => {
      const pHistory = soloqList.filter(s => s.player === player);
      
      let totalW = 0;
      let totalL = 0;
      let rank = 'Ascendant 3';
      let rr = 0;
      let lastSync = '-';

      pHistory.forEach((s) => {
        totalW += (s.wins || 0);
        totalL += (s.losses || 0);
        if (s.rank) rank = s.rank;
        if (s.rr !== undefined) rr = Number(s.rr);
        if (s.date) lastSync = s.date;
      });

      const played = totalW + totalL;
      const wr = played > 0 ? ((totalW / played) * 100).toFixed(0) : '0';

      return {
        player,
        wins: totalW,
        losses: totalL,
        games: played,
        winRate: wr,
        rank,
        rr,
        lastSync
      };
    }).sort((a, b) => b.rr - a.rr);
  }, [players, soloqList]);

  // --- SYNC ACTIONS ---
  const handleSyncSoloQ = async (player: string) => {
    setSyncingMap(prev => ({ ...prev, [player]: true }));
    setSyncError(null);
    try {
      await onSyncSoloQ(player);
    } catch (err: any) {
      setSyncError(err.message || 'MMR sync failed.');
    } finally {
      setSyncingMap(prev => ({ ...prev, [player]: false }));
    }
  };

  const last40SoloQ = useMemo(() => {
    return [...soloqList]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 40);
  }, [soloqList]);

  // Quick rating evaluation text and color helper
  const getRatingBadge = (ratingStr: string) => {
    const val = Number(ratingStr);
    if (val >= 1.20) return { label: 'FRANCHISE TIER', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
    if (val >= 1.05) return { label: 'PROSPECT', color: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' };
    if (val >= 0.90) return { label: 'RELIABLE', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
    return { label: 'NEEDS DISCIPLINE', color: 'bg-rose-500/10 text-[#ff4655] border-rose-500/20' };
  };

  return (
    <div className="space-y-6">
      {/* Sub tabs toggle */}
      <div className="flex gap-2 border-b border-white/10 pb-4">
        <button
          onClick={() => setActiveSubTab('roster')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase rounded-lg transition-all ${
            activeSubTab === 'roster'
              ? 'bg-white/5 text-white shadow-md border-b-2 border-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <BarChart2 className="w-4 h-4" />
          Roster Performance
        </button>
        <button
          onClick={() => setActiveSubTab('soloq')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase rounded-lg transition-all ${
            activeSubTab === 'soloq'
              ? 'bg-white/5 text-white shadow-md border-b-2 border-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <Activity className="w-4 h-4" />
          Solo Queue Hub
        </button>
      </div>

      {activeSubTab === 'roster' ? (
        <div className="space-y-6 animate-fadeIn">
          {/* Main Roster Performance Table */}
          <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <Award className={`w-5 h-5 ${theme.text}`} />
                <div>
                  <h4 className="font-black text-sm uppercase tracking-wide">Roster Performance Metrics</h4>
                  <p className="text-[10px] text-gray-400 font-mono">
                    Includes standard statistics and <span className="text-[#ff4655]">SD-PPR Rating (Synergy & Discipline Adjusted)</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 p-1.5 bg-black/25 border border-white/5 rounded-lg text-[9px] font-mono text-gray-400">
                <Info className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>Click a player's row to load their Unified Scorecard below.</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-white/10 text-gray-500 uppercase font-bold">
                    <th className="py-3 px-3">Player</th>
                    <th className="py-3 px-3 text-center text-rose-400">SD-PPR Rating</th>
                    <th className="py-3 px-3 text-center">Standard Rating</th>
                    <th className="py-3 px-3 text-center">Maps</th>
                    <th className="py-3 px-3 text-center">ACS</th>
                    <th className="py-3 px-3 text-center">ADR</th>
                    <th className="py-3 px-3 text-center">HS%</th>
                    <th className="py-3 px-3 text-center">K / D / A</th>
                    <th className="py-3 px-3 text-center">K/D</th>
                    <th className="py-3 px-3 text-center">ATT K/D</th>
                    <th className="py-3 px-3 text-center">DEF K/D</th>
                    <th className="py-3 px-3 text-center">FK/FD</th>
                    <th className="py-3 px-3 text-center text-rose-400">Throws</th>
                    <th className="py-3 px-3 text-center">Swing Coeff.</th>
                    <th className="py-3 px-3 text-center">Attendance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {compiledRosterStats.map((r) => {
                    const isSelected = selectedPlayer === r.player;
                    return (
                      <tr 
                        key={r.player} 
                        onClick={() => setSelectedPlayer(r.player)}
                        className={`transition-colors cursor-pointer ${
                          isSelected 
                            ? 'bg-[#ff4655]/10 border-l-2 border-l-[#ff4655]' 
                            : 'hover:bg-white/5'
                        }`}
                      >
                        <td className="py-3.5 px-3 font-bold text-white text-xs flex items-center gap-1.5">
                          {r.player}
                          {isSelected && <span className="w-1.5 h-1.5 bg-[#ff4655] rounded-full animate-ping" />}
                        </td>
                        <td className="py-3.5 px-3 text-center">
                          <span className="p-1 px-2 rounded-lg font-black text-xs bg-[#ff4655]/15 text-[#ff4655] border border-[#ff4655]/30">
                            {r.sdPpr}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 text-center text-gray-300 font-bold">
                          {r.rating}
                        </td>
                        <td className="py-3.5 px-3 text-center font-bold text-gray-300">{r.maps}</td>
                        <td className="py-3.5 px-3 text-center text-gray-200 font-bold">{r.acs}</td>
                        <td className="py-3.5 px-3 text-center text-gray-300">{r.adr}</td>
                        <td className="py-3.5 px-3 text-center text-amber-500">{r.hs}%</td>
                        <td className="py-3.5 px-3 text-center text-gray-400 font-semibold">{r.kda}</td>
                        <td className={`py-3.5 px-3 text-center font-bold ${Number(r.kd) >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>{r.kd}</td>
                        <td className="py-3.5 px-3 text-center text-amber-500/80 font-bold">{r.attKd}</td>
                        <td className="py-3.5 px-3 text-center text-cyan-400 font-bold">{r.defKd}</td>
                        <td className={`py-3.5 px-3 text-center font-bold ${r.diff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {r.fkFd} ({r.diff >= 0 ? '+' : ''}{r.diff})
                        </td>
                        <td className={`py-3.5 px-3 text-center font-black ${r.throwsCount > 0 ? 'text-[#ff4655] bg-rose-500/5' : 'text-gray-500'}`}>
                          {r.throwsCount} {r.throwsCount > 0 ? '⚠️' : '✓'}
                        </td>
                        <td className="py-3.5 px-3 text-center font-bold">
                          <span className={`flex items-center justify-center gap-1 ${r.swing >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {r.swing >= 50 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                            {r.swing}%
                          </span>
                        </td>
                        <td className={`py-3.5 px-3 text-center font-bold ${r.attendancePct >= 80 ? 'text-emerald-400' : 'text-amber-500'}`}>
                          {r.attendance}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* TWO COLUMN PERFORMANCE BREAKDOWN SECTION */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* COLUMN 1 (8-wide): Dynamic Synergy & Discipline Scorecard (SD-PPR) */}
            <div className="lg:col-span-8 space-y-6">
              {selectedRosterStats ? (
                <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-5`}>
                  
                  {/* Header info */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#ff4655] to-rose-700 flex items-center justify-center font-black text-white text-base shadow-lg shadow-rose-500/10 border border-white/10 font-mono">
                        {selectedPlayer.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="text-sm font-black uppercase text-white font-mono flex items-center gap-2">
                          {selectedPlayer}
                          <span className={`text-[9px] px-2 py-0.5 border font-semibold rounded-full ${getRatingBadge(selectedRosterStats.sdPpr).color}`}>
                            {getRatingBadge(selectedRosterStats.sdPpr).label}
                          </span>
                        </h4>
                        <p className="text-[10px] text-gray-400 font-mono mt-0.5">Unified Tactical Performance Rating Dashboard</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 bg-black/35 p-2 px-4 rounded-xl border border-white/5">
                      <div className="text-center font-mono">
                        <p className="text-[8px] text-gray-500 uppercase font-black">SD-PPR Rating</p>
                        <p className="text-xl font-black text-[#ff4655]">{selectedRosterStats.sdPpr}</p>
                      </div>
                      <div className="w-[1px] h-8 bg-white/10" />
                      <div className="text-center font-mono">
                        <p className="text-[8px] text-gray-500 uppercase font-black">Standard</p>
                        <p className="text-base font-bold text-gray-300">{selectedRosterStats.rating}</p>
                      </div>
                      <div className="w-[1px] h-8 bg-white/10" />
                      <div className="text-center font-mono">
                        <p className="text-[8px] text-gray-500 uppercase font-black">Throws Logged</p>
                        <p className="text-base font-black text-rose-400">{selectedRosterStats.throwsCount}</p>
                      </div>
                    </div>
                  </div>

                  {/* 4 Core Dimensions of SD-PPR */}
                  <div className="space-y-4">
                    <h5 className="text-[11px] font-black uppercase text-gray-400 tracking-wider font-mono flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-[#ff4655]" /> SD-PPR Dynamic Calculation Indices
                    </h5>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      
                      {/* 1. Combat Efficiency (45% Weight) */}
                      <div className="p-3.5 rounded-lg bg-black/20 border border-white/5 space-y-2">
                        <div className="flex justify-between items-center text-xs font-mono">
                          <span className="font-bold text-gray-200 flex items-center gap-1">
                            <Crosshair className="w-3.5 h-3.5 text-[#ff4655]" /> Combat Index (45%)
                          </span>
                          <span className="font-black text-[#ff4655]">{selectedRosterStats.combatIndex}%</span>
                        </div>
                        <div className="w-full bg-black/45 rounded-full h-2 overflow-hidden border border-white/5">
                          <div 
                            className="bg-[#ff4655] h-full rounded-full transition-all duration-500" 
                            style={{ width: `${Math.min(100, selectedRosterStats.combatIndex)}%` }} 
                          />
                        </div>
                        <div className="grid grid-cols-3 text-[9px] text-gray-500 font-mono pt-1 text-center divide-x divide-white/5">
                          <div>
                            <p>ACS</p>
                            <p className="font-bold text-gray-300">{selectedRosterStats.acs}</p>
                          </div>
                          <div>
                            <p>ADR</p>
                            <p className="font-bold text-gray-300">{selectedRosterStats.adr}</p>
                          </div>
                          <div>
                            <p>HS%</p>
                            <p className="font-bold text-amber-500">{selectedRosterStats.hs}%</p>
                          </div>
                        </div>
                      </div>

                      {/* 2. Clutch/Opener Impact (25% Weight) */}
                      <div className="p-3.5 rounded-lg bg-black/20 border border-white/5 space-y-2">
                        <div className="flex justify-between items-center text-xs font-mono">
                          <span className="font-bold text-gray-200 flex items-center gap-1">
                            <Target className="w-3.5 h-3.5 text-emerald-400" /> Opening Impact (25%)
                          </span>
                          <span className="font-black text-emerald-400">{selectedRosterStats.openerIndex}%</span>
                        </div>
                        <div className="w-full bg-black/45 rounded-full h-2 overflow-hidden border border-white/5">
                          <div 
                            className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                            style={{ width: `${Math.min(100, selectedRosterStats.openerIndex)}%` }} 
                          />
                        </div>
                        <div className="grid grid-cols-3 text-[9px] text-gray-500 font-mono pt-1 text-center divide-x divide-white/5">
                          <div>
                            <p>First Kills</p>
                            <p className="font-bold text-emerald-400">{selectedRosterStats.fkFd.split('/')[0]}</p>
                          </div>
                          <div>
                            <p>First Deaths</p>
                            <p className="font-bold text-rose-400">{selectedRosterStats.fkFd.split('/')[1]}</p>
                          </div>
                          <div>
                            <p>Diff</p>
                            <p className={`font-bold ${selectedRosterStats.diff >= 0 ? 'text-emerald-400' : 'text-[#ff4655]'}`}>
                              {selectedRosterStats.diff >= 0 ? '+' : ''}{selectedRosterStats.diff}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 3. Discipline Index (30% Weight) */}
                      <div className="p-3.5 rounded-lg bg-black/20 border border-white/5 space-y-2">
                        <div className="flex justify-between items-center text-xs font-mono">
                          <span className="font-bold text-gray-200 flex items-center gap-1">
                            <Shield className="w-3.5 h-3.5 text-cyan-400" /> Discipline Coeff. (30%)
                          </span>
                          <span className="font-black text-cyan-400">{selectedRosterStats.disciplineIndex}%</span>
                        </div>
                        <div className="w-full bg-black/45 rounded-full h-2 overflow-hidden border border-white/5">
                          <div 
                            className="bg-cyan-400 h-full rounded-full transition-all duration-500" 
                            style={{ width: `${Math.min(100, selectedRosterStats.disciplineIndex)}%` }} 
                          />
                        </div>
                        <div className="grid grid-cols-2 text-[9px] text-gray-500 font-mono pt-1 text-center divide-x divide-white/5">
                          <div>
                            <p>Throws/Overthrows</p>
                            <p className="font-bold text-rose-400">{selectedRosterStats.throwsCount}</p>
                          </div>
                          <div>
                            <p>Discipline Status</p>
                            <p className={`font-bold ${selectedRosterStats.throwsCount === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                              {selectedRosterStats.throwsCount === 0 ? 'EXCELLENT' : `${selectedRosterStats.throwsCount} DETECTED`}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* 4. Team Synergy Multiplier */}
                      <div className="p-3.5 rounded-lg bg-black/20 border border-white/5 space-y-2">
                        <div className="flex justify-between items-center text-xs font-mono">
                          <span className="font-bold text-gray-200 flex items-center gap-1">
                            <Users className="w-3.5 h-3.5 text-amber-500" /> Team Synergy Factor
                          </span>
                          <span className="font-black text-amber-500">x{ (selectedRosterStats.synergyIndex / 100).toFixed(2) }</span>
                        </div>
                        <div className="w-full bg-black/45 rounded-full h-2 overflow-hidden border border-white/5">
                          <div 
                            className="bg-amber-500 h-full rounded-full transition-all duration-500" 
                            style={{ width: `${Math.min(100, selectedRosterStats.synergyIndex - 40)}%` }} 
                          />
                        </div>
                        <div className="grid grid-cols-2 text-[9px] text-gray-500 font-mono pt-1 text-center divide-x divide-white/5">
                          <div>
                            <p>Swing Coeff (Win% With)</p>
                            <p className="font-bold text-emerald-400">{selectedRosterStats.swing}%</p>
                          </div>
                          <div>
                            <p>Practice Attendance</p>
                            <p className="font-bold text-gray-300">{selectedRosterStats.attendance.split(' ')[0]}</p>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>

                  {/* Recommended Actions (1-2-3-4 blueprint) */}
                  <div className="space-y-3 pt-4 border-t border-white/5">
                    <h5 className="text-[11px] font-black uppercase text-rose-400 tracking-wider font-mono flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> 1-2-3-4 Actionable Blueprint Recommendations
                    </h5>
                    <p className="text-[9px] text-gray-400 font-mono">
                      Dynamic coaching advice derived from SD-PPR performance metrics. Use these strategic recommendations to elevate in-game efficiency.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      
                      {/* Rec 1: Combat Adjustment */}
                      <div className="p-3 bg-white/5 border border-white/5 rounded-xl space-y-1 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-black text-[10px]">1</span>
                          <span className="text-[10px] font-black uppercase text-gray-300">COMBAT DRILL ADVICE</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-normal">
                          {selectedRosterStats.combatIndex < 85 
                            ? "Core metrics indicate sub-optimal frag efficiency. Focus on crosshair placement, support role alignment, and routine AimLabs/Deathmatch tracking practice." 
                            : selectedRosterStats.combatIndex > 115 
                            ? "High-impact execution: Designate as primary entry/first contact. Setup with high-value trade positioning to maximize elite fragging power." 
                            : "Stable mechanical baseline. Focus on timing micro-adjustments, coordinated spray control, and holding off-angles."}
                        </p>
                      </div>

                      {/* Rec 2: Opening Engagement */}
                      <div className="p-3 bg-white/5 border border-white/5 rounded-xl space-y-1 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-black text-[10px]">2</span>
                          <span className="text-[10px] font-black uppercase text-gray-300">OPENING ENGAGEMENT RULE</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-normal">
                          {selectedRosterStats.openerIndex < 90 
                            ? "Passive spacing advised: Avoid dry solo opening duels. Play behind primary entry for trade-frags, or focus on utility-first setups." 
                            : selectedRosterStats.openerIndex > 110 
                            ? "Enable aggressive pacing: Lead early-round site intrusions. Coordinate double-swings with flash supports to secure site authority." 
                            : "Balanced trade-spacing. Prioritize holding standard defensive default choke lines or default-clear coordination on attack."}
                        </p>
                      </div>

                      {/* Rec 3: Discipline & Overpeeks */}
                      <div className="p-3 bg-white/5 border border-white/5 rounded-xl space-y-1 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-black text-[10px]">3</span>
                          <span className="text-[10px] font-black uppercase text-gray-300">RISK MITIGATION MANDATE</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-normal">
                          {selectedRosterStats.throwsCount > 0 
                            ? "Risk containment warning: Play high-discipline post-plants. Never over-extend or hunt for kills when holding advantage numbers (e.g. 5v3 / 4v2)." 
                            : "Excellent default discipline. Maintain flawless site anchoring; avoid unnecessary dry peeks; continue utilizing strong cover variables."}
                        </p>
                      </div>

                      {/* Rec 4: Synergy & Attendance */}
                      <div className="p-3 bg-white/5 border border-white/5 rounded-xl space-y-1 font-mono">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-black text-[10px]">4</span>
                          <span className="text-[10px] font-black uppercase text-gray-300">TEAM COHESION DIRECTIVE</span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-normal">
                          {selectedRosterStats.attendancePct < 85 
                            ? "Commitment re-alignment: Prioritize attendance in scheduled team practices and strategy review boards to ensure execution synchrony." 
                            : selectedRosterStats.swing > 55 
                            ? "In-game captaincy profile: Strong team swing contribution. Enable active mid-round comms and help anchor team mental resilience." 
                            : "Reliable team presence. Work closely on default spacing with teammates, maintaining consistent positional trade lines."}
                        </p>
                      </div>

                    </div>
                  </div>

                  {/* Player-specific Blunders, Chokes & Throws Log */}
                  <div className="space-y-2 pt-2 border-t border-white/5">
                    <h5 className="text-[11px] font-black uppercase text-[#ff4655] tracking-wider font-mono flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Overthrows & Round Blunders Log
                    </h5>
                    <p className="text-[9px] text-gray-400 font-mono pb-2">
                      Live telemetry analysis flags rounds where advantages were conceded. Use this to self-correct and study practice VODs.
                    </p>

                    <div className="overflow-x-auto max-h-[190px] overflow-y-auto border border-white/5 rounded-xl bg-black/15">
                      <table className="w-full text-left border-collapse font-mono text-[10px] text-gray-400">
                        <thead>
                          <tr className="border-b border-white/10 uppercase font-bold text-gray-500 sticky top-0 bg-[#0f1923] z-10">
                            <th className="py-2 px-3">Round #</th>
                            <th className="py-2 px-3">Side</th>
                            <th className="py-2 px-3">Category Error</th>
                            <th className="py-2 px-3">Description of the Blunder</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {selectedRosterStats.playerThrows && selectedRosterStats.playerThrows.map((r: any, rIdx: number) => (
                            <tr key={r.id || rIdx} className="hover:bg-rose-500/5">
                              <td className="py-2 px-3 font-bold text-rose-400">Round {r.roundNo}</td>
                              <td className="py-2 px-3 font-semibold uppercase">{r.side === 'Att' ? 'Attack' : 'Defense'}</td>
                              <td className="py-2 px-3">
                                <span className="p-0.5 px-1.5 rounded bg-[#ff4655]/10 text-[#ff4655] border border-[#ff4655]/20 font-black text-[9px]">
                                  {r.throwReason || 'Poor Decision'}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-gray-200 leading-normal">{r.notes || 'Unforced tactical error recorded in server timeline.'}</td>
                            </tr>
                          ))}
                          {(!selectedRosterStats.playerThrows || selectedRosterStats.playerThrows.length === 0) && (
                            <tr>
                              <td colSpan={4} className="py-8 text-center text-gray-500 font-mono">
                                <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto mb-1.5" />
                                <span>No round overthrows logged for {selectedPlayer}! Outstanding tactical discipline.</span>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              ) : (
                <div className="p-8 text-center bg-black/20 rounded-xl border border-white/5 text-gray-400 font-mono text-xs">
                  Select a player from the Roster table above to compile their Synergy & Discipline scorecard.
                </div>
              )}
            </div>

            {/* COLUMN 2 (4-wide): Map Specific Drilldown */}
            <div className="lg:col-span-4 space-y-6">
              <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4 h-full flex flex-col justify-between`}>
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <BookOpen className={`w-5 h-5 ${theme.text}`} />
                    <h4 className="font-black text-sm uppercase tracking-wide">Map Geometry Drilldown</h4>
                  </div>

                  <div className="space-y-3 font-mono">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-black text-gray-400 block">Active Player</label>
                      <select
                        value={selectedPlayer}
                        onChange={e => setSelectedPlayer(e.target.value)}
                        className="w-full p-2.5 bg-black/20 text-white border border-white/10 rounded-lg text-xs font-bold focus:border-[#ff4655]"
                      >
                        {players.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-black text-gray-400 block">Map Selector</label>
                      <select
                        value={selectedMap}
                        onChange={e => setSelectedMap(e.target.value)}
                        className="w-full p-2.5 bg-black/20 text-white border border-white/10 rounded-lg text-xs font-bold focus:border-[#ff4655]"
                      >
                        <option value="All">All Maps Combined</option>
                        {data.settings.maps.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>

                    <p className="text-[9px] text-gray-400 leading-relaxed">
                      Filters combat ratings, combat scores, and entry indices based on chosen map pools.
                    </p>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/5 space-y-4">
                  {drilldownStats ? (
                    <div className="space-y-3 font-mono">
                      <div className="p-3 bg-black/25 rounded-lg border border-white/5 text-center">
                        <p className="text-[8px] text-gray-500 uppercase font-black">Average Rating on {selectedMap}</p>
                        <p className="text-2xl font-black text-[#ff4655] mt-0.5">{drilldownStats.avgRating}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-center text-[10px]">
                        <div className="p-2 bg-black/15 rounded border border-white/5">
                          <p className="text-[8px] text-gray-500 font-bold uppercase">K/D Ratio</p>
                          <p className="font-black text-emerald-400 text-xs mt-0.5">{drilldownStats.kd}</p>
                        </div>
                        <div className="p-2 bg-black/15 rounded border border-white/5">
                          <p className="text-[8px] text-gray-500 font-bold uppercase">Maps Played</p>
                          <p className="font-black text-gray-300 text-xs mt-0.5">{drilldownStats.played}</p>
                        </div>
                      </div>

                      <div className="p-3 bg-black/15 rounded border border-white/5 space-y-1.5 text-xs text-center">
                        <p className="text-[8px] text-gray-500 uppercase font-black">ACS / ADR / HS% Average</p>
                        <p className="font-black text-gray-200">{drilldownStats.avgAcs} / {drilldownStats.avgAdr} / {drilldownStats.avgHs}%</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-center text-gray-500 text-xs py-6 font-mono">No data logged for parameters.</p>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      ) : (
        /* SOLO QUEUE VIEW */
        <div className="space-y-6 animate-fadeIn">
          {syncError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg font-mono flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              Error syncing Solo Queue MMR: {syncError}
            </div>
          )}

          <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className={`w-5 h-5 ${theme.text}`} />
                <h4 className="font-black text-sm uppercase tracking-wide">Solo Queue Roster Standings</h4>
              </div>
              <span className="text-[10px] text-gray-500 font-mono">Syncs via HenrikDev MMR API</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-gray-500 uppercase font-bold">
                    <th className="py-3 px-3">Player</th>
                    <th className="py-3 px-3">Rank Placement</th>
                    <th className="py-3 px-3 text-center">RR</th>
                    <th className="py-3 px-3 text-center">Games (W - L)</th>
                    <th className="py-3 px-3 text-center">Win Rate %</th>
                    <th className="py-3 px-3 text-center">Last Sync</th>
                    <th className="py-3 px-3 text-right">Riot API Sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {compiledSoloQLeaderboard.map((sq) => {
                    const syncing = syncingMap[sq.player];
                    return (
                      <tr key={sq.player} className="hover:bg-white/5">
                        <td className="py-3.5 px-3 font-bold text-white text-xs">{sq.player}</td>
                        <td className="py-3.5 px-3 font-bold text-gray-300">{sq.rank}</td>
                        <td className="py-3.5 px-3 text-center font-black text-sm text-[#ff4655]">{sq.rr}</td>
                        <td className="py-3.5 px-3 text-center text-gray-400">
                          {sq.games} games (<span className="text-emerald-400">{sq.wins}W</span> - <span className="text-rose-400">{sq.losses}L</span>)
                        </td>
                        <td className="py-3.5 px-3 text-center font-bold text-gray-200">{sq.winRate}%</td>
                        <td className="py-3.5 px-3 text-center text-gray-500">{sq.lastSync}</td>
                        <td className="py-3.5 px-3 text-right">
                          <button
                            onClick={() => handleSyncSoloQ(sq.player)}
                            disabled={syncing}
                            className="p-1 px-2.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-bold text-gray-300 flex items-center gap-1 cursor-pointer disabled:opacity-50 inline-flex ml-auto animate-fadeIn"
                          >
                            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
                            {syncing ? 'Syncing...' : 'Sync'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Last 40 SoloQ logs lists */}
          <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
            <h5 className="font-black text-xs uppercase tracking-widest text-gray-400 font-mono">Solo Queue Games Log history (Last 40)</h5>
            <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
              <table className="w-full text-left border-collapse font-mono text-[10px] text-gray-400">
                <thead>
                  <tr className="border-b border-white/5 uppercase font-bold text-gray-500 sticky top-0 bg-[#0f1923] z-10">
                    <th className="py-2 px-2">Date</th>
                    <th className="py-2 px-2">Player</th>
                    <th className="py-2 px-2">Result Record</th>
                    <th className="py-2 px-2">MMR Rank</th>
                    <th className="py-2 px-2">RR Rating</th>
                    <th className="py-2 px-2">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {last40SoloQ.map((l) => (
                    <tr key={l.id} className="hover:bg-white/5">
                      <td className="py-2 px-2">{l.date}</td>
                      <td className="py-2 px-2 font-bold text-white text-xs">{l.player}</td>
                      <td className="py-2 px-2">
                        <span className="text-emerald-400 font-bold">{l.wins} wins</span>, <span className="text-rose-400 font-bold">{l.losses} losses</span>
                      </td>
                      <td className="py-2 px-2 text-gray-300">{l.rank || 'Immortal'}</td>
                      <td className="py-2 px-2 font-black text-gray-200">{l.rr || '-'}</td>
                      <td className="py-2 px-2 uppercase text-[9px] text-gray-500 font-bold">{l.source || 'manual'}</td>
                    </tr>
                  ))}
                  {last40SoloQ.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-500 font-mono">No solo queue history logged yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

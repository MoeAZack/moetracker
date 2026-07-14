import React, { useMemo } from 'react';
import { TrackerData } from '../types';
import { Award, Layers, Users } from 'lucide-react';

interface ComponentProps {
  data: TrackerData;
  theme: any;
}

export default function TeamCompositions({ data, theme }: ComponentProps) {
  const isLight = data.settings.theme === 'daylight';
  const matches = data.matches || [];
  const playerStats = data.playerStats || [];
  const maps = data.settings.maps || [];
  const agentsList = data.settings.agents || [];

  // --- MAP COMPOSITIONS ANALYTICS ---
  const mapCompositions = useMemo(() => {
    // MapName -> Sorted Composition String -> { wins, losses, agents: [] }
    const comps: Record<string, Record<string, { wins: number; losses: number; agents: string[] }>> = {};

    maps.forEach(m => {
      comps[m] = {};
    });

    matches.forEach((m) => {
      if (!comps[m.map]) return;

      // Find the 5 players stats for this match
      const mStats = playerStats.filter(ps => ps.matchId === m.id);
      if (mStats.length === 0) return;

      // Collect the agents and sort them alphabetically
      const agents = mStats.map(s => s.agent).filter(Boolean).sort();
      if (agents.length === 0) return;

      const compKey = agents.join(', ');
      if (!comps[m.map][compKey]) {
        comps[m.map][compKey] = { wins: 0, losses: 0, agents };
      }

      const won = (m.attW + m.defW) > (m.attL + m.defL);
      if (won) comps[m.map][compKey].wins++;
      else comps[m.map][compKey].losses++;
    });

    return comps;
  }, [maps, matches, playerStats]);

  // --- AGENT PICK RATES & PERFORMANCE ---
  const agentPerformance = useMemo(() => {
    const stats: Record<string, { played: number; wins: number; losses: number }> = {};
    
    agentsList.forEach(a => {
      stats[a] = { played: 0, wins: 0, losses: 0 };
    });

    playerStats.forEach((ps) => {
      if (!ps.agent || !stats[ps.agent]) return;
      const match = matches.find(m => m.id === ps.matchId);
      if (!match) return;

      const s = stats[ps.agent];
      s.played++;
      const won = (match.attW + match.defW) > (match.attL + match.defL);
      if (won) s.wins++;
      else s.losses++;
    });

    const totalMatches = matches.length;

    return Object.entries(stats)
      .map(([agentName, s]) => {
        const wr = s.played > 0 ? (s.wins / s.played) * 100 : 0;
        const pickRate = totalMatches > 0 ? (s.played / (totalMatches * 5)) * 100 : 0; // Out of total individual slot fills (5 slots per match)
        return {
          agent: agentName,
          played: s.played,
          wins: s.wins,
          losses: s.losses,
          winRate: Math.round(wr),
          pickRate: Math.round(pickRate)
        };
      })
      .filter(x => x.played > 0)
      .sort((a, b) => b.played - a.played);
  }, [agentsList, playerStats, matches]);

  return (
    <div className="space-y-6">
      {/* Page description header */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Agent Pick Rates list */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
          <div className="flex items-center gap-2 mb-2">
            <Users className={`w-5 h-5 ${theme.text}`} />
            <h4 className="font-black text-sm uppercase tracking-wide">Individual Agent meta Performance</h4>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-white/10 text-gray-500 uppercase font-bold">
                  <th className="py-2.5 px-3">Agent</th>
                  <th className="py-2.5 px-3 text-center">Played</th>
                  <th className="py-2.5 px-3 text-center">W - L</th>
                  <th className="py-2.5 px-3 text-center">Win Rate %</th>
                  <th className="py-2.5 px-3 text-center">Pick Rate %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {agentPerformance.map((ap) => (
                  <tr key={ap.agent} className="hover:bg-white/5">
                    <td className="py-2.5 px-3 font-bold text-white text-xs">{ap.agent}</td>
                    <td className="py-2.5 px-3 text-center font-bold text-gray-300">{ap.played}</td>
                    <td className="py-2.5 px-3 text-center text-gray-400">
                      <span className="text-emerald-400 font-bold">{ap.wins}W</span> - <span className="text-rose-400 font-bold">{ap.losses}L</span>
                    </td>
                    <td className="py-2.5 px-3 text-center font-black text-sm">
                      <span className={ap.winRate >= 50 ? theme.text : 'text-gray-400'}>{ap.winRate}%</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-gray-400">{ap.pickRate}%</td>
                  </tr>
                ))}
                {agentPerformance.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-gray-500">No agent metrics recorded. Record some matches first!</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Map Compositions details */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
          <div className="flex items-center gap-2 mb-2">
            <Layers className={`w-5 h-5 ${theme.text}`} />
            <h4 className="font-black text-sm uppercase tracking-wide">Compositions by Map</h4>
          </div>

          <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
            {Object.entries(mapCompositions).map(([mapName, comps]) => {
              const compEntries = Object.entries(comps);
              if (compEntries.length === 0) return null;

              return (
                <div key={mapName} className="space-y-2 border-b border-white/5 pb-3">
                  <h5 className="text-xs uppercase font-black text-white font-mono">{mapName}</h5>
                  <div className="space-y-2 font-mono text-[11px]">
                    {compEntries.map(([compKey, c]) => {
                      const total = c.wins + c.losses;
                      const wr = total > 0 ? Math.round((c.wins / total) * 100) : 0;
                      return (
                        <div key={compKey} className="flex justify-between items-center bg-black/10 p-2.5 rounded border border-white/5">
                          <div className="flex flex-wrap gap-1 max-w-[70%]">
                            {c.agents.map((ag) => (
                              <span key={ag} className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5 text-[9px] font-bold text-gray-300">
                                {ag}
                              </span>
                            ))}
                          </div>
                          <div className="text-right text-[10px] shrink-0">
                            <span className="text-emerald-400 font-bold">{c.wins}W</span> - <span className="text-rose-400 font-bold">{c.losses}L</span> 
                            <p className="text-gray-400 font-bold text-[9px]">{wr}% WR ({total} games)</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {Object.values(mapCompositions).every(c => Object.keys(c).length === 0) && (
              <p className="py-10 text-center text-gray-500 font-mono text-xs">No comps logged yet. Add matches to see details!</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

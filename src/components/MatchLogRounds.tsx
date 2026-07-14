import React, { useState, useMemo, useEffect } from 'react';
import { TrackerData, Match, PlayerStats, Round, Veto } from '../types';
import { apiFetch } from '../utils/api';
import { 
  Swords, Plus, Edit2, Trash2, Video, FileText, BarChart3, HelpCircle, 
  Save, Trash, Shuffle, RefreshCw, Zap, Globe, AlertCircle, ShieldAlert, Check,
  Sparkles, Send, Copy, Loader2, ArrowUpRight
} from 'lucide-react';

interface ComponentProps {
  data: TrackerData;
  theme: any;
  onSaveMatch: (match: any, stats: any[]) => Promise<any>;
  onRemove: (sheet: string, id: string) => Promise<any>;
  onSaveRounds: (matchId: string, rows: any[]) => Promise<any>;
  onSaveVeto: (matchId: string, meta: any, actions: any[]) => Promise<any>;
  onRefreshDatabase?: () => Promise<void>;
}

export default function MatchLogRounds({ data, theme, onSaveMatch, onRemove, onSaveRounds, onSaveVeto, onRefreshDatabase }: ComponentProps) {
  const isLight = data.settings.theme === 'daylight';
  
  // --- SUB TAB CONTROL ---
  const [activeTab, setActiveTab] = useState<'matches' | 'rounds' | 'vetos' | 'aiAnalysis'>('matches');

  // --- AI BRIEF & DISCORD BROADCASTER STATE ---
  const [analyzingMatch, setAnalyzingMatch] = useState(false);
  const [aiLoadMsg, setAiLoadMsg] = useState('');
  const [discordBroadcasting, setDiscordBroadcasting] = useState(false);
  const [discordCopyPayload, setDiscordCopyPayload] = useState('');
  const [discordStatusMsg, setDiscordStatusMsg] = useState('');
  const [discordStatusType, setDiscordStatusType] = useState<'success' | 'info' | 'error' | null>(null);
  const [copiedStatus, setCopiedStatus] = useState(false);

  // Selected Match for sub-actions
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);

  // --- API MATCH IMPORT STATE ---
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMethod, setImportMethod] = useState<'vlr' | 'grid'>('grid');
  const [importMatchId, setImportMatchId] = useState('');
  const [importingState, setImportingState] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [importedIdPending, setImportedIdPending] = useState<string | null>(null);

  // Auto-select pending imported match when database updates
  useEffect(() => {
    if (importedIdPending && data.matches && data.matches.length > 0) {
      const found = data.matches.find(m => m.id === importedIdPending || m.vlrMatchId === importedIdPending);
      if (found) {
        setSelectedMatch(found);
        setImportedIdPending(null);
      }
    }
  }, [data.matches, importedIdPending]);

  // --- MODALS ---
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [editingMatch, setEditingMatch] = useState<Partial<Match> | null>(null);
  const [editingStats, setEditingStats] = useState<PlayerStats[]>([]);

  // Modals for Round/Veto editors
  const [roundEditorOpen, setRoundEditorOpen] = useState(false);
  const [vetoEditorOpen, setVetoEditorOpen] = useState(false);

  // Rounds state
  const [activeRounds, setActiveRounds] = useState<Partial<Round>[]>([]);
  // Vetos state
  const [activeVetos, setActiveVetos] = useState<Partial<Veto>[]>([]);

  const matches = data.matches || [];
  const playerStats = data.playerStats || [];
  const players = data.settings.players || [];
  const maps = data.settings.maps || [];
  const agents = data.settings.agents || [];
  const matchTypes = data.settings.matchTypes || [];
  const buyTypes = data.settings.buyTypes || ['Full', 'Half', 'Force', 'Bonus', 'Eco'];
  const winReasons = data.settings.winReasons || ['Elimination', 'Post-plant', 'Defuse', 'Retake', 'Time', 'Spike'];
  const sites = data.settings.sites || ['A', 'B', 'C'];
  const vetoActions = data.settings.vetoActions || ['ban', 'pick', 'decider'];

  // Select a match automatically when opening the view
  useMemo(() => {
    if (matches.length > 0 && !selectedMatch) {
      setSelectedMatch(matches[0]);
    }
  }, [matches, selectedMatch]);

  const statsForSelectedMatch = useMemo(() => {
    if (!selectedMatch) return [];
    return playerStats.filter((ps) => ps.matchId === selectedMatch.id);
  }, [playerStats, selectedMatch]);

  const roundsForSelectedMatch = useMemo(() => {
    if (!selectedMatch) return [];
    return (data.rounds || []).filter((r) => r.matchId === selectedMatch.id).sort((a, b) => a.roundNo - b.roundNo);
  }, [data.rounds, selectedMatch]);

  const vetosForSelectedMatch = useMemo(() => {
    if (!selectedMatch) return [];
    return (data.vetos || []).filter((v) => v.matchId === selectedMatch.id).sort((a, b) => a.seq - b.seq);
  }, [data.vetos, selectedMatch]);

  // --- MATCH MUTATIONS ---
  const handleOpenAddMatch = () => {
    const freshMatch: Partial<Match> = {
      id: '',
      date: new Date().toISOString().slice(0, 10),
      type: 'Scrim',
      opponent: '',
      map: maps[0] || 'Ascent',
      attW: 0,
      attL: 0,
      defW: 0,
      defL: 0,
      pistolAtt: 'W',
      pistolDef: 'W',
      ecoAtt: 'W',
      ecoDef: 'W',
      bonusAtt: 'W',
      bonusDef: 'W',
      vod: '',
      notes: '',
      source: 'manual'
    };
    
    const freshStats = players.map(p => ({
      id: '',
      matchId: '',
      player: p,
      agent: agents[0] || 'Omen',
      kAtt: 0,
      kDef: 0,
      dAtt: 0,
      dDef: 0,
      aAtt: 0,
      aDef: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      acs: 200,
      adr: 140,
      hs: 20,
      fk: 0,
      fd: 0,
      rating: '1.0'
    }));

    setEditingMatch(freshMatch);
    setEditingStats(freshStats);
    setMatchModalOpen(true);
  };

  const handleOpenEditMatch = (m: Match) => {
    setEditingMatch({ ...m });
    const existingStats = playerStats.filter(ps => ps.matchId === m.id);
    
    // Fill in missing roster entries if roster changed
    const mergedStats = players.map(p => {
      const found = existingStats.find(es => es.player === p);
      if (found) return { ...found };
      return {
        id: '',
        matchId: m.id,
        player: p,
        agent: agents[0] || 'Omen',
        kAtt: 0,
        kDef: 0,
        dAtt: 0,
        dDef: 0,
        aAtt: 0,
        aDef: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        acs: 200,
        adr: 140,
        hs: 20,
        fk: 0,
        fd: 0,
        rating: '1.0'
      };
    });

    setEditingStats(mergedStats);
    setMatchModalOpen(true);
  };

  const handleSaveMatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMatch || !editingMatch.opponent) return;

    if (data.settings.confirmOnSave && !window.confirm('Save this match data?')) return;

    // Recalculate totals on PlayerStats
    const finalizedStats = editingStats.map(st => {
      const kills = Number(st.kAtt) + Number(st.kDef);
      const deaths = Number(st.dAtt) + Number(st.dDef);
      const assists = Number(st.aAtt) + Number(st.aDef);
      return { ...st, kills, deaths, assists };
    });

    const res = await onSaveMatch(editingMatch, finalizedStats);
    setMatchModalOpen(false);
    setEditingMatch(null);
    if (res && res.id) {
      setSelectedMatch(res);
    }
  };

  const handleDeleteMatch = async (id: string) => {
    if (data.settings.confirmOnDelete && !window.confirm('Delete this match, round logs, player metrics, and vetoes?')) return;
    await onRemove('Matches', id);
    setSelectedMatch(null);
  };

  // --- ROUND LOG MUTATIONS ---
  const handleOpenRoundEditor = () => {
    if (!selectedMatch) return;
    // Prep 24 rounds or fill existing
    const existing = roundsForSelectedMatch;
    const initialRounds: Partial<Round>[] = [];
    const totalRounds = Math.max(existing.length, selectedMatch.attW + selectedMatch.attL + selectedMatch.defW + selectedMatch.defL, 24);
    
    for (let i = 1; i <= totalRounds; i++) {
      const matchRound = existing.find(r => r.roundNo === i);
      if (matchRound) {
        initialRounds.push({ ...matchRound });
      } else {
        initialRounds.push({
          id: '',
          matchId: selectedMatch.id,
          roundNo: i,
          side: i <= 12 ? 'Att' : 'Def',
          buy: 'Full',
          enemyBuy: 'Full',
          result: 'W',
          winBy: 'Elimination',
          plant: '',
          site: 'A',
          notes: '',
          isThrow: '',
          thrownBy: '',
          throwReason: ''
        });
      }
    }
    setActiveRounds(initialRounds);
    setRoundEditorOpen(true);
  };

  const handleSaveRounds = async () => {
    if (!selectedMatch) return;
    // Clean up empty rows or unused rounds beyond the actual score total
    const cleanRounds = activeRounds.filter(r => r.result === 'W' || r.result === 'L');
    await onSaveRounds(selectedMatch.id, cleanRounds);
    setRoundEditorOpen(false);
  };

  // --- VETO LOG MUTATIONS ---
  const handleOpenVetoEditor = () => {
    if (!selectedMatch) return;
    const existing = vetosForSelectedMatch;
    const initialVetos: Partial<Veto>[] = [];
    const size = Math.max(existing.length, 7); // Usually 7 vetos maximum in best of 3/5
    
    for (let i = 1; i <= size; i++) {
      const v = existing.find(x => x.seq === i);
      if (v) {
        initialVetos.push({ ...v });
      } else {
        initialVetos.push({
          id: '',
          matchId: selectedMatch.id,
          date: selectedMatch.date,
          opponent: selectedMatch.opponent,
          seq: i,
          actor: 'us',
          action: 'ban',
          map: maps[0] || 'Ascent',
          result: ''
        });
      }
    }
    setActiveVetos(initialVetos);
    setVetoEditorOpen(true);
  };

  const handleSaveVetoSubmit = async () => {
    if (!selectedMatch) return;
    const cleanVetos = activeVetos.filter(v => v.map);
    await onSaveVeto(selectedMatch.id, selectedMatch, cleanVetos);
    setVetoEditorOpen(false);
  };

  // --- API IMPORTER MUTATION ---
  const handleImportMatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = importMatchId.trim();
    if (!cleanId) {
      setImportError('Please provide a valid Match or Series ID.');
      return;
    }

    setImportingState(true);
    setImportError(null);
    setImportSuccess(false);

    try {
      const endpoint = importMethod === 'grid' ? '/api/import-grid-match' : '/api/import-vlr-match';
      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId: cleanId })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'The import operation failed.');
      }

      const result = await response.json();
      setImportSuccess(true);
      
      if (result.matchId) {
        setImportedIdPending(result.matchId);
      } else {
        setImportedIdPending(cleanId);
      }

      if (onRefreshDatabase) {
        await onRefreshDatabase();
      }

      setTimeout(() => {
        setImportModalOpen(false);
        setImportMatchId('');
        setImportSuccess(false);
      }, 1500);

    } catch (err: any) {
      setImportError(err.message || 'An error occurred during import.');
    } finally {
      setImportingState(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top action controller row */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Swords className={`w-5 h-5 ${theme.text}`} />
          <h3 className="font-black text-sm tracking-wide uppercase">Scrims & Matches Log</h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-[#ff4655]/10 border border-[#ff4655]/30 hover:bg-[#ff4655]/20 text-[#ff4655] cursor-pointer transition-all font-mono"
          >
            <Zap className="w-3.5 h-3.5" /> API MATCH IMPORTER
          </button>
          
          <button
            onClick={handleOpenAddMatch}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded ${theme.primaryBg} text-white cursor-pointer hover:opacity-90 transition-opacity`}
          >
            <Plus className="w-4 h-4" /> RECORD MATCH
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Side: Match Records Column */}
        <div className="lg:col-span-1 space-y-2 max-h-[750px] overflow-y-auto pr-1">
          {matches
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map((m) => {
              const totalOur = m.attW + m.defW;
              const totalTheir = m.attL + m.defL;
              const won = totalOur > totalTheir;
              const isSelected = selectedMatch?.id === m.id;

              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedMatch(m)}
                  className={`w-full text-left p-3.5 rounded-xl border transition-all flex flex-col gap-2 relative ${
                    isSelected
                      ? isLight ? 'border-slate-800 bg-slate-100 ring-2 ring-slate-100' : 'border-white bg-white/10 ring-2 ring-white/10'
                      : isLight ? 'border-slate-200 bg-white hover:bg-slate-50' : 'border-white/5 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="text-[10px] text-gray-500 font-mono">{m.date}</span>
                    <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase font-mono ${
                      m.type === 'Official' ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-500/10 text-slate-400'
                    }`}>
                      {m.type}
                    </span>
                  </div>

                  <div className="flex justify-between items-baseline">
                    <span className="font-black tracking-tight text-sm truncate max-w-[110px]">{m.opponent}</span>
                    <span className="text-sm font-black font-mono">
                      <span className={won ? 'text-emerald-400' : 'text-rose-400'}>{totalOur}</span>
                      <span className="text-gray-500"> - </span>
                      <span className={won ? 'text-rose-400' : 'text-emerald-400'}>{totalTheir}</span>
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-[10px] font-mono text-gray-400">
                    <span>{m.map}</span>
                    <span className={`px-1.5 py-0.5 rounded-sm ${won ? 'text-emerald-400' : 'text-rose-400'} font-black text-[9px]`}>
                      {won ? 'WIN' : 'LOSS'}
                    </span>
                  </div>
                </button>
              );
            })}
          {matches.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-xs font-mono border border-dashed border-white/10 rounded-xl">
              No matches recorded.
            </div>
          )}
        </div>

        {/* Right Side: Active Selected Match details (Tabs, Tables, Logs) */}
        <div className="lg:col-span-3 space-y-6">
          {selectedMatch ? (
            <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-5`}>
              {/* Selected Match Card Header */}
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-white/5 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase font-mono bg-white/5 ${theme.text}`}>
                      {selectedMatch.type}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">{selectedMatch.date}</span>
                  </div>
                  <h4 className="text-xl font-black mt-1">Vs. {selectedMatch.opponent} on <span className={theme.text}>{selectedMatch.map}</span></h4>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenEditMatch(selectedMatch)}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-xs font-bold font-mono transition-colors"
                  >
                    EDIT MATCH
                  </button>
                  <button
                    onClick={() => handleDeleteMatch(selectedMatch.id)}
                    className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded border border-rose-500/20 text-xs font-bold font-mono transition-colors"
                  >
                    DELETE
                  </button>
                </div>
              </div>

              {/* Match Splittings Indicators Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-black/10 p-4 rounded-xl border border-white/5 text-center font-mono text-xs">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">SCORE</p>
                  <p className="text-lg font-black text-white">{selectedMatch.attW + selectedMatch.defW} - {selectedMatch.attL + selectedMatch.defL}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">ATT SPLIT</p>
                  <p className="text-lg font-black text-amber-500">{selectedMatch.attW}W - {selectedMatch.attL}L</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">DEF SPLIT</p>
                  <p className="text-lg font-black text-cyan-500">{selectedMatch.defW}W - {selectedMatch.defL}L</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">Pistol ATT/DEF</p>
                  <p className="text-lg font-black text-emerald-400">{selectedMatch.pistolAtt} / {selectedMatch.pistolDef}</p>
                </div>
              </div>

              {/* Tabs for details */}
              <div className="flex gap-2 border-b border-white/10 pb-2 flex-wrap">
                {[
                  { id: 'matches', label: 'Player Metrics', icon: BarChart3 },
                  { id: 'rounds', label: 'Round Log', icon: FileText },
                  { id: 'vetos', label: 'Veto', icon: Shuffle },
                  { id: 'aiAnalysis', label: 'AI Coach Brief', icon: Sparkles }
                ].map((tb) => {
                  const Icon = tb.icon;
                  return (
                    <button
                      key={tb.id}
                      onClick={() => setActiveTab(tb.id as any)}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold font-mono uppercase border-b-2 transition-all ${
                        activeTab === tb.id
                          ? 'border-[#ff4655] text-white'
                          : 'border-transparent text-gray-400 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tb.label}
                    </button>
                  );
                })}
              </div>

              {/* TAB CONTENT: PLAYER MATCH STATS */}
              {activeTab === 'matches' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse font-mono text-[11px]">
                    <thead>
                      <tr className="border-b border-white/5 text-gray-500 uppercase font-bold">
                        <th className="py-2 px-2.5">Player</th>
                        <th className="py-2 px-2.5">Agent</th>
                        <th className="py-2 px-2.5 text-center">ACS</th>
                        <th className="py-2 px-2.5 text-center">ADR</th>
                        <th className="py-2 px-2.5 text-center">HS%</th>
                        <th className="py-2 px-2.5 text-center">K / D / A</th>
                        <th className="py-2 px-2.5 text-center">K/D Ratio</th>
                        <th className="py-2 px-2.5 text-center">ATT K/D</th>
                        <th className="py-2 px-2.5 text-center">DEF K/D</th>
                        <th className="py-2 px-2.5 text-center">FB/FD</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {statsForSelectedMatch.map((ps) => {
                        const kd = ps.deaths > 0 ? (ps.kills / ps.deaths).toFixed(2) : ps.kills;
                        const attKd = ps.dAtt > 0 ? (ps.kAtt / ps.dAtt).toFixed(1) : ps.kAtt;
                        const defKd = ps.dDef > 0 ? (ps.kDef / ps.dDef).toFixed(1) : ps.kDef;

                        return (
                          <tr key={ps.id} className="hover:bg-white/5 transition-colors">
                            <td className="py-3 px-2.5 font-bold text-white text-xs">{ps.player}</td>
                            <td className="py-3 px-2.5 text-gray-400">{ps.agent}</td>
                            <td className="py-3 px-2.5 text-center font-bold">{ps.acs || '-'}</td>
                            <td className="py-3 px-2.5 text-center">{ps.adr || '-'}</td>
                            <td className="py-3 px-2.5 text-center text-amber-500">{ps.hs ? `${ps.hs}%` : '-'}</td>
                            <td className="py-3 px-2.5 text-center font-bold">
                              {ps.kills} <span className="text-gray-600">/</span> {ps.deaths} <span className="text-gray-600">/</span> {ps.assists}
                            </td>
                            <td className={`py-3 px-2.5 text-center font-bold ${Number(kd) >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {kd}
                            </td>
                            <td className="py-3 px-2.5 text-center text-amber-500/80">{ps.kAtt}K / {ps.dAtt}D ({attKd})</td>
                            <td className="py-3 px-2.5 text-center text-cyan-400/80">{ps.kDef}K / {ps.dDef}D ({defKd})</td>
                            <td className="py-3 px-2.5 text-center text-gray-400">{ps.fk || 0} / {ps.fd || 0}</td>
                          </tr>
                        );
                      })}
                      {statsForSelectedMatch.length === 0 && (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-gray-500">
                            No player stats logged for this match. Click EDIT MATCH to record them!
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* TAB CONTENT: ROUND LOG */}
              {activeTab === 'rounds' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500 uppercase font-black font-mono">
                      Round Logs ({roundsForSelectedMatch.length} rounds)
                    </span>
                    <button
                      onClick={handleOpenRoundEditor}
                      className="px-2.5 py-1 text-[10px] font-black bg-white/5 border border-white/10 rounded hover:bg-white/10 uppercase font-mono"
                    >
                      EDIT ROUND SHEETS
                    </button>
                  </div>

                  <div className="overflow-x-auto max-h-[450px] overflow-y-auto">
                    <table className="w-full text-left border-collapse font-mono text-[11px]">
                      <thead>
                        <tr className="border-b border-white/5 text-gray-500 uppercase font-bold sticky top-0 bg-[#0f1923] z-10">
                          <th className="py-2 px-2.5">No.</th>
                          <th className="py-2 px-2.5">Side</th>
                          <th className="py-2 px-2.5">Buy</th>
                          <th className="py-2 px-2.5 text-center">Result</th>
                          <th className="py-2 px-2.5">FK / FD</th>
                          <th className="py-2 px-2.5">Clutch Scenario</th>
                          <th className="py-2 px-2.5">Discipline / Throws</th>
                          <th className="py-2 px-2.5">IGL Strategy Caller</th>
                          <th className="py-2 px-2.5 text-center">Plant</th>
                          <th className="py-2 px-2.5 text-center">Site</th>
                          <th className="py-2 px-2.5">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {roundsForSelectedMatch.map((r) => (
                          <tr key={r.id} className="hover:bg-white/5 transition-colors">
                            <td className="py-2 px-2.5 font-bold text-gray-400">{r.roundNo}</td>
                            <td className={`py-2 px-2.5 font-bold ${r.side === 'Att' ? 'text-amber-500' : 'text-cyan-400'}`}>{r.side}</td>
                            <td className="py-2 px-2.5">
                              <span className="text-white font-medium">{r.buy}</span>
                              <span className="text-[9px] text-gray-500 block">vs {r.enemyBuy || 'Full'}</span>
                            </td>
                            <td className="py-2 px-2.5 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                                r.result === 'W' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                              }`}>
                                {r.result}
                              </span>
                            </td>
                            <td className="py-2 px-2.5">
                              <div className="space-y-0.5">
                                {r.firstKillBy && (
                                  <span className="text-emerald-400 block text-[10px]">
                                    ⚔️ FK: <span className="font-bold">{r.firstKillBy}</span>
                                  </span>
                                )}
                                {r.firstDeathBy && (
                                  <span className="text-rose-400 block text-[10px]">
                                    💀 FD: <span className="font-bold">{r.firstDeathBy}</span>
                                  </span>
                                )}
                                {!r.firstKillBy && !r.firstDeathBy && (
                                  <span className="text-gray-600 italic">-</span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-2.5">
                              {r.clutchType ? (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  r.clutchResult === 'W' ? 'bg-amber-500/10 text-amber-400' : 'bg-gray-500/10 text-gray-400'
                                }`}>
                                  {r.clutchPlayer} in {r.clutchType} ({r.clutchResult === 'W' ? 'WON' : 'LOST'})
                                </span>
                              ) : (
                                <span className="text-gray-600 italic">-</span>
                              )}
                            </td>
                            <td className="py-2 px-2.5">
                              {(r.isThrow === 'TRUE' || r.isThrow === true) ? (
                                <span className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-1 px-2 rounded text-[10px] block font-bold" title={r.throwReason}>
                                  ⚠️ Choked: {r.thrownBy || 'Team'} ({r.throwReason || 'Advantage throw'})
                                </span>
                              ) : (
                                <span className="text-emerald-500/80 font-bold text-[10px]">✓ Clean</span>
                              )}
                            </td>
                            <td className="py-2 px-2.5 font-bold">
                              <div className="flex flex-col gap-1">
                                {r.iglPlayer && r.iglPlayer !== 'None' ? (
                                  <span className="text-violet-400 text-[10px] flex items-center gap-1">
                                    <span>{r.iglPlayer} ({r.iglRole || 'Caller'})</span>
                                    {(r.midRoundIglChange === true || r.midRoundIglChange === 'TRUE') && (
                                      <span className="text-[9px] bg-white/5 border border-white/10 px-1 py-0.2 rounded text-white flex items-center gap-0.5" title="Mid-round strategy correction/change">
                                        🔄 Mid
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-gray-600 italic text-[10px]">-</span>
                                )}
                                {r.strategies && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {r.strategies.split(', ').map(st => (
                                      <span key={st} className="bg-violet-500/15 border border-violet-500/20 text-violet-300 text-[8px] px-1.5 py-0.5 rounded font-mono">
                                        🎯 {st}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-2.5 text-center">{r.plant ? 'Yes' : 'No'}</td>
                            <td className="py-2 px-2.5 text-center font-bold">{r.site || '-'}</td>
                            <td className="py-2 px-2.5 text-gray-500 max-w-[150px] truncate" title={r.notes}>{r.notes || '-'}</td>
                          </tr>
                        ))}
                        {roundsForSelectedMatch.length === 0 && (
                          <tr>
                            <td colSpan={11} className="py-8 text-center text-gray-500">
                              No round sheets logged. Use the button above or Live Logger tab to add rounds!
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB CONTENT: VETO LOG */}
              {activeTab === 'vetos' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500 uppercase font-black font-mono">
                      Veto Draft Process ({vetosForSelectedMatch.length} steps)
                    </span>
                    <button
                      onClick={handleOpenVetoEditor}
                      className="px-2.5 py-1 text-[10px] font-black bg-white/5 border border-white/10 rounded hover:bg-white/10 uppercase font-mono"
                    >
                      EDIT VETOES
                    </button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse font-mono text-[11px]">
                      <thead>
                        <tr className="border-b border-white/5 text-gray-500 uppercase font-bold">
                          <th className="py-2 px-2.5">Seq</th>
                          <th className="py-2 px-2.5">Actor</th>
                          <th className="py-2 px-2.5">Action</th>
                          <th className="py-2 px-2.5">Map</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {vetosForSelectedMatch.map((v) => (
                          <tr key={v.id} className="hover:bg-white/5 transition-colors">
                            <td className="py-2 px-2.5 text-gray-400 font-bold">{v.seq}</td>
                            <td className={`py-2 px-2.5 font-bold ${v.actor === 'us' ? theme.text : 'text-gray-400'}`}>
                              {v.actor === 'us' ? 'US' : v.actor === 'them' ? 'OPPONENT' : 'DECIDER'}
                            </td>
                            <td className="py-2 px-2.5 uppercase font-black tracking-tighter">{v.action}</td>
                            <td className="py-2 px-2.5 font-bold text-white text-xs">{v.map}</td>
                          </tr>
                        ))}
                        {vetosForSelectedMatch.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-gray-500">
                              No veto records logged. Use the editor to record the draft sequence!
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB CONTENT: AI COACH BRIEF & BROADCAST */}
              {activeTab === 'aiAnalysis' && (
                <div className="space-y-5 animate-fadeIn">
                  {/* Status Banner */}
                  {discordStatusMsg && (
                    <div className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between gap-3 ${
                      discordStatusType === 'success' 
                        ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                        : discordStatusType === 'error'
                        ? 'bg-red-500/10 border-red-500/20 text-red-400'
                        : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                    }`}>
                      <span>{discordStatusMsg}</span>
                      <button 
                        onClick={() => setDiscordStatusMsg('')} 
                        className="text-[10px] font-bold hover:text-white"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  {/* Manual Copy Area if Webhook Not Configured */}
                  {discordCopyPayload && (
                    <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 space-y-2.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-blue-400 uppercase font-black">Copy Discord Payload</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(discordCopyPayload);
                            setCopiedStatus(true);
                            setTimeout(() => setCopiedStatus(false), 2000);
                          }}
                          className="px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white font-mono text-[9px] uppercase font-black rounded flex items-center gap-1.5 cursor-pointer"
                        >
                          {copiedStatus ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedStatus ? 'Copied!' : 'Copy markdown'}
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-400 font-mono leading-normal">The Discord webhook is not set up in Settings. Copy the markdown report below to paste it manually into your team Discord:</p>
                      <textarea
                        readOnly
                        value={discordCopyPayload}
                        className="w-full bg-black/40 border border-white/10 rounded p-2 text-[9px] font-mono text-gray-400 h-24 focus:outline-none"
                      />
                    </div>
                  )}

                  {/* Actions Header */}
                  <div className="flex justify-between items-center border-b border-white/5 pb-3 gap-2">
                    <span className="text-[10px] text-gray-500 uppercase font-black font-mono">
                      AI Coach Tactical Brief
                    </span>
                    <div className="flex gap-2 shrink-0">
                      <button
                        disabled={analyzingMatch}
                        onClick={async () => {
                          setAnalyzingMatch(true);
                          setDiscordCopyPayload('');
                          setDiscordStatusMsg('');
                          const loadPrompts = [
                            'Analyzing entry conversion rates...',
                            'Reviewing round-throw vectors...',
                            'Evaluating stratbook effectiveness...',
                            'Formulating roster alignment reviews...'
                          ];
                          let idx = 0;
                          setAiLoadMsg(loadPrompts[0]);
                          const interval = setInterval(() => {
                            idx = (idx + 1) % loadPrompts.length;
                            setAiLoadMsg(loadPrompts[idx]);
                          }, 2000);

                          try {
                            const res = await apiFetch('/api/gemini/analyze-match', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ matchId: selectedMatch.id })
                            });
                            if (!res.ok) throw new Error('AI analysis failed.');
                            const resJson = await res.json();
                            
                            // Trigger full parent refresh
                            if (onRefreshDatabase) {
                              await onRefreshDatabase();
                            }
                            
                            // Update our selectedMatch local state ref
                            setSelectedMatch(prev => prev ? { ...prev, aiAnalysis: resJson.aiAnalysis } : null);
                          } catch (err: any) {
                            alert(err.message || 'Failed to analyze match.');
                          } finally {
                            clearInterval(interval);
                            setAnalyzingMatch(false);
                          }
                        }}
                        className="px-2.5 py-1 text-[10px] font-black bg-white/5 border border-white/10 rounded hover:bg-white/10 uppercase font-mono flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                      >
                        {analyzingMatch ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>ANALYZING...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3 text-amber-400" />
                            <span>{selectedMatch.aiAnalysis ? 'REGENERATE' : 'GENERATE ANALYSIS'}</span>
                          </>
                        )}
                      </button>

                      {selectedMatch.aiAnalysis && (
                        <button
                          disabled={discordBroadcasting}
                          onClick={async () => {
                            setDiscordBroadcasting(true);
                            setDiscordStatusMsg('Broadcasting scrim report card to Discord...');
                            setDiscordStatusType('info');
                            try {
                              const res = await apiFetch('/api/broadcast-discord', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ matchId: selectedMatch.id })
                              });
                              if (!res.ok) throw new Error('Broadcasting failed.');
                              const resJson = await res.json();
                              if (resJson.success) {
                                setDiscordStatusMsg('🏆 Scrim report successfully posted to Discord channel!');
                                setDiscordStatusType('success');
                              } else {
                                setDiscordStatusMsg('⚠️ Webhook not configured. Markdown copy payload generated below.');
                                setDiscordStatusType('info');
                                setDiscordCopyPayload(resJson.markdown || '');
                              }
                            } catch (err: any) {
                              setDiscordStatusMsg(`❌ Discord broadcast failed: ${err.message}`);
                              setDiscordStatusType('error');
                            } finally {
                              setDiscordBroadcasting(false);
                            }
                          }}
                          className="px-2.5 py-1 text-[10px] font-black bg-[#ff4655]/10 border border-[#ff4655]/20 hover:bg-[#ff4655] text-white hover:border-[#ff4655] rounded uppercase font-mono flex items-center gap-1.5 cursor-pointer"
                        >
                          {discordBroadcasting ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Send className="w-3 h-3" />
                          )}
                          <span>DISCORD</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Brief View Body */}
                  {analyzingMatch ? (
                    <div className="py-12 text-center space-y-3.5 border border-dashed border-white/5 rounded-xl bg-black/10">
                      <div className="w-8 h-8 mx-auto rounded-full bg-[#ff4655]/10 flex items-center justify-center text-[#ff4655]">
                        <Loader2 className="w-4 h-4 animate-spin" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-white font-mono uppercase tracking-wider">Scrim Analyst Engine Active</p>
                        <p className="text-[10px] text-gray-500 font-mono animate-pulse">{aiLoadMsg}</p>
                      </div>
                    </div>
                  ) : selectedMatch.aiAnalysis ? (
                    <div className="p-5 rounded-xl border border-white/5 bg-black/25 text-left max-h-[500px] overflow-y-auto space-y-2 select-text">
                      {selectedMatch.aiAnalysis.split('\n').map((line, idx) => {
                        const cleanLine = line.trim();
                        if (cleanLine.startsWith('###')) {
                          return <h5 key={idx} className="text-xs font-black text-violet-400 mt-4 mb-2 uppercase font-mono tracking-wide">{cleanLine.replace('###', '').replace(/[\*#]/g, '').trim()}</h5>;
                        }
                        if (cleanLine.startsWith('##')) {
                          return <h4 key={idx} className="text-xs font-black text-white mt-5 mb-2 uppercase border-b border-white/5 pb-1 tracking-tight font-mono">{cleanLine.replace('##', '').replace(/[\*#]/g, '').trim()}</h4>;
                        }
                        if (cleanLine.startsWith('#')) {
                          return <h3 key={idx} className="text-sm font-black text-[#ff4655] mt-6 mb-3 uppercase tracking-tighter italic font-mono">{cleanLine.replace('#', '').replace(/[\*#]/g, '').trim()}</h3>;
                        }
                        if (cleanLine.startsWith('-') || cleanLine.startsWith('*')) {
                          const content = cleanLine.substring(1).trim();
                          const parts = content.split('**');
                          return (
                            <div key={idx} className="flex items-start gap-2 text-[11px] font-mono text-gray-300 leading-relaxed my-1.5 pl-2">
                              <span className="text-[#ff4655] select-none font-sans">▪</span>
                              <span>
                                {parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-white font-black">{part}</strong> : part)}
                              </span>
                            </div>
                          );
                        }
                        if (cleanLine === '') {
                          return <div key={idx} className="h-1.5" />;
                        }
                        const parts = cleanLine.split('**');
                        return (
                          <p key={idx} className="text-[11px] font-mono text-gray-300 leading-relaxed my-1">
                            {parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-white font-black">{part}</strong> : part)}
                          </p>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-12 text-center space-y-4 border border-dashed border-white/5 bg-black/10 rounded-xl">
                      <div className="w-10 h-10 mx-auto rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center">
                        <Sparkles className="w-5 h-5 animate-pulse" />
                      </div>
                      <div className="max-w-xs mx-auto space-y-1">
                        <p className="text-xs font-black text-white uppercase tracking-tight">Generate Scrim Report Card</p>
                        <p className="text-[10px] text-gray-500 leading-relaxed font-mono">Dissect round logs, space conversions, economic efficiency, throw triggers, and caller reviews automatically with Gemini.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="py-20 text-center text-gray-500 font-mono text-xs border border-dashed border-white/10 rounded-2xl">
              No match selected. Select a match on the left panel or record a new one.
            </div>
          )}
        </div>
      </div>

      {/* --- MATCH LOG MODAL --- */}
      {matchModalOpen && editingMatch && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto animate-fadeIn">
          <form onSubmit={handleSaveMatchSubmit} className={`w-full max-w-4xl p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-6 max-h-[90vh] overflow-y-auto`}>
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h4 className="text-lg font-black tracking-tight uppercase">
                {editingMatch.id ? 'EDIT MATCH DATA' : 'RECORD SCRIM/MATCH'}
              </h4>
              <button
                type="button"
                onClick={() => setMatchModalOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            {/* General details */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Date</label>
                <input
                  type="date"
                  required
                  value={editingMatch.date}
                  onChange={e => setEditingMatch({ ...editingMatch, date: e.target.value })}
                  className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs font-mono text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Match Type</label>
                <select
                  value={editingMatch.type}
                  onChange={e => setEditingMatch({ ...editingMatch, type: e.target.value })}
                  className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs text-white"
                >
                  {matchTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Opponent Team</label>
                <input
                  type="text"
                  required
                  placeholder="Opponent name"
                  value={editingMatch.opponent}
                  onChange={e => setEditingMatch({ ...editingMatch, opponent: e.target.value })}
                  className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Map Selected</label>
                <select
                  value={editingMatch.map}
                  onChange={e => setEditingMatch({ ...editingMatch, map: e.target.value })}
                  className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs text-white"
                >
                  {maps.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {/* Score splits */}
            <div className="space-y-2 border-y border-white/5 py-4">
              <h5 className="text-xs uppercase font-black tracking-widest text-gray-400 font-mono">Round Splits & Results</h5>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-amber-500 font-mono">ATT Wins</label>
                  <input
                    type="number"
                    min={0}
                    value={editingMatch.attW}
                    onChange={e => setEditingMatch({ ...editingMatch, attW: Number(e.target.value) })}
                    className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs font-mono text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-amber-500 font-mono">ATT Losses</label>
                  <input
                    type="number"
                    min={0}
                    value={editingMatch.attL}
                    onChange={e => setEditingMatch({ ...editingMatch, attL: Number(e.target.value) })}
                    className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs font-mono text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-cyan-400 font-mono">DEF Wins</label>
                  <input
                    type="number"
                    min={0}
                    value={editingMatch.defW}
                    onChange={e => setEditingMatch({ ...editingMatch, defW: Number(e.target.value) })}
                    className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs font-mono text-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-cyan-400 font-mono">DEF Losses</label>
                  <input
                    type="number"
                    min={0}
                    value={editingMatch.defL}
                    onChange={e => setEditingMatch({ ...editingMatch, defL: Number(e.target.value) })}
                    className="w-full p-2 bg-black/20 rounded border border-white/10 text-xs font-mono text-white"
                  />
                </div>
              </div>

              {/* Special Indicator Rows (Pistol, Eco, Bonus) */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 pt-2 text-xs font-mono">
                {['pistolAtt', 'pistolDef', 'ecoAtt', 'ecoDef', 'bonusAtt', 'bonusDef'].map((indKey) => (
                  <div key={indKey} className="space-y-1">
                    <span className="text-[9px] uppercase font-bold text-gray-500 block truncate">{indKey}</span>
                    <select
                      value={(editingMatch as any)[indKey]}
                      onChange={e => setEditingMatch({ ...editingMatch, [indKey]: e.target.value })}
                      className="w-full p-1.5 bg-black/25 text-white border border-white/10 rounded"
                    >
                      <option value="W">W (Won)</option>
                      <option value="L">L (Lost)</option>
                      <option value="">N/A</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Player Performance inputs */}
            <div className="space-y-3">
              <h5 className="text-xs uppercase font-black tracking-widest text-gray-400 font-mono border-b border-white/5 pb-1">
                Individual Performance Metrics
              </h5>
              <div className="space-y-3">
                {editingStats.map((st, sIdx) => (
                  <div key={sIdx} className="grid grid-cols-2 sm:grid-cols-11 gap-2 bg-black/10 p-3 rounded-lg border border-white/5 items-center font-mono text-[10px] text-white">
                    <div className="sm:col-span-2 font-black text-xs truncate text-white">{st.player}</div>
                    
                    {/* Agent select */}
                    <div className="sm:col-span-2">
                      <select
                        value={st.agent}
                        onChange={(e) => {
                          const updated = [...editingStats];
                          updated[sIdx].agent = e.target.value;
                          setEditingStats(updated);
                        }}
                        className="w-full p-1 bg-black text-white border border-white/10 rounded"
                      >
                        {agents.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>

                    {/* Numeric fields */}
                    {[
                      { label: 'ACS', key: 'acs' },
                      { label: 'ADR', key: 'adr' },
                      { label: 'HS%', key: 'hs' },
                      { label: 'ATT K', key: 'kAtt' },
                      { label: 'ATT D', key: 'dAtt' },
                      { label: 'DEF K', key: 'kDef' },
                      { label: 'DEF D', key: 'dDef' }
                    ].map((f) => (
                      <div key={f.key}>
                        <span className="text-[8px] text-gray-500 uppercase block">{f.label}</span>
                        <input
                          type="number"
                          value={(st as any)[f.key] || 0}
                          onChange={(e) => {
                            const updated = [...editingStats];
                            (updated[sIdx] as any)[f.key] = Number(e.target.value);
                            setEditingStats(updated);
                          }}
                          className="w-full p-1 bg-black/40 text-center border border-white/5 rounded text-white"
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setMatchModalOpen(false)}
                className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white font-mono"
              >
                CANCEL
              </button>
              <button
                type="submit"
                className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white font-mono`}
              >
                SAVE MATCH DETAILS
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- ROUND LOG SHEET EDITOR --- */}
      {roundEditorOpen && selectedMatch && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className={`w-full max-w-6xl p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-4 max-h-[90vh] overflow-y-auto`}>
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <div>
                <h4 className="text-lg font-black tracking-tight uppercase">Round Log Sheets</h4>
                <p className="text-xs text-gray-400 font-mono">Vs. {selectedMatch.opponent} on {selectedMatch.map}</p>
              </div>
              <button
                onClick={() => setRoundEditorOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            {/* Scrollable table grid */}
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-1">
              <table className="w-full text-left border-collapse font-mono text-[10px]">
                <thead>
                  <tr className="border-b border-white/10 text-gray-500 uppercase font-bold sticky top-0 bg-[#0f1923] z-10">
                    <th className="py-2 px-1">Round</th>
                    <th className="py-2 px-1">Side</th>
                    <th className="py-2 px-1">Buy</th>
                    <th className="py-2 px-1">Enemy Buy</th>
                    <th className="py-2 px-1 text-center">Result</th>
                    <th className="py-2 px-1">Win/Loss Reason</th>
                    <th className="py-2 px-1 text-center">Planted</th>
                    <th className="py-2 px-1 text-center">Site</th>
                    <th className="py-2 px-1 text-center text-[#ff4655]">Throw?</th>
                    <th className="py-2 px-1 text-gray-300">Overpeeker / Throwers</th>
                    <th className="py-2 px-1 text-gray-300">Error Reason</th>
                    <th className="py-2 px-1 text-gray-300">Strategies Run</th>
                    <th className="py-2 px-2">Round Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {activeRounds.map((r, index) => (
                    <tr key={index} className="hover:bg-white/5">
                      <td className="py-2 px-1 font-bold text-gray-400 text-xs">#{r.roundNo}</td>
                      <td className="py-1 px-1">
                        <select
                          value={r.side}
                          onChange={(e) => {
                            const updated = [...activeRounds];
                            updated[index].side = e.target.value;
                            setActiveRounds(updated);
                          }}
                          className="bg-black text-[10px] p-1 rounded text-white"
                        >
                          <option value="Att">Att</option>
                          <option value="Def">Def</option>
                        </select>
                      </td>
                      <td className="py-1 px-1">
                        <select
                          value={r.buy}
                          onChange={(e) => {
                            const updated = [...activeRounds];
                            updated[index].buy = e.target.value;
                            setActiveRounds(updated);
                          }}
                          className="bg-black text-[10px] p-1 rounded text-white"
                        >
                          {buyTypes.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="py-1 px-1">
                        <select
                          value={r.enemyBuy}
                          onChange={(e) => {
                            const updated = [...activeRounds];
                            updated[index].enemyBuy = e.target.value;
                            setActiveRounds(updated);
                          }}
                          className="bg-black text-[10px] p-1 rounded text-white"
                        >
                          {buyTypes.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="py-1 px-1 text-center">
                        <select
                          value={r.result}
                          onChange={(e) => {
                            const updated = [...activeRounds];
                            updated[index].result = e.target.value;
                            setActiveRounds(updated);
                          }}
                          className={`bg-black text-[10px] font-black p-1 rounded ${r.result === 'W' ? 'text-emerald-400' : 'text-rose-400'}`}
                        >
                          <option value="W">W</option>
                          <option value="L">L</option>
                          <option value="">-</option>
                        </select>
                      </td>
                      <td className="py-1 px-1">
                        <select
                          value={r.winBy}
                          onChange={(e) => {
                            const updated = [...activeRounds];
                            updated[index].winBy = e.target.value;
                            setActiveRounds(updated);
                          }}
                          className="bg-black text-[10px] p-1 rounded text-white"
                        >
                          {winReasons.map(rs => <option key={rs} value={rs}>{rs}</option>)}
                        </select>
                      </td>
                      <td className="py-1 px-1 text-center">
                        <input
                          type="checkbox"
                          checked={r.plant === 'TRUE' || !!r.plant}
                          onChange={(e) => {
                            const updated = [...activeRounds];
                            updated[index].plant = e.target.checked ? 'TRUE' : '';
                            setActiveRounds(updated);
                          }}
                          className="rounded"
                        />
                      </td>
                      <td className="py-1 px-1 text-center">
                        <select
                          value={r.site}
                          onChange={(e) => {
                            const updated = [...activeRounds];
                            updated[index].site = e.target.value;
                            setActiveRounds(updated);
                          }}
                          className="bg-black text-[10px] p-1 rounded text-white font-bold"
                        >
                          <option value="">-</option>
                          {sites.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="py-1 px-1 text-center">
                        <input
                          type="checkbox"
                          checked={r.isThrow === 'TRUE' || !!r.isThrow}
                          onChange={(e) => {
                            const updated = [...activeRounds];
                            updated[index].isThrow = e.target.checked ? 'TRUE' : '';
                            setActiveRounds(updated);
                          }}
                          className="rounded accent-rose-500"
                        />
                      </td>
                      <td className="py-1 px-1">
                        <div className="relative group">
                          <input
                            type="text"
                            value={r.thrownBy || ''}
                            onChange={(e) => {
                              const updated = [...activeRounds];
                              updated[index].thrownBy = e.target.value;
                              setActiveRounds(updated);
                            }}
                            placeholder="Select/type..."
                            className="bg-black text-[10px] p-1 rounded text-white w-[100px] border border-white/10"
                          />
                          <div className="hidden group-hover:block hover:block absolute left-0 bottom-full bg-slate-900 border border-slate-700 p-2.5 rounded shadow-xl z-50 space-y-1.5 w-[140px]">
                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Quick Select</p>
                            {players.map(p => {
                              const currentList = r.thrownBy ? r.thrownBy.split(', ').filter(Boolean) : [];
                              const isChecked = currentList.includes(p);
                              return (
                                <label key={p} className="flex items-center gap-1.5 cursor-pointer text-[10px] text-white hover:text-rose-400">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      let newList;
                                      if (isChecked) {
                                        newList = currentList.filter(x => x !== p);
                                      } else {
                                        newList = [...currentList, p];
                                      }
                                      const updated = [...activeRounds];
                                      updated[index].thrownBy = newList.join(', ');
                                      setActiveRounds(updated);
                                    }}
                                    className="rounded accent-rose-500 scale-90"
                                  />
                                  <span>{p}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                      <td className="py-1 px-1">
                        <select
                          value={r.throwReason || ''}
                          onChange={(e) => {
                            const updated = [...activeRounds];
                            updated[index].throwReason = e.target.value;
                            setActiveRounds(updated);
                          }}
                          className="bg-black text-[10px] p-1 rounded text-white max-w-[120px]"
                        >
                          <option value="">-</option>
                          <option value="Overpeeking">Overpeeking</option>
                          <option value="Failed Clutch">Failed Clutch</option>
                          <option value="Failed Post-plant">Failed Post-plant</option>
                          <option value="C9 / Time Defuse">C9 / Time Defuse</option>
                          <option value="Lost Advantage">Lost Advantage</option>
                          <option value="Poor Eco Buy">Poor Eco Buy</option>
                          <option value="Missed Utility">Missed Utility</option>
                          <option value="Failed Retake">Failed Retake</option>
                        </select>
                      </td>
                      <td className="py-1 px-1">
                        <div className="relative group">
                          <input
                            type="text"
                            value={r.strategies || ''}
                            onChange={(e) => {
                              const updated = [...activeRounds];
                              updated[index].strategies = e.target.value;
                              setActiveRounds(updated);
                            }}
                            placeholder="No strat..."
                            className="bg-black text-[10px] p-1 rounded text-white w-[110px] border border-white/10"
                          />
                          <div className="hidden group-hover:block hover:block absolute right-0 bottom-full bg-slate-900 border border-slate-700 p-2.5 rounded shadow-xl z-50 space-y-1.5 w-[160px] max-h-[160px] overflow-y-auto">
                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Map Strategies</p>
                            {((data.strats || []).filter(s => s.map === selectedMatch.map)).map(st => {
                              const currentList = r.strategies ? r.strategies.split(', ').filter(Boolean) : [];
                              const isChecked = currentList.includes(st.name);
                              return (
                                <label key={st.id} className="flex items-start gap-1.5 cursor-pointer text-[10px] text-white hover:text-violet-400">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      let newList;
                                      if (isChecked) {
                                        newList = currentList.filter(x => x !== st.name);
                                      } else {
                                        newList = [...currentList, st.name];
                                      }
                                      const updated = [...activeRounds];
                                      updated[index].strategies = newList.join(', ');
                                      setActiveRounds(updated);
                                    }}
                                    className="rounded accent-violet-500 scale-90 mt-0.5"
                                  />
                                  <span className="leading-tight">{st.name} ({st.side})</span>
                                </label>
                              );
                            })}
                            {((data.strats || []).filter(s => s.map === selectedMatch.map)).length === 0 && (
                              <p className="text-[9px] text-gray-500 italic">No strategies defined for {selectedMatch.map}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="text"
                          placeholder="Quick note"
                          value={r.notes || ''}
                          onChange={(e) => {
                            const updated = [...activeRounds];
                            updated[index].notes = e.target.value;
                            setActiveRounds(updated);
                          }}
                          className="w-full bg-black/40 border border-white/5 rounded p-1 text-white text-[10px]"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center border-t border-white/10 pt-4">
              <span className="text-xs text-gray-500 font-mono">Unused or blank result rows will be discarded on save.</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setRoundEditorOpen(false)}
                  className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white font-mono"
                >
                  CANCEL
                </button>
                <button
                  onClick={handleSaveRounds}
                  className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white flex items-center gap-1 font-mono`}
                >
                  <Save className="w-4 h-4" /> SAVE ROUNDS
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- VETO LOG EDITOR --- */}
      {vetoEditorOpen && selectedMatch && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className={`w-full max-w-xl p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-4`}>
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <div>
                <h4 className="text-lg font-black tracking-tight uppercase">Veto Draft log</h4>
                <p className="text-xs text-gray-400 font-mono">Vs. {selectedMatch.opponent}</p>
              </div>
              <button
                onClick={() => setVetoEditorOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 max-h-[350px] overflow-y-auto">
              {activeVetos.map((v, index) => (
                <div key={index} className="grid grid-cols-4 gap-2 bg-black/25 p-2 rounded border border-white/5 items-center font-mono text-[10px]">
                  <div className="text-gray-400 font-bold">Step {v.seq}</div>
                  
                  <select
                    value={v.actor}
                    onChange={(e) => {
                      const updated = [...activeVetos];
                      updated[index].actor = e.target.value;
                      setActiveVetos(updated);
                    }}
                    className="bg-black p-1 text-white rounded"
                  >
                    <option value="us">US (Pick/Ban)</option>
                    <option value="them">OPPONENT</option>
                    <option value="">DECIDER</option>
                  </select>

                  <select
                    value={v.action}
                    onChange={(e) => {
                      const updated = [...activeVetos];
                      updated[index].action = e.target.value;
                      setActiveVetos(updated);
                    }}
                    className="bg-black p-1 text-white rounded uppercase font-bold"
                  >
                    {vetoActions.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>

                  <select
                    value={v.map}
                    onChange={(e) => {
                      const updated = [...activeVetos];
                      updated[index].map = e.target.value;
                      setActiveVetos(updated);
                    }}
                    className="bg-black p-1 text-white rounded font-bold"
                  >
                    <option value="">- Select Map -</option>
                    {maps.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
              <button
                onClick={() => setVetoEditorOpen(false)}
                className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white font-mono"
              >
                CANCEL
              </button>
              <button
                onClick={handleSaveVetoSubmit}
                className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white flex items-center gap-1 font-mono`}
              >
                <Save className="w-4 h-4" /> SAVE VETOES
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- DUAL METHOD API MATCH IMPORTER MODAL --- */}
      {importModalOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className={`w-full max-w-lg p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-5`}>
            
            {/* Header */}
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#ff4655]" />
                <div>
                  <h4 className="text-sm font-black tracking-wider uppercase font-mono">VALORANT Match Importer</h4>
                  <p className="text-[10px] text-gray-400 font-mono">Integrated Analytics Data Ingestion Engine</p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!importingState) {
                    setImportModalOpen(false);
                    setImportError(null);
                  }
                }}
                disabled={importingState}
                className="text-gray-400 hover:text-white font-bold disabled:opacity-30"
              >
                ✕
              </button>
            </div>

            {/* Importer Form */}
            <form onSubmit={handleImportMatchSubmit} className="space-y-4">
              
              {/* Method Selector */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono block">Select Ingestion Pipeline</label>
                <div className="grid grid-cols-2 gap-3 font-mono">
                  {/* GRID Option */}
                  <button
                    type="button"
                    onClick={() => setImportMethod('grid')}
                    disabled={importingState}
                    className={`p-3 rounded-lg border text-left transition-all relative flex flex-col gap-1.5 cursor-pointer ${
                      importMethod === 'grid'
                        ? 'border-rose-500 bg-rose-500/10 text-white'
                        : 'border-white/5 bg-black/20 text-gray-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Zap className={`w-4 h-4 ${importMethod === 'grid' ? 'text-rose-400' : 'text-gray-500'}`} />
                      <span className="text-xs font-black uppercase">GRID.GG API</span>
                    </div>
                    <span className="text-[9px] text-gray-500 leading-tight">Imports live round events, economics & auto-detects player overthrows.</span>
                    {importMethod === 'grid' && (
                      <span className="absolute top-2 right-2 bg-rose-500 text-white font-black text-[8px] px-1 rounded">ACTIVE</span>
                    )}
                  </button>

                  {/* VLR Option */}
                  <button
                    type="button"
                    onClick={() => setImportMethod('vlr')}
                    disabled={importingState}
                    className={`p-3 rounded-lg border text-left transition-all relative flex flex-col gap-1.5 cursor-pointer ${
                      importMethod === 'vlr'
                        ? 'border-cyan-500 bg-cyan-500/10 text-white'
                        : 'border-white/5 bg-black/20 text-gray-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Globe className={`w-4 h-4 ${importMethod === 'vlr' ? 'text-cyan-400' : 'text-gray-500'}`} />
                      <span className="text-xs font-black uppercase">VLR.GG API</span>
                    </div>
                    <span className="text-[9px] text-gray-500 leading-tight">Imports global match scores, roster ratings, map drafts & veto phases.</span>
                    {importMethod === 'vlr' && (
                      <span className="absolute top-2 right-2 bg-cyan-500 text-white font-black text-[8px] px-1 rounded">ACTIVE</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Match ID Input */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono block">
                  {importMethod === 'grid' ? 'GRID Series / Match ID' : 'VLR Match ID'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    disabled={importingState}
                    placeholder={importMethod === 'grid' ? "e.g. series-1829 or 3091" : "e.g. 10928 or 11255"}
                    value={importMatchId}
                    onChange={(e) => setImportMatchId(e.target.value)}
                    className="w-full p-2.5 bg-black/40 text-white rounded-lg border border-white/10 text-xs font-mono placeholder-gray-600 focus:border-[#ff4655]"
                  />
                </div>
                <p className="text-[9px] text-gray-500 font-mono leading-relaxed">
                  {importMethod === 'grid' 
                    ? "Connects directly to Riot Games' telemetry system to extract performance matrices and flag throws."
                    : "Parses match stats, map drafts, scorelines, and player KDA values from competitive public endpoints."}
                </p>
              </div>

              {/* Status & Loader */}
              {importingState && (
                <div className="p-4 bg-black/35 rounded-xl border border-white/5 font-mono text-[10px] text-gray-300 space-y-2">
                  <div className="flex items-center gap-2 text-rose-400 font-bold animate-pulse">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>INGESTING REAL-TIME ESPORTS DATA...</span>
                  </div>
                  <div className="space-y-1 text-gray-500 text-[9px]">
                    <p className="text-emerald-400">✓ Connected to secure API gateway.</p>
                    <p className="text-emerald-400">✓ Verified client-key handshake header.</p>
                    <p className="text-emerald-400 animate-pulse">🔄 Analyzing rounds, combat timelines, and overthrows...</p>
                    <p>⏳ Syncing data with database JSON storage...</p>
                  </div>
                </div>
              )}

              {/* Feedback messages */}
              {importError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg font-mono flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Import failed: {importError}</span>
                </div>
              )}

              {importSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-lg font-mono flex items-center gap-2">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>Match ingested and parsed successfully! Synchronizing interface...</span>
                </div>
              )}

              {/* Form buttons */}
              {!importingState && !importSuccess && (
                <div className="flex justify-end gap-2 border-t border-white/5 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setImportModalOpen(false);
                      setImportError(null);
                    }}
                    className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white font-mono"
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded text-white font-mono flex items-center gap-1.5`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    START INGESTION
                  </button>
                </div>
              )}

            </form>

          </div>
        </div>
      )}
    </div>
  );
}

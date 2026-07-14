import React, { useState, useMemo } from 'react';
import { TrackerData, Match, PlayerStats, Round } from '../types';
import { 
  Zap, Swords, Compass, Users, Activity, Play, Plus, Trash2, 
  CheckCircle2, AlertTriangle, Shield, Award, Sparkles, Trophy, 
  ChevronRight, X, Check, FileText, Sliders, RefreshCw
} from 'lucide-react';

interface ComponentProps {
  data: TrackerData;
  theme: any;
  onSaveMatch: (match: any, stats: any[]) => Promise<any>;
  onSaveRounds: (matchId: string, rows: any[]) => Promise<any>;
  onRefreshDatabase: () => Promise<void>;
  setActiveTab: (tab: any) => void;
  onUpsert: (sheet: string, row: any) => Promise<any>;
}

export default function LiveLogger({ data, theme, onSaveMatch, onSaveRounds, onRefreshDatabase, setActiveTab, onUpsert }: ComponentProps) {
  const isLight = data.settings.theme === 'daylight';
  
  // Available settings
  const mapsList = data.settings.maps || [];
  const playersList = data.settings.players || [];
  const matchTypes = data.settings.matchTypes || ['Scrim', 'Official', 'Tournament', 'Practice'];
  const buyTypes = data.settings.buyTypes || ['Full', 'Half', 'Eco', 'Force', 'Bonus'];
  const winReasons = data.settings.winReasons || ['Elimination', 'Post-plant', 'Retake', 'Time', 'Defuse', 'Clutch'];
  const sitesList = data.settings.sites || ['A', 'B', 'C'];

  // --- STATE FOR LIVE SESSION ---
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionMatch, setSessionMatch] = useState<Match | null>(null);
  const [liveRounds, setLiveRounds] = useState<Partial<Round>[]>([]);
  
  // Pre-session Form States
  const [opponent, setOpponent] = useState('');
  const [selectedMap, setSelectedMap] = useState(mapsList[0] || 'Ascent');
  const [matchType, setMatchType] = useState('Scrim');
  const [activeRoster, setActiveRoster] = useState<string[]>(() => playersList.slice(0, 5));
  const [agentsMap, setAgentsMap] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    playersList.forEach((p, idx) => {
      init[p] = data.settings.agents[idx % data.settings.agents.length] || 'Omen';
    });
    return init;
  });
  const [primaryIgl, setPrimaryIgl] = useState('');
  const [secondaryIgl, setSecondaryIgl] = useState('');

  // Active Round Form States
  const [currentRoundNo, setCurrentRoundNo] = useState(1);
  const [roundSide, setRoundSide] = useState<'Att' | 'Def'>('Att');
  const [ourBuy, setOurBuy] = useState('Full');
  const [enemyBuy, setEnemyBuy] = useState('Full');
  const [roundResult, setRoundResult] = useState<'W' | 'L'>('W');
  const [roundWinBy, setRoundWinBy] = useState('Elimination');
  const [isPlanted, setIsPlanted] = useState(false);
  const [selectedSite, setSelectedSite] = useState('A');
  const [roundNotes, setRoundNotes] = useState('');
  
  // Live FK/FD inputs
  const [firstKillBy, setFirstKillBy] = useState<string>(''); // Player Name or 'Enemy' or 'None'
  const [firstDeathBy, setFirstDeathBy] = useState<string>(''); // Player Name or 'Enemy' or 'None'

  // Live Clutch inputs
  const [clutchType, setClutchType] = useState<string>(''); // '', '1v1', '1v2', '1v3'
  const [clutchPlayer, setClutchPlayer] = useState<string>('');
  const [clutchResult, setClutchResult] = useState<'W' | 'L'>('W');

  // Live Discipline inputs
  const [isThrow, setIsThrow] = useState(false);
  const [thrownBy, setThrownBy] = useState('');
  const [thrownByPlayers, setThrownByPlayers] = useState<string[]>([]);
  const [throwReason, setThrowReason] = useState('');

  // Live IGL Strategy inputs
  const [activeIglCaller, setActiveIglCaller] = useState<string>('Primary'); // 'Primary', 'Secondary', or 'None'
  const [midRoundIglChange, setMidRoundIglChange] = useState(false);
  const [selectedStrats, setSelectedStrats] = useState<string[]>([]); // Strategy IDs
  const [newStratName, setNewStratName] = useState('');

  // Scoreboard Finalization modal
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [finalPlayerStats, setFinalPlayerStats] = useState<PlayerStats[]>([]);

  // Feedback Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  // Pre-populate agents default list when roster changes
  const handleToggleRoster = (player: string) => {
    if (activeRoster.includes(player)) {
      if (activeRoster.length <= 1) return; // keep at least 1
      setActiveRoster(activeRoster.filter(p => p !== player));
    } else {
      if (activeRoster.length >= 5) {
        showToast('Roster is typically capped at 5 active players.');
      }
      setActiveRoster([...activeRoster, player]);
    }
  };

  const handleAgentChange = (player: string, agent: string) => {
    setAgentsMap(prev => ({ ...prev, [player]: agent }));
  };

  // --- BOOT LIVE MATCH ---
  const handleStartLiveMatch = async () => {
    if (!opponent.trim()) {
      alert('Please enter an opponent team name.');
      return;
    }
    if (activeRoster.length === 0) {
      alert('Please select at least 1 player on the roster.');
      return;
    }

    const initialMatch: Partial<Match> = {
      date: new Date().toISOString().split('T')[0],
      type: matchType,
      opponent: opponent.trim(),
      map: selectedMap,
      attW: 0,
      attL: 0,
      defW: 0,
      defL: 0,
      pistolAtt: 'L',
      pistolDef: 'L',
      ecoAtt: 'L',
      ecoDef: 'L',
      bonusAtt: 'L',
      bonusDef: 'L',
      notes: `Live session with Primary IGL: ${primaryIgl || 'None'}, Secondary IGL: ${secondaryIgl || 'None'}.`,
      source: 'live-logger'
    };

    try {
      // Create empty Match object on backend to obtain ID
      // Initialize zero-filled player stats on starting agents
      const initialStats = activeRoster.map(p => ({
        player: p,
        agent: agentsMap[p] || 'Omen',
        kAtt: 0, kDef: 0, dAtt: 0, dDef: 0, aAtt: 0, aDef: 0,
        kills: 0, deaths: 0, assists: 0, acs: 0, adr: 0, hs: 0,
        fk: 0, fd: 0, rating: '1.0'
      }));

      const savedMatch = await onSaveMatch(initialMatch, initialStats);
      if (savedMatch && savedMatch.id) {
        setSessionMatch(savedMatch);
        setLiveRounds([]);
        setSessionActive(true);
        setCurrentRoundNo(1);
        setRoundSide('Att');
        resetRoundInputs();
        showToast(`Live match Vs. ${opponent} successfully initialized!`);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to boot live match database entry.');
    }
  };

  const resetRoundInputs = () => {
    setOurBuy('Full');
    setEnemyBuy('Full');
    setRoundResult('W');
    setRoundWinBy('Elimination');
    setIsPlanted(false);
    setSelectedSite('A');
    setRoundNotes('');
    setFirstKillBy('');
    setFirstDeathBy('');
    setClutchType('');
    setClutchPlayer('');
    setClutchResult('W');
    setIsThrow(false);
    setThrownBy('');
    setThrownByPlayers([]);
    setThrowReason('');
    setMidRoundIglChange(false);
    setSelectedStrats([]);
    setNewStratName('');
  };

  // Running Scores computed from round outcomes
  const runningScores = useMemo(() => {
    let weWon = 0;
    let theyWon = 0;
    let attW = 0, attL = 0, defW = 0, defL = 0;

    liveRounds.forEach(r => {
      const isWon = r.result === 'W';
      if (isWon) weWon++; else theyWon++;

      if (r.side === 'Att') {
        if (isWon) attW++; else attL++;
      } else {
        if (isWon) defW++; else defL++;
      }
    });

    return { weWon, theyWon, attW, attL, defW, defL };
  }, [liveRounds]);

  // Strategies matching active match map
  const mapStrats = useMemo(() => {
    if (!sessionMatch) return [];
    return (data.strats || []).filter(s => s.map === sessionMatch.map);
  }, [data.strats, sessionMatch]);

  const handleAddNewStrategyOnFly = async () => {
    if (!newStratName.trim() || !sessionMatch) return;
    const cleanName = newStratName.trim();
    // Check if it already exists for this map & side
    const exists = (data.strats || []).find(
      st => st.map === sessionMatch.map && 
            String(st.side).toLowerCase() === roundSide.toLowerCase() && 
            st.name.toLowerCase() === cleanName.toLowerCase()
    );

    if (exists) {
      if (!selectedStrats.includes(exists.id)) {
        setSelectedStrats([...selectedStrats, exists.id]);
      }
      setNewStratName('');
      return;
    }

    const newId = 'x' + Math.random().toString(36).substring(2, 10);
    const newStrat = {
      id: newId,
      map: sessionMatch.map,
      side: roundSide,
      name: cleanName,
      active: 'TRUE'
    };

    try {
      await onUpsert('Strats', newStrat);
      await onRefreshDatabase(); // reload data
      setSelectedStrats(prev => [...prev, newId]);
      setNewStratName('');
      showToast(`Strategy "${cleanName}" created on-the-fly!`);
    } catch (err) {
      console.error('Failed to create strategy on-the-fly:', err);
    }
  };

  // --- LOG CURRENT ROUND ---
  const handleLogRound = async () => {
    if (!sessionMatch) return;

    const stratNames = selectedStrats
      .map(id => {
        const s = (data.strats || []).find(st => st.id === id);
        return s ? s.name : '';
      })
      .filter(Boolean)
      .join(', ');

    const newRound: Partial<Round> = {
      roundNo: currentRoundNo,
      side: roundSide,
      buy: ourBuy,
      enemyBuy: enemyBuy,
      result: roundResult,
      winBy: roundWinBy,
      plant: isPlanted ? 'TRUE' : '',
      site: isPlanted ? selectedSite : '',
      notes: roundNotes.trim(),
      isThrow: isThrow ? 'TRUE' : '',
      thrownBy: isThrow ? thrownByPlayers.join(', ') : '',
      throwReason: isThrow ? throwReason.trim() : '',
      firstKillBy: firstKillBy || undefined,
      firstDeathBy: firstDeathBy || undefined,
      clutchType: clutchType || undefined,
      clutchPlayer: clutchType ? clutchPlayer : undefined,
      clutchResult: clutchType ? clutchResult : undefined,
      iglPlayer: activeIglCaller === 'Primary' ? primaryIgl : activeIglCaller === 'Secondary' ? secondaryIgl : 'None',
      iglRole: activeIglCaller,
      midRoundIglChange: midRoundIglChange,
      strategies: stratNames
    };

    const updatedRounds = [...liveRounds, newRound];
    setLiveRounds(updatedRounds);

    // Save automated StratRun logs for each strategy used
    for (const stratId of selectedStrats) {
      try {
        await onUpsert('StratRuns', {
          id: 'x' + Math.random().toString(36).substring(2, 10),
          stratId,
          matchId: sessionMatch.id,
          date: sessionMatch.date,
          map: sessionMatch.map,
          side: roundSide,
          result: roundResult,
          reason: roundNotes.trim() || `Round ${currentRoundNo} Live Run`
        });
      } catch (err) {
        console.error('Error logging automated strategy run:', err);
      }
    }

    // Dynamic Pistol / Eco / Bonus trackers
    let pistolAtt = sessionMatch.pistolAtt || 'L';
    let pistolDef = sessionMatch.pistolDef || 'L';
    let ecoAtt = sessionMatch.ecoAtt || 'L';
    let ecoDef = sessionMatch.ecoDef || 'L';
    let bonusAtt = sessionMatch.bonusAtt || 'L';
    let bonusDef = sessionMatch.bonusDef || 'L';

    if (currentRoundNo === 1) pistolAtt = roundResult;
    if (currentRoundNo === 13) pistolDef = roundResult;
    if (currentRoundNo === 2) ecoAtt = roundResult;
    if (currentRoundNo === 14) ecoDef = roundResult;
    if (currentRoundNo === 3) bonusAtt = roundResult;
    if (currentRoundNo === 15) bonusDef = roundResult;

    // Recalculate score splits
    let attW = 0, attL = 0, defW = 0, defL = 0;
    updatedRounds.forEach(r => {
      const isWon = r.result === 'W';
      if (r.side === 'Att') {
        if (isWon) attW++; else attL++;
      } else {
        if (isWon) defW++; else defL++;
      }
    });

    // Update match scores live on backend
    const updatedMatch: Match = {
      ...sessionMatch,
      attW,
      attL,
      defW,
      defL,
      pistolAtt,
      pistolDef,
      ecoAtt,
      ecoDef,
      bonusAtt,
      bonusDef
    };

    try {
      // 1. Save rounds list to db
      await onSaveRounds(sessionMatch.id, updatedRounds);
      
      // 2. Update scores in Match table
      const savedMatch = await onSaveMatch(updatedMatch, []);
      if (savedMatch) {
        setSessionMatch(savedMatch);
      }

      showToast(`Round ${currentRoundNo} successfully recorded!`);

      // Set up next round defaults
      const nextRoundNo = currentRoundNo + 1;
      setCurrentRoundNo(nextRoundNo);
      // Auto-set side based on standard round rotation (first half: 12 rounds)
      setRoundSide(nextRoundNo <= 12 ? 'Att' : 'Def');
      
      resetRoundInputs();
    } catch (err) {
      console.error(err);
      alert('Error updating live database during round log.');
    }
  };

  // --- DELETE A ROUND FROM TIMELINE ---
  const handleDeleteRound = async (idx: number) => {
    if (!sessionMatch) return;
    if (!window.confirm(`Delete round ${idx + 1} logging records?`)) return;

    const filtered = liveRounds.filter((_, i) => i !== idx);
    // Re-index round numbers
    const updated = filtered.map((r, i) => ({ ...r, roundNo: i + 1 }));
    setLiveRounds(updated);

    // Recalculate match variables
    let attW = 0, attL = 0, defW = 0, defL = 0;
    updated.forEach(r => {
      const isWon = r.result === 'W';
      if (r.side === 'Att') {
        if (isWon) attW++; else attL++;
      } else {
        if (isWon) defW++; else defL++;
      }
    });

    const updatedMatch: Match = {
      ...sessionMatch,
      attW,
      attL,
      defW,
      defL
    };

    try {
      await onSaveRounds(sessionMatch.id, updated);
      await onSaveMatch(updatedMatch, []);
      showToast('Round removed from session timeline.');
    } catch (err) {
      console.error(err);
    }
  };

  // --- OPEN FINAL SCOREBOARD MODAL ---
  const handleOpenScoreboardFinalizer = () => {
    if (!sessionMatch) return;

    // Tally FK / FD from live rounds to help populate
    const talliedFk: Record<string, number> = {};
    const talliedFd: Record<string, number> = {};
    activeRoster.forEach(p => {
      talliedFk[p] = 0;
      talliedFd[p] = 0;
    });

    liveRounds.forEach(r => {
      if (r.firstKillBy && activeRoster.includes(r.firstKillBy)) {
        talliedFk[r.firstKillBy]++;
      }
      if (r.firstDeathBy && activeRoster.includes(r.firstDeathBy)) {
        talliedFd[r.firstDeathBy]++;
      }
    });

    const initialStats = activeRoster.map(p => ({
      id: '',
      matchId: sessionMatch.id,
      player: p,
      agent: agentsMap[p] || 'Omen',
      kAtt: 0, kDef: 0, dAtt: 0, dDef: 0, aAtt: 0, aDef: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      acs: 200,
      adr: 140,
      hs: 20,
      fk: talliedFk[p] || 0,
      fd: talliedFd[p] || 0,
      rating: '1.0'
    }));

    setFinalPlayerStats(initialStats);
    setScoreboardOpen(true);
  };

  const handleUpdateFinalStatRow = (idx: number, field: keyof PlayerStats, val: any) => {
    setFinalPlayerStats(prev => {
      const cpy = [...prev];
      cpy[idx] = { ...cpy[idx], [field]: val } as any;
      return cpy;
    });
  };

  // --- FINALIZE AND EXIT ---
  const handleSaveAndFinalize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionMatch) return;

    // Aggregate values
    const finalizedStats = finalPlayerStats.map(st => {
      // Calculate kills, deaths, assists as sum of att/def if specified, else use input
      const kills = Number(st.kAtt) + Number(st.kDef);
      const deaths = Number(st.dAtt) + Number(st.dDef);
      const assists = Number(st.aAtt) + Number(st.aDef);
      return { ...st, kills, deaths, assists };
    });

    try {
      await onSaveMatch(sessionMatch, finalizedStats);
      await onRefreshDatabase();
      
      setSessionActive(false);
      setSessionMatch(null);
      setLiveRounds([]);
      setScoreboardOpen(false);
      
      alert('Live match finalized successfully and logged to standard database!');
      setActiveTab('matches');
    } catch (err) {
      console.error(err);
      alert('Failed to finalize final scoreboard records.');
    }
  };

  // --- LIVE STATISTICS SUMMARY COMPUTATIONS ---
  const statsSummary = useMemo(() => {
    // Clutch rates
    const clutchesList: { desc: string; win: boolean }[] = [];
    let throwsCount = 0;
    const throwRecords: { player: string; reason: string; round: number }[] = [];

    // IGL performance ratios
    let primW = 0, primL = 0;
    let secW = 0, secL = 0;
    let midIglW = 0, midIglL = 0;

    liveRounds.forEach((r, idx) => {
      const roundNum = idx + 1;
      const won = r.result === 'W';

      // Clutch tracking
      if (r.clutchType) {
        clutchesList.push({
          desc: `Round ${roundNum}: ${r.clutchPlayer} in a ${r.clutchType}`,
          win: r.clutchResult === 'W'
        });
      }

      // Throws tracking
      if (r.isThrow === 'TRUE') {
        throwsCount++;
        throwRecords.push({
          player: r.thrownBy || 'Unknown',
          reason: r.throwReason || 'Choked advantage',
          round: roundNum
        });
      }

      // IGL strategy winrate tracking
      if (r.iglRole === 'Primary') {
        if (won) primW++; else primL++;
      } else if (r.iglRole === 'Secondary') {
        if (won) secW++; else secL++;
      }

      if (r.midRoundIglChange === true || r.midRoundIglChange === 'TRUE') {
        if (won) midIglW++; else midIglL++;
      }
    });

    return { clutchesList, throwsCount, throwRecords, primW, primL, secW, secL, midIglW, midIglL };
  }, [liveRounds]);

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-[#ff4655] text-white px-4 py-3 rounded-lg shadow-xl border border-white/10 font-mono text-xs flex items-center gap-2 animate-bounce">
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* HEADER ROW */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff4655] animate-pulse"></span>
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-black font-mono">LIVE CONSOLE</span>
          </div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Esports Live Match Logger</h2>
        </div>
        
        {sessionActive && (
          <div className="flex items-center gap-3">
            <div className="p-2.5 px-4 bg-rose-500/10 border border-rose-500/20 text-[#ff4655] rounded-xl font-mono text-xs font-black flex items-center gap-2">
              <Swords className="w-4 h-4" />
              <span>LIVE: VS. {sessionMatch?.opponent} ({sessionMatch?.map})</span>
            </div>
            <button
              onClick={handleOpenScoreboardFinalizer}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase font-mono shadow-md"
            >
              🏁 FINALIZE MATCH
            </button>
          </div>
        )}
      </div>

      {/* SCREEN 1: PRE-SESSION SETUP */}
      {!sessionActive && (
        <div className={`p-6 rounded-2xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-6`}>
          <div className="flex items-center gap-2 border-b border-white/5 pb-3">
            <Sliders className={`w-5 h-5 ${theme.text}`} />
            <h3 className="font-black text-sm uppercase tracking-wider">Initialize Live Match Session</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Column 1: Match metadata */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest font-mono">1. Match Parameters</h4>
              
              <div className="space-y-1">
                <label className="text-[10px] text-gray-400 uppercase font-bold font-mono">Opponent Name</label>
                <input
                  type="text"
                  placeholder="e.g. Acend Club"
                  value={opponent}
                  onChange={(e) => setOpponent(e.target.value)}
                  className={`w-full p-2.5 rounded-lg text-xs font-mono border focus:outline-none focus:ring-1 focus:ring-[#ff4655] ${
                    isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                  }`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 uppercase font-bold font-mono">Select Map</label>
                  <select
                    value={selectedMap}
                    onChange={(e) => setSelectedMap(e.target.value)}
                    className={`w-full p-2.5 rounded-lg text-xs font-mono border focus:outline-none ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                    }`}
                  >
                    {mapsList.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 uppercase font-bold font-mono">Match Type</label>
                  <select
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value)}
                    className={`w-full p-2.5 rounded-lg text-xs font-mono border focus:outline-none ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                    }`}
                  >
                    {matchTypes.map(mt => (
                      <option key={mt} value={mt}>{mt}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dedicated IGL assignment */}
              <div className="space-y-3 pt-3 border-t border-white/5">
                <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest font-mono">2. Strategy Roles (IGL)</h4>
                
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 uppercase font-bold font-mono">Primary IGL</label>
                  <select
                    value={primaryIgl}
                    onChange={(e) => setPrimaryIgl(e.target.value)}
                    className={`w-full p-2.5 rounded-lg text-xs font-mono border focus:outline-none ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                    }`}
                  >
                    <option value="">None Designated</option>
                    {playersList.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 uppercase font-bold font-mono">Secondary IGL</label>
                  <select
                    value={secondaryIgl}
                    onChange={(e) => setSecondaryIgl(e.target.value)}
                    className={`w-full p-2.5 rounded-lg text-xs font-mono border focus:outline-none ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                    }`}
                  >
                    <option value="">None Designated</option>
                    {playersList.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Column 2: Roster multiselect */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest font-mono">3. Select Active 5-Man Roster</h4>
              
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                {playersList.map((player) => {
                  const isChecked = activeRoster.includes(player);
                  return (
                    <button
                      key={player}
                      type="button"
                      onClick={() => handleToggleRoster(player)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-left font-mono transition-all ${
                        isChecked 
                          ? 'border-[#ff4655] bg-[#ff4655]/5 text-white' 
                          : 'border-white/5 bg-black/10 text-gray-400'
                      }`}
                    >
                      <span className="text-xs font-bold">{player}</span>
                      <div className={`w-4 h-4 rounded flex items-center justify-center border ${
                        isChecked ? 'border-[#ff4655] bg-[#ff4655]' : 'border-gray-600'
                      }`}>
                        {isChecked && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-500 font-mono">
                Click to add/remove players. Ensure 5 players are ticked for standard competitive matches.
              </p>
            </div>

            {/* Column 3: Agents assignment */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest font-mono">4. Starting Agent Assignments</h4>
              
              <div className="space-y-3">
                {activeRoster.map((player) => (
                  <div key={player} className="flex items-center gap-3 justify-between">
                    <span className="text-xs font-bold font-mono text-gray-300 truncate max-w-[100px]">{player}</span>
                    <select
                      value={agentsMap[player] || 'Omen'}
                      onChange={(e) => handleAgentChange(player, e.target.value)}
                      className={`p-1.5 rounded text-[11px] font-mono border focus:outline-none ${
                        isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                      }`}
                    >
                      {data.settings.agents.map(ag => (
                        <option key={ag} value={ag}>{ag}</option>
                      ))}
                    </select>
                  </div>
                ))}
                {activeRoster.length === 0 && (
                  <p className="text-xs text-gray-500 font-mono text-center py-6">Select roster on the left to configure agents.</p>
                )}
              </div>
            </div>

          </div>

          <div className="pt-4 border-t border-white/5 flex justify-end">
            <button
              onClick={handleStartLiveMatch}
              className="px-6 py-3 bg-[#ff4655] text-white font-black uppercase text-sm tracking-wider font-mono rounded-xl hover:bg-[#ff5e6a] transition-all flex items-center gap-2 shadow-lg shadow-red-500/10"
            >
              <Play className="w-4.5 h-4.5" />
              <span>BOOT LIVE RECORDER SESSION</span>
            </button>
          </div>
        </div>
      )}

      {/* SCREEN 2: ACTIVE LIVE LOGGER SESSION */}
      {sessionActive && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* LEFT COLUMN: ACTIVE ROUND LOGGER FORM */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* Current status card */}
            <div className={`p-4 rounded-2xl border ${isLight ? 'bg-white border-slate-200 shadow-sm' : 'bg-black/30 border-white/10'} flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-rose-500/10 border border-rose-500/20 text-[#ff4655] rounded-xl flex items-center justify-center font-black text-sm">
                  #{currentRoundNo}
                </div>
                <div>
                  <h4 className="text-xs text-gray-400 uppercase font-bold font-mono">Current Live Entry</h4>
                  <p className="text-sm font-black uppercase font-mono">ROUND {currentRoundNo}</p>
                </div>
              </div>

              {/* Live Running Score Indicator */}
              <div className="text-center font-mono">
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">RUNNING SCORE</p>
                <div className="flex items-center justify-center gap-2 mt-0.5">
                  <span className="text-2xl font-black text-emerald-400">{runningScores.weWon}</span>
                  <span className="text-sm text-gray-500">-</span>
                  <span className="text-2xl font-black text-rose-500">{runningScores.theyWon}</span>
                </div>
              </div>

              {/* Side toggle */}
              <div className="flex items-center gap-1.5 bg-black/20 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setRoundSide('Att')}
                  className={`p-1.5 px-3 rounded text-[10px] font-black uppercase font-mono transition-all ${
                    roundSide === 'Att' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Attack
                </button>
                <button
                  type="button"
                  onClick={() => setRoundSide('Def')}
                  className={`p-1.5 px-3 rounded text-[10px] font-black uppercase font-mono transition-all ${
                    roundSide === 'Def' ? 'bg-cyan-500 text-black' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Defense
                </button>
              </div>
            </div>

            {/* Main logger card */}
            <div className={`p-6 rounded-2xl border ${isLight ? 'bg-white border-slate-200' : 'bg-white/5 border-white/10'} space-y-6`}>
              
              {/* Outcome row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-400 uppercase font-black font-mono">Round Result</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setRoundResult('W');
                        setRoundWinBy('Elimination');
                      }}
                      className={`p-3 rounded-xl border font-mono text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                        roundResult === 'W'
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                          : 'bg-black/10 border-white/5 text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>WE WON (W)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRoundResult('L');
                        setRoundWinBy('Elimination');
                      }}
                      className={`p-3 rounded-xl border font-mono text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                        roundResult === 'L'
                          ? 'bg-rose-500/20 border-rose-500 text-rose-400'
                          : 'bg-black/10 border-white/5 text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      <X className="w-4 h-4" />
                      <span>WE LOST (L)</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-gray-400 uppercase font-black font-mono">Win / Loss Method</label>
                  <select
                    value={roundWinBy}
                    onChange={(e) => setRoundWinBy(e.target.value)}
                    className={`w-full p-2.5 rounded-lg text-xs font-mono border focus:outline-none ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                    }`}
                  >
                    {winReasons.map(wr => (
                      <option key={wr} value={wr}>{wr}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Economical buys */}
              <div className="grid grid-cols-2 gap-4 border-t border-white/5 pt-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 uppercase font-bold font-mono">Our Buy Category</label>
                  <select
                    value={ourBuy}
                    onChange={(e) => setOurBuy(e.target.value)}
                    className={`w-full p-2.5 rounded-lg text-xs font-mono border focus:outline-none ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                    }`}
                  >
                    {buyTypes.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-gray-400 uppercase font-bold font-mono">Enemy Buy Category</label>
                  <select
                    value={enemyBuy}
                    onChange={(e) => setEnemyBuy(e.target.value)}
                    className={`w-full p-2.5 rounded-lg text-xs font-mono border focus:outline-none ${
                      isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                    }`}
                  >
                    {buyTypes.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* live FK / FD triggers */}
              <div className="space-y-3 border-t border-white/5 pt-4">
                <h5 className="text-[10px] text-rose-400 font-black uppercase tracking-wider font-mono">🔥 Live FK / FD Tracking</h5>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* First Kill */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-gray-400 uppercase font-bold font-mono">First Kill (FK) By</label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setFirstKillBy('')}
                        className={`px-2 py-1 rounded text-[10px] font-mono border transition-all ${
                          firstKillBy === '' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-black/20 border-white/5 text-gray-400'
                        }`}
                      >
                        None
                      </button>
                      <button
                        type="button"
                        onClick={() => setFirstKillBy('Enemy')}
                        className={`px-2 py-1 rounded text-[10px] font-mono border transition-all ${
                          firstKillBy === 'Enemy' ? 'bg-rose-500/20 border-rose-500 text-rose-400' : 'bg-black/20 border-white/5 text-gray-400'
                        }`}
                      >
                        Enemy
                      </button>
                      {activeRoster.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setFirstKillBy(p)}
                          className={`px-2 py-1 rounded text-[10px] font-mono border transition-all ${
                            firstKillBy === p ? 'bg-emerald-500 text-black font-black border-emerald-500' : 'bg-black/20 border-white/5 text-gray-300'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* First Death */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-gray-400 uppercase font-bold font-mono">First Death (FD) By</label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setFirstDeathBy('')}
                        className={`px-2 py-1 rounded text-[10px] font-mono border transition-all ${
                          firstDeathBy === '' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-black/20 border-white/5 text-gray-400'
                        }`}
                      >
                        None
                      </button>
                      <button
                        type="button"
                        onClick={() => setFirstDeathBy('Enemy')}
                        className={`px-2 py-1 rounded text-[10px] font-mono border transition-all ${
                          firstDeathBy === 'Enemy' ? 'bg-rose-500/20 border-rose-500 text-rose-400' : 'bg-black/20 border-white/5 text-gray-400'
                        }`}
                      >
                        Enemy
                      </button>
                      {activeRoster.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setFirstDeathBy(p)}
                          className={`px-2 py-1 rounded text-[10px] font-mono border transition-all ${
                            firstDeathBy === p ? 'bg-rose-500 text-black font-black border-rose-500' : 'bg-black/20 border-white/5 text-gray-300'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Clutch and Spike details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-white/5 pt-4">
                
                {/* Clutch details */}
                <div className="space-y-3">
                  <h5 className="text-[10px] text-amber-500 font-black uppercase tracking-wider font-mono">🏆 Clutch Log (1vX)</h5>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      {['', '1v1', '1v2', '1v3'].map(cl => (
                        <button
                          key={cl}
                          type="button"
                          onClick={() => setClutchType(cl)}
                          className={`p-1.5 px-3 rounded text-[10px] font-mono border transition-all ${
                            clutchType === cl ? 'bg-amber-500 text-black font-black border-amber-500' : 'bg-black/20 border-white/5 text-gray-400'
                          }`}
                        >
                          {cl || 'No Clutch'}
                        </button>
                      ))}
                    </div>

                    {clutchType && (
                      <div className="grid grid-cols-2 gap-2 animate-fadeIn">
                        <select
                          value={clutchPlayer}
                          onChange={(e) => setClutchPlayer(e.target.value)}
                          className={`p-2 rounded text-xs font-mono border focus:outline-none ${
                            isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                          }`}
                        >
                          <option value="">Choose Player...</option>
                          {activeRoster.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>

                        <div className="flex items-center gap-1 bg-black/20 p-1 rounded-lg">
                          <button
                            type="button"
                            onClick={() => setClutchResult('W')}
                            className={`flex-1 p-1 rounded text-[10px] font-mono font-black ${
                              clutchResult === 'W' ? 'bg-emerald-500 text-black' : 'text-gray-400'
                            }`}
                          >
                            Won
                          </button>
                          <button
                            type="button"
                            onClick={() => setClutchResult('L')}
                            className={`flex-1 p-1 rounded text-[10px] font-mono font-black ${
                              clutchResult === 'L' ? 'bg-rose-500 text-black' : 'text-gray-400'
                            }`}
                          >
                            Lost
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Spike details */}
                <div className="space-y-3">
                  <h5 className="text-[10px] text-cyan-400 font-black uppercase tracking-wider font-mono">📍 Spike Plant Details</h5>
                  
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setIsPlanted(!isPlanted)}
                      className={`p-2 px-4 rounded-xl border text-xs font-mono transition-all flex items-center gap-2 ${
                        isPlanted ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400 font-bold' : 'bg-black/10 border-white/5 text-gray-500'
                      }`}
                    >
                      <Check className={`w-4 h-4 ${isPlanted ? 'opacity-100' : 'opacity-20'}`} />
                      <span>Spike Planted?</span>
                    </button>

                    {isPlanted && (
                      <div className="flex items-center gap-1 bg-black/20 p-1 rounded-lg animate-fadeIn">
                        {sitesList.map(st => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setSelectedSite(st)}
                            className={`p-1 px-2.5 rounded text-[10px] font-mono font-black ${
                              selectedSite === st ? 'bg-cyan-500 text-black' : 'text-gray-400'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              </div>

              {/* DISCIPLINE / OVERPEEKS / THROWS */}
              <div className="space-y-3 border-t border-white/5 pt-4">
                <div className="flex items-center justify-between">
                  <h5 className="text-[10px] text-[#ff4655] font-black uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> ⚠️ Discipline & Round Throws Log
                  </h5>
                  
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isThrow;
                      setIsThrow(next);
                      if (!next) {
                        setThrownByPlayers([]);
                      }
                    }}
                    className={`p-1.5 px-3 rounded-lg border text-[10px] font-mono font-black transition-all ${
                      isThrow ? 'bg-rose-500/20 border-rose-500 text-rose-400' : 'bg-black/20 border-white/5 text-gray-500'
                    }`}
                  >
                    Flag as Costly Tactical Throw
                  </button>
                </div>

                {isThrow && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 rounded-xl border border-rose-500/10 bg-rose-500/5 animate-fadeIn">
                    <div className="space-y-1.5">
                      <label className="text-[9px] text-gray-400 uppercase font-black font-mono">Responsible Players (Select one or more)</label>
                      <div className="flex flex-wrap gap-1.5 p-2.5 bg-black/30 border border-white/5 rounded-lg">
                        {activeRoster.map(p => {
                          const isSelected = thrownByPlayers.includes(p);
                          return (
                            <button
                              type="button"
                              key={p}
                              onClick={() => {
                                if (isSelected) {
                                  setThrownByPlayers(thrownByPlayers.filter(x => x !== p));
                                } else {
                                  setThrownByPlayers([...thrownByPlayers, p]);
                                }
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-mono border font-bold transition-all ${
                                isSelected
                                  ? 'bg-rose-500 text-black font-black border-rose-500'
                                  : 'bg-black/30 border-white/5 text-gray-400 hover:text-white'
                              }`}
                            >
                              {p}
                            </button>
                          );
                        })}
                        {activeRoster.length === 0 && (
                          <span className="text-gray-500 text-[10px] italic">No active roster loaded</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[9px] text-gray-400 uppercase font-black font-mono">Throw Error Reason</label>
                      <input
                        type="text"
                        placeholder="e.g. Dry peeked 4v2, hunted kills instead of default"
                        value={throwReason}
                        onChange={(e) => setThrowReason(e.target.value)}
                        className={`w-full p-2.5 rounded-lg text-xs font-mono border focus:outline-none ${
                          isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                        }`}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* IGL STRATEGY LOGGING */}
              <div className="space-y-3 border-t border-white/5 pt-4">
                <h5 className="text-[10px] text-violet-400 font-black uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" /> 🧠 In-Game Leader (IGL) & Strat winrate tracker
                </h5>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-gray-400 uppercase font-bold font-mono">Active Caller for Round</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveIglCaller('Primary')}
                        disabled={!primaryIgl}
                        className={`p-2 rounded-lg border text-[10px] font-mono truncate transition-all ${
                          !primaryIgl 
                            ? 'opacity-30 cursor-not-allowed border-transparent text-gray-600' 
                            : activeIglCaller === 'Primary' 
                            ? 'bg-violet-600/30 border-violet-500 text-violet-300 font-bold' 
                            : 'bg-black/20 border-white/5 text-gray-400'
                        }`}
                        title={primaryIgl ? `Primary: ${primaryIgl}` : 'No primary IGL defined'}
                      >
                        Primary ({primaryIgl || 'N/A'})
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveIglCaller('Secondary')}
                        disabled={!secondaryIgl}
                        className={`p-2 rounded-lg border text-[10px] font-mono truncate transition-all ${
                          !secondaryIgl 
                            ? 'opacity-30 cursor-not-allowed border-transparent text-gray-600' 
                            : activeIglCaller === 'Secondary' 
                            ? 'bg-amber-600/30 border-amber-500 text-amber-300 font-bold' 
                            : 'bg-black/20 border-white/5 text-gray-400'
                        }`}
                        title={secondaryIgl ? `Secondary: ${secondaryIgl}` : 'No secondary IGL defined'}
                      >
                        Secondary ({secondaryIgl || 'N/A'})
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveIglCaller('None')}
                        className={`p-2 rounded-lg border text-[10px] font-mono transition-all ${
                          activeIglCaller === 'None' ? 'bg-gray-700/30 border-gray-500 text-gray-300 font-bold' : 'bg-black/20 border-white/5 text-gray-400'
                        }`}
                      >
                        No IGL Call
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 flex flex-col justify-end">
                    <button
                      type="button"
                      onClick={() => setMidRoundIglChange(!midRoundIglChange)}
                      className={`w-full p-2.5 rounded-lg border text-xs font-mono transition-all flex items-center justify-center gap-2 ${
                        midRoundIglChange 
                          ? 'bg-[#ff4655]/10 border-[#ff4655] text-white font-bold' 
                          : 'bg-black/20 border-white/5 text-gray-500 hover:text-gray-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={midRoundIglChange}
                        readOnly
                        className="pointer-events-none accent-[#ff4655]"
                      />
                      <span>🔄 Mid-Round Strat Change / 2nd IGL Ticked</span>
                    </button>
                  </div>
                </div>

                {/* STRATEGY RUN SELECTION */}
                <div className="space-y-2 border-t border-white/5 pt-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <label className="text-[10px] text-gray-400 uppercase font-black font-mono">
                      Selected Strategies for Round (Select one or more to track strategy win rates)
                    </label>
                    <div className="flex items-center gap-1 w-full sm:w-auto max-w-sm">
                      <input
                        type="text"
                        placeholder="New strat on-the-fly..."
                        value={newStratName}
                        onChange={(e) => setNewStratName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddNewStrategyOnFly();
                          }
                        }}
                        className={`p-1 px-2.5 rounded-lg text-[11px] font-mono border focus:outline-none w-full ${
                          isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={handleAddNewStrategyOnFly}
                        className="bg-violet-600 hover:bg-violet-500 text-white p-1 px-2.5 rounded-lg text-[11px] font-mono font-bold shrink-0 transition-colors"
                      >
                        + Add
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 p-2 bg-black/30 border border-white/5 rounded-xl">
                    {mapStrats.map(st => {
                      const isSelected = selectedStrats.includes(st.id);
                      const matchesSide = String(st.side).toLowerCase() === roundSide.toLowerCase();
                      return (
                        <button
                          type="button"
                          key={st.id}
                          onClick={() => {
                            if (isSelected) {
                              setSelectedStrats(selectedStrats.filter(id => id !== st.id));
                            } else {
                              setSelectedStrats([...selectedStrats, st.id]);
                            }
                          }}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-all flex items-center gap-1.5 ${
                            isSelected
                              ? 'bg-violet-600 border-violet-500 text-white font-black'
                              : matchesSide
                              ? 'bg-violet-500/10 border-violet-500/20 text-violet-300 hover:border-violet-500/50'
                              : 'bg-black/20 border-white/5 text-gray-500 hover:text-gray-400'
                          }`}
                        >
                          <span className={`text-[9px] px-1 rounded font-black ${
                            matchesSide ? 'bg-violet-500/20 text-violet-300' : 'bg-black/40 text-gray-500'
                          }`}>
                            {st.side}
                          </span>
                          <span>{st.name}</span>
                          {isSelected && <Check className="w-3 h-3 text-white shrink-0" />}
                        </button>
                      );
                    })}
                    {mapStrats.length === 0 && (
                      <span className="text-gray-500 text-[10px] italic">No strategies defined for {sessionMatch.map} yet. Add one above!</span>
                    )}
                  </div>
                </div>
              </div>

              {/* NOTES */}
              <div className="space-y-1 border-t border-white/5 pt-4">
                <label className="text-[10px] text-gray-400 uppercase font-black font-mono">Round tactical notes</label>
                <input
                  type="text"
                  placeholder="e.g. Jett got pick on A main, defaulted patiently, postplant hold was solid."
                  value={roundNotes}
                  onChange={(e) => setRoundNotes(e.target.value)}
                  className={`w-full p-2.5 rounded-lg text-xs font-mono border focus:outline-none ${
                    isLight ? 'bg-slate-50 border-slate-200 text-slate-800' : 'bg-black/20 border-white/10 text-white'
                  }`}
                />
              </div>

              {/* LOG ROUND BUTTON */}
              <div className="pt-4 border-t border-white/5 flex justify-end">
                <button
                  type="button"
                  onClick={handleLogRound}
                  className={`px-6 py-3 rounded-xl font-black uppercase text-xs font-mono tracking-wider transition-all flex items-center gap-2 ${theme.primaryBg} text-white shadow-lg`}
                >
                  <Plus className="w-4 h-4" />
                  <span>LOG ROUND #{currentRoundNo} & NEXT</span>
                </button>
              </div>

            </div>

          </div>

          {/* RIGHT COLUMN: LIVE TIMELINE & METRICS PANEL */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Live stats scoreboard summary card */}
            <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
              <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                <Activity className="w-4.5 h-4.5 text-[#ff4655]" />
                <h4 className="font-black text-xs uppercase tracking-wider">Live Tactical Insights</h4>
              </div>

              {/* Running IGL Stats */}
              <div className="space-y-2">
                <h5 className="text-[10px] text-gray-500 uppercase font-bold font-mono">Strat caller win rates</h5>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  
                  <div className="p-2.5 bg-black/20 border border-white/5 rounded-lg">
                    <p className="text-gray-500 text-[9px] uppercase">Primary IGL</p>
                    <p className="text-white font-black mt-0.5">
                      {statsSummary.primW}W - {statsSummary.primL}L
                      <span className="text-violet-400 block text-[9px] font-bold">
                        {statsSummary.primW + statsSummary.primL > 0 
                          ? `${((statsSummary.primW / (statsSummary.primW + statsSummary.primL)) * 100).toFixed(0)}% Winrate`
                          : 'No rounds yet'}
                      </span>
                    </p>
                  </div>

                  <div className="p-2.5 bg-black/20 border border-white/5 rounded-lg">
                    <p className="text-gray-500 text-[9px] uppercase">Secondary IGL</p>
                    <p className="text-white font-black mt-0.5">
                      {statsSummary.secW}W - {statsSummary.secL}L
                      <span className="text-amber-400 block text-[9px] font-bold">
                        {statsSummary.secW + statsSummary.secL > 0 
                          ? `${((statsSummary.secW / (statsSummary.secW + statsSummary.secL)) * 100).toFixed(0)}% Winrate`
                          : 'No rounds yet'}
                      </span>
                    </p>
                  </div>

                  <div className="col-span-2 p-2.5 bg-black/20 border border-white/5 rounded-lg">
                    <p className="text-gray-500 text-[9px] uppercase">Mid-Round Strat Pivots (2nd IGL ticked)</p>
                    <p className="text-white font-black mt-0.5">
                      {statsSummary.midIglW}W - {statsSummary.midIglL}L
                      <span className="text-rose-400 block text-[9px] font-bold">
                        {statsSummary.midIglW + statsSummary.midIglL > 0 
                          ? `${((statsSummary.midIglW / (statsSummary.midIglW + statsSummary.midIglL)) * 100).toFixed(0)}% Winrate on adjustment`
                          : 'No mid-round adjustments ticked'}
                      </span>
                    </p>
                  </div>

                </div>
              </div>

              {/* Clutches List */}
              <div className="space-y-2 border-t border-white/5 pt-3">
                <h5 className="text-[10px] text-gray-500 uppercase font-bold font-mono">Clutches logged</h5>
                <div className="space-y-1.5 max-h-[110px] overflow-y-auto font-mono text-[10px]">
                  {statsSummary.clutchesList.map((cl, i) => (
                    <div key={i} className="flex items-center justify-between p-1.5 bg-black/10 rounded">
                      <span className="text-gray-300 truncate max-w-[170px]">{cl.desc}</span>
                      <span className={`p-0.5 px-1.5 rounded font-black text-[9px] ${
                        cl.win ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {cl.win ? 'WON' : 'LOST'}
                      </span>
                    </div>
                  ))}
                  {statsSummary.clutchesList.length === 0 && (
                    <p className="text-gray-500 text-[9px] italic font-mono py-2">No 1vX clutch moments logged yet.</p>
                  )}
                </div>
              </div>

              {/* Throws List */}
              <div className="space-y-2 border-t border-white/5 pt-3">
                <h5 className="text-[10px] text-gray-500 uppercase font-bold font-mono">Tactical errors & throws</h5>
                <div className="space-y-1.5 max-h-[110px] overflow-y-auto font-mono text-[10px]">
                  {statsSummary.throwRecords.map((tr, i) => (
                    <div key={i} className="p-2 bg-rose-500/5 border border-rose-500/10 rounded-lg space-y-0.5">
                      <div className="flex justify-between text-[9px] font-bold text-rose-400 uppercase">
                        <span>Round {tr.round} Throw</span>
                        <span>{tr.player}</span>
                      </div>
                      <p className="text-gray-400 text-[9px] leading-normal">{tr.reason}</p>
                    </div>
                  ))}
                  {statsSummary.throwRecords.length === 0 && (
                    <p className="text-emerald-400 text-[9px] font-bold py-2 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> Flawless tactical discipline: 0 throws logged!
                    </p>
                  )}
                </div>
              </div>

            </div>

            {/* Timeline component */}
            <div className={`p-5 rounded-2xl border ${isLight ? 'bg-white border-slate-200 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4.5 h-4.5 text-gray-400" />
                  <h4 className="font-black text-xs uppercase tracking-wider">Match Round History</h4>
                </div>
                <span className="text-[9px] font-mono text-gray-500 uppercase font-bold">Timeline</span>
              </div>

              <div className="grid grid-cols-6 gap-2">
                {liveRounds.map((r, idx) => {
                  const won = r.result === 'W';
                  return (
                    <div 
                      key={idx} 
                      className={`p-2 rounded-lg border text-center font-mono relative group transition-all hover:scale-[1.05] ${
                        won 
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                          : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                      }`}
                    >
                      <span className="block text-[10px] font-black">{won ? 'W' : 'L'}</span>
                      <span className="block text-[8px] text-gray-500">R{idx + 1}</span>
                      
                      {/* Hover action delete button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRound(idx);
                        }}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center text-[8px] font-bold opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-500 cursor-pointer"
                        title="Delete Round"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
                {liveRounds.length === 0 && (
                  <p className="col-span-6 text-center text-gray-500 font-mono text-xs py-8">
                    No rounds logged yet. Complete the form to record round #1.
                  </p>
                )}
              </div>
            </div>

          </div>

        </div>
      )}

      {/* SCOREBOARD FINALIZATION MODAL */}
      {scoreboardOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 overflow-y-auto animate-fadeIn">
          <div className={`w-full max-w-4xl p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-6 max-h-[90vh] overflow-y-auto`}>
            
            <div className="flex justify-between items-center border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-emerald-400" />
                <div>
                  <h4 className="text-lg font-black tracking-tight uppercase">Finalize Match Scoreboard Metrics</h4>
                  <p className="text-[10px] text-gray-400 font-mono">Fill in final game stats from the scoreboard tab to complete logger session.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setScoreboardOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAndFinalize} className="space-y-6">
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-mono text-xs min-w-[700px]">
                  <thead>
                    <tr className="border-b border-white/5 text-gray-500 uppercase font-bold">
                      <th className="py-2 px-1">Player</th>
                      <th className="py-2 px-1 text-center">ACS</th>
                      <th className="py-2 px-1 text-center">ADR</th>
                      <th className="py-2 px-1 text-center">HS%</th>
                      <th className="py-2 px-1 text-center">Kills (Att / Def)</th>
                      <th className="py-2 px-1 text-center">Deaths (Att / Def)</th>
                      <th className="py-2 px-1 text-center font-bold">Assists (Att / Def)</th>
                      <th className="py-2 px-1 text-center">Auto-FK/FD</th>
                      <th className="py-2 px-1 text-center">Rating</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {finalPlayerStats.map((st, idx) => (
                      <tr key={st.player}>
                        <td className="py-2.5 px-1 font-bold text-white text-xs">
                          {st.player}
                          <span className="block text-[8px] text-gray-500 italic">Agent: {st.agent}</span>
                        </td>
                        
                        {/* ACS */}
                        <td className="py-2.5 px-1 text-center">
                          <input
                            type="number"
                            required
                            min="0"
                            value={st.acs || ''}
                            onChange={(e) => handleUpdateFinalStatRow(idx, 'acs', Number(e.target.value))}
                            className={`w-14 p-1 rounded text-center border focus:outline-none ${
                              isLight ? 'bg-slate-50 border-slate-200' : 'bg-black/40 border-white/5 text-white'
                            }`}
                          />
                        </td>

                        {/* ADR */}
                        <td className="py-2.5 px-1 text-center">
                          <input
                            type="number"
                            required
                            min="0"
                            value={st.adr || ''}
                            onChange={(e) => handleUpdateFinalStatRow(idx, 'adr', Number(e.target.value))}
                            className={`w-14 p-1 rounded text-center border focus:outline-none ${
                              isLight ? 'bg-slate-50 border-slate-200' : 'bg-black/40 border-white/5 text-white'
                            }`}
                          />
                        </td>

                        {/* HS% */}
                        <td className="py-2.5 px-1 text-center">
                          <input
                            type="number"
                            required
                            min="0"
                            max="100"
                            value={st.hs || ''}
                            onChange={(e) => handleUpdateFinalStatRow(idx, 'hs', Number(e.target.value))}
                            className={`w-14 p-1 rounded text-center border focus:outline-none ${
                              isLight ? 'bg-slate-50 border-slate-200' : 'bg-black/40 border-white/5 text-white'
                            }`}
                          />
                        </td>

                        {/* KILLS split */}
                        <td className="py-2.5 px-1 text-center">
                          <div className="flex items-center gap-1 justify-center">
                            <input
                              type="number"
                              required
                              placeholder="Att"
                              value={st.kAtt || 0}
                              onChange={(e) => handleUpdateFinalStatRow(idx, 'kAtt', Number(e.target.value))}
                              className="w-10 p-1 text-xs rounded text-center border border-white/5 bg-black/40 text-amber-500 focus:outline-none"
                            />
                            <span className="text-gray-500">/</span>
                            <input
                              type="number"
                              required
                              placeholder="Def"
                              value={st.kDef || 0}
                              onChange={(e) => handleUpdateFinalStatRow(idx, 'kDef', Number(e.target.value))}
                              className="w-10 p-1 text-xs rounded text-center border border-white/5 bg-black/40 text-cyan-400 focus:outline-none"
                            />
                          </div>
                        </td>

                        {/* DEATHS split */}
                        <td className="py-2.5 px-1 text-center">
                          <div className="flex items-center gap-1 justify-center">
                            <input
                              type="number"
                              required
                              placeholder="Att"
                              value={st.dAtt || 0}
                              onChange={(e) => handleUpdateFinalStatRow(idx, 'dAtt', Number(e.target.value))}
                              className="w-10 p-1 text-xs rounded text-center border border-white/5 bg-black/40 text-amber-500 focus:outline-none"
                            />
                            <span className="text-gray-500">/</span>
                            <input
                              type="number"
                              required
                              placeholder="Def"
                              value={st.dDef || 0}
                              onChange={(e) => handleUpdateFinalStatRow(idx, 'dDef', Number(e.target.value))}
                              className="w-10 p-1 text-xs rounded text-center border border-white/5 bg-black/40 text-cyan-400 focus:outline-none"
                            />
                          </div>
                        </td>

                        {/* ASSISTS split */}
                        <td className="py-2.5 px-1 text-center">
                          <div className="flex items-center gap-1 justify-center">
                            <input
                              type="number"
                              required
                              placeholder="Att"
                              value={st.aAtt || 0}
                              onChange={(e) => handleUpdateFinalStatRow(idx, 'aAtt', Number(e.target.value))}
                              className="w-10 p-1 text-xs rounded text-center border border-white/5 bg-black/40 text-amber-500 focus:outline-none"
                            />
                            <span className="text-gray-500">/</span>
                            <input
                              type="number"
                              required
                              placeholder="Def"
                              value={st.aDef || 0}
                              onChange={(e) => handleUpdateFinalStatRow(idx, 'aDef', Number(e.target.value))}
                              className="w-10 p-1 text-xs rounded text-center border border-white/5 bg-black/40 text-cyan-400 focus:outline-none"
                            />
                          </div>
                        </td>

                        {/* FK / FD read-only */}
                        <td className="py-2.5 px-1 text-center text-gray-400 text-[10px]">
                          <span className="font-bold text-emerald-400">{st.fk}</span> FK / <span className="font-bold text-rose-400">{st.fd}</span> FD
                          <span className="block text-[8px] text-gray-500 font-normal">Live Auto-Tallied</span>
                        </td>

                        {/* RATING */}
                        <td className="py-2.5 px-1 text-center">
                          <input
                            type="text"
                            required
                            value={st.rating || '1.0'}
                            onChange={(e) => handleUpdateFinalStatRow(idx, 'rating', e.target.value)}
                            className="w-12 p-1 text-xs rounded text-center border border-white/5 bg-black/40 text-amber-400 focus:outline-none font-bold"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-3 bg-black/40 rounded-xl border border-white/5 font-mono text-[10px] text-gray-400 leading-relaxed">
                ℹ️ Kills, Deaths, and Assists will automatically sum your attack and defense entries. First Kill (FK) and First Death (FD) stats have been generated automatically from the live round log timeline entries.
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setScoreboardOpen(false)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-mono font-bold uppercase transition-colors"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#ff4655] hover:bg-[#ff5e6a] text-white rounded-xl text-xs font-black uppercase font-mono shadow-md"
                >
                  SAVE & CLOSE LIVE SESSION
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
}

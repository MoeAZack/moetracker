import React, { useState, useMemo } from 'react';
import { TrackerData, Strat } from '../types';
import { Sparkles, Brain, Zap, UserCheck, Check, Trash2, Loader2, Target, Users, ArrowUpRight, Compass, Swords, ClipboardList, Send, AlertTriangle, Activity } from 'lucide-react';
import { apiFetch } from '../utils/api';

interface ComponentProps {
  data: TrackerData;
  theme: any;
  onUpsert: (sheet: string, row: any) => Promise<any>;
  onRemove: (sheet: string, id: string) => Promise<any>;
}

export default function AITacticalHub({ data, theme, onUpsert, onRemove }: ComponentProps) {
  const [subTab, setSubTab] = useState<'playbook' | 'chemistry' | 'drafting'>('playbook');
  const isLight = data.settings.theme === 'daylight';

  // --- STATS COMPILATIONS ---
  const activePlayers = useMemo(() => {
    return data.settings?.players || [];
  }, [data.settings]);

  // --- KPI & PERIOD OVERRIDES STATE ---
  const [selectedKpiPlayer, setSelectedKpiPlayer] = useState<string>(activePlayers[0] || '');
  const [matrixOverrides, setMatrixOverrides] = useState<Record<string, Record<string, 'S' | 'A' | 'B' | 'C' | 'D'>>>({});
  
  // --- DRAFT LIST STATE ---
  const [draftList, setDraftList] = useState<{ player: string; agent: string }[]>([
    { player: activePlayers[0] || '', agent: '' },
    { player: activePlayers[1] || '', agent: '' },
    { player: activePlayers[2] || '', agent: '' },
    { player: activePlayers[3] || '', agent: '' },
    { player: activePlayers[4] || '', agent: '' },
  ]);

  // Sort matches chronologically to calculate period split
  const sortedMatches = useMemo(() => {
    return [...(data.matches || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data.matches]);

  const splitIndex = useMemo(() => {
    return Math.ceil(sortedMatches.length / 2);
  }, [sortedMatches]);

  const prevMatchIds = useMemo(() => {
    return new Set(sortedMatches.slice(0, splitIndex).map(m => m.id));
  }, [sortedMatches, splitIndex]);

  const currMatchIds = useMemo(() => {
    return new Set(sortedMatches.slice(splitIndex).map(m => m.id));
  }, [sortedMatches, splitIndex]);

  // Helper to compile stats
  const getPeriodMetrics = (matchIds: Set<string>) => {
    const stats: Record<string, {
      kills: number;
      deaths: number;
      untradedDeaths: number;
      clutchesWon: number;
      clutchesAttempted: number;
      throws: number;
      firstDeaths: number;
      hsSum: number;
      hsCount: number;
      roundsCount: number;
    }> = {};

    activePlayers.forEach(p => {
      stats[p] = { kills: 0, deaths: 0, untradedDeaths: 0, clutchesWon: 0, clutchesAttempted: 0, throws: 0, firstDeaths: 0, hsSum: 0, hsCount: 0, roundsCount: 0 };
    });

    // Count rounds played in these matches
    const roundsInPeriod = (data.rounds || []).filter(r => matchIds.has(r.matchId));
    
    (data.playerStats || []).forEach(ps => {
      if (!matchIds.has(ps.matchId)) return;
      const p = ps.player;
      if (stats[p]) {
        stats[p].kills += ps.kills || 0;
        stats[p].deaths += ps.deaths || 0;
        const dTr = ps.dTraded || 0;
        stats[p].untradedDeaths += Math.max(0, (ps.deaths || 0) - dTr);
        stats[p].clutchesWon += ps.cl || 0;
        stats[p].clutchesAttempted += ps.clAtt || 0;
        if (ps.hs && ps.hs > 0) {
          stats[p].hsSum += ps.hs;
          stats[p].hsCount++;
        }
      }
    });

    roundsInPeriod.forEach(r => {
      // Throws
      if ((r.isThrow === 'TRUE' || r.isThrow === 'true') && r.thrownBy) {
        const p = r.thrownBy;
        if (stats[p]) {
          stats[p].throws++;
        }
      }

      // First Deaths
      if (r.firstDeathBy) {
        const p = r.firstDeathBy;
        if (stats[p]) {
          stats[p].firstDeaths++;
        }
      }
    });

    return stats;
  };

  const prevPeriodMetrics = useMemo(() => getPeriodMetrics(prevMatchIds), [prevMatchIds, activePlayers, data.playerStats, data.rounds]);
  const currPeriodMetrics = useMemo(() => getPeriodMetrics(currMatchIds), [currMatchIds, activePlayers, data.playerStats, data.rounds]);

  const getKpiRecommendation = (player: string, curr: any, prev: any) => {
    const deaths = curr.deaths || 1;
    const prevDeaths = prev.deaths || 1;
    
    const currUntradedRate = Math.round((curr.untradedDeaths / deaths) * 100);
    const prevUntradedRate = Math.round((prev.untradedDeaths / prevDeaths) * 100);

    const currClutchRate = curr.clutchesAttempted > 0 ? Math.round((curr.clutchesWon / curr.clutchesAttempted) * 100) : 0;
    const prevClutchRate = prev.clutchesAttempted > 0 ? Math.round((prev.clutchesWon / prev.clutchesAttempted) * 100) : 0;

    const throwsDiff = curr.throws - prev.throws;
    const untradedDiff = currUntradedRate - prevUntradedRate;

    // Build smart diagnostic coaching recommendation
    if (curr.throws > 1 && currUntradedRate > 35) {
      return {
        focus: '⚠️ Tactical Discipline & Spacing',
        text: `${player} is currently showing spacing vulnerabilities with an un-traded death rate of ${currUntradedRate}% and ${curr.throws} critical round throws this period. Focus heavily on discipline drills, avoidance of solo entries without flashing utility, and locking down cross-fires rather than chasing dry kills.`,
        severity: 'high'
      };
    }

    if (currClutchRate < 40 && curr.clutchesAttempted > 2) {
      return {
        focus: '🔥 Clutch Efficiency & Calm Play',
        text: `${player} is struggling to convert active clutch rounds, winning only ${currClutchRate}% (${curr.clutchesWon}/${curr.clutchesAttempted}) of clutches this period (down from ${prevClutchRate}% last period). Work on slow-retake simulated scenarios, timing defuse half-ticks, and isolated 1v1 fights under high pressure.`,
        severity: 'medium'
      };
    }

    if (untradedDiff > 5) {
      return {
        focus: '🛡️ Team Spacing & Trade Spacing',
        text: `${player}'s un-traded death rate rose by ${untradedDiff}% this period. This indicates they are getting isolated on flanks or during site pushes without team follow-up. Prioritize close spacing during executions and holding passive default angles.`,
        severity: 'medium'
      };
    }

    if (curr.firstDeaths > 4 && curr.kills / deaths < 1.0) {
      return {
        focus: '🎯 Entry Pathing & Angles Selection',
        text: `${player} is logging high first deaths (${curr.firstDeaths}) relative to active fragging power. Refine initial site-entry pathing, coordinate with Initiator scouting flashes, and practice pre-aiming common defensive standard holds.`,
        severity: 'medium'
      };
    }

    return {
      focus: '🟢 Tactical Mastery & Mechanical Synergy',
      text: `${player} has displayed solid tactical compliance and stable metrics this period. Their clutch efficiency (${currClutchRate}%) and spacing remain strong. Maintain active calling and continue perfecting agent-specific utility sets in custom drills.`,
      severity: 'low'
    };
  };

  // --- DRAFTING MATRIX CALCS ---
  const standardAgents = useMemo(() => [
    'Jett', 'Raze', 'Phoenix', 'Neon', 'Reyna', 'Iso',
    'Cypher', 'Killjoy', 'Sage', 'Deadlock', 'Vyse',
    'Omen', 'Astra', 'Viper', 'Brimstone', 'Harbor', 'Clove',
    'Sova', 'Fade', 'Breach', 'Gekko', 'Skye', 'Kayo'
  ], []);

  const calculatedProficiencies = useMemo(() => {
    const statsList = data.playerStats || [];
    const profs: Record<string, Record<string, { rating: number; count: number; gamesWon: number; gamesTotal: number }>> = {};

    activePlayers.forEach((player) => {
      profs[player] = {};
    });

    statsList.forEach((stat) => {
      const player = stat.player;
      const agent = stat.agent;
      if (!profs[player]) profs[player] = {};
      if (!profs[player][agent]) {
        profs[player][agent] = { rating: 0, count: 0, gamesWon: 0, gamesTotal: 0 };
      }
      
      let currentRating = 1.0; 
      if (stat.rating !== undefined && stat.rating !== null && stat.rating !== '') {
        currentRating = typeof stat.rating === 'string' ? parseFloat(stat.rating) : stat.rating;
      } else if (stat.kills && stat.deaths) {
        currentRating = stat.deaths > 0 ? stat.kills / stat.deaths : stat.kills;
      }

      profs[player][agent].rating += currentRating;
      profs[player][agent].count += 1;

      const m = data.matches?.find((match) => match.id === stat.matchId);
      if (m) {
        profs[player][agent].gamesTotal += 1;
        const isWin = (m.attW + m.defW) > (m.attL + m.defL);
        if (isWin) {
          profs[player][agent].gamesWon += 1;
        }
      }
    });

    const matrix: Record<string, Record<string, { grade: 'S' | 'A' | 'B' | 'C' | 'D'; rating: number; count: number; winRate: number }>> = {};
    activePlayers.forEach((player) => {
      matrix[player] = {};
      standardAgents.forEach((agent) => {
        const pStat = profs[player]?.[agent];
        if (pStat && pStat.count > 0) {
          const avgRating = pStat.rating / pStat.count;
          const winRate = pStat.gamesTotal > 0 ? Math.round((pStat.gamesWon / pStat.gamesTotal) * 100) : 0;
          let grade: 'S' | 'A' | 'B' | 'C' | 'D' = 'B';
          if (avgRating >= 1.25) grade = 'S';
          else if (avgRating >= 1.08) grade = 'A';
          else if (avgRating >= 0.90) grade = 'B';
          else if (avgRating >= 0.75) grade = 'C';
          else grade = 'D';

          matrix[player][agent] = {
            grade,
            rating: parseFloat(avgRating.toFixed(2)),
            count: pStat.count,
            winRate
          };
        } else {
          matrix[player][agent] = {
            grade: 'B',
            rating: 1.0,
            count: 0,
            winRate: 0
          };
        }
      });
    });

    return matrix;
  }, [data.playerStats, data.matches, activePlayers, standardAgents]);

  const handleCycleOverride = (player: string, agent: string) => {
    const currentOverride = matrixOverrides[player]?.[agent];
    const grades: ('S' | 'A' | 'B' | 'C' | 'D' | undefined)[] = ['S', 'A', 'B', 'C', 'D', undefined];
    const nextIdx = (grades.indexOf(currentOverride) + 1) % grades.length;
    const nextGrade = grades[nextIdx];

    setMatrixOverrides(prev => {
      const playerOverrides = prev[player] ? { ...prev[player] } : {};
      if (nextGrade === undefined) {
        delete playerOverrides[agent];
      } else {
        playerOverrides[agent] = nextGrade;
      }
      return {
        ...prev,
        [player]: playerOverrides
      };
    });
  };

  const finalProficiencies = useMemo(() => {
    const matrix = { ...calculatedProficiencies };
    activePlayers.forEach((player) => {
      matrix[player] = { ...calculatedProficiencies[player] };
      standardAgents.forEach((agent) => {
        const override = matrixOverrides[player]?.[agent];
        if (override) {
          matrix[player][agent] = {
            ...matrix[player][agent],
            grade: override
          };
        }
      });
    });
    return matrix;
  }, [calculatedProficiencies, matrixOverrides, activePlayers, standardAgents]);

  // Composition style meter calculations
  const compStyle = useMemo(() => {
    let agg = 0;
    let def = 0;
    let bal = 0;
    let totalSlotsWithAgents = 0;

    draftList.forEach((slot) => {
      if (!slot.agent) return;
      totalSlotsWithAgents++;
      const ag = slot.agent.toLowerCase();
      
      if (['jett', 'raze', 'phoenix', 'neon', 'reyna', 'iso', 'breach', 'clove'].includes(ag)) {
        agg += 10;
        bal += 2;
      } 
      else if (['cypher', 'killjoy', 'deadlock', 'sage', 'vyse', 'viper', 'astra'].includes(ag)) {
        def += 10;
        bal += 2;
      }
      else {
        bal += 10;
        agg += 2;
        def += 2;
      }
    });

    if (totalSlotsWithAgents === 0) {
      return { agg: 33, def: 33, bal: 34, archetype: 'Unassigned', text: 'Select agents to view the style composition metrics.' };
    }

    const sum = agg + def + bal;
    const aggPct = Math.round((agg / sum) * 100);
    const defPct = Math.round((def / sum) * 100);
    const balPct = 100 - aggPct - defPct; 

    let archetype = 'Tactical Default';
    let text = 'Perfectly balanced composition. Offers strong information gathering (Initiator space-clearing), reliable site defense (Sentinels), and solid entry power (Duelist). High adaptability to mid-round calling adjustments.';
    
    if (aggPct > 45) {
      archetype = 'Aggressive Strike Force';
      text = 'This composition is highly aggressive, relying on rapid site entries, space creation, and fast trades. Extremely strong for fast executes and pistol rounds, but highly vulnerable to defensive crossfires if entries fail.';
    } else if (defPct > 45) {
      archetype = 'Defensive Site Fortress';
      text = 'Exceptionally defensive. Ideal for stalling enemy executes, lock-downs, and retake denial. Requires meticulous default setups and utility-heavy retakes. May struggle to create early entry space on attack side.';
    } else if (balPct > 45) {
      archetype = 'Balanced Tactical Split';
      text = 'Highly methodical setup prioritizing map control, split takes, and information-gathering. High recovery potential but relies heavily on coordination of smoke timings and flash triggers.';
    }

    return { agg: aggPct, def: defPct, bal: balPct, archetype, text };
  }, [draftList]);

  // Overall Draft Synergy & Role Checklist
  const draftAnalytics = useMemo(() => {
    let sentinelCount = 0;
    let controllerCount = 0;
    let initiatorCount = 0;
    let duelistCount = 0;
    let totalScore = 0;
    let activeDraftCount = 0;

    draftList.forEach((slot) => {
      if (!slot.player || !slot.agent) return;
      activeDraftCount++;
      const ag = slot.agent.toLowerCase();
      const grade = finalProficiencies[slot.player]?.[slot.agent]?.grade || 'B';
      
      let gradeScore = 75;
      if (grade === 'S') gradeScore = 95;
      else if (grade === 'A') gradeScore = 88;
      else if (grade === 'B') gradeScore = 78;
      else if (grade === 'C') gradeScore = 68;
      else gradeScore = 55;

      totalScore += gradeScore;

      if (['jett', 'raze', 'phoenix', 'neon', 'reyna', 'iso'].includes(ag)) duelistCount++;
      else if (['cypher', 'killjoy', 'deadlock', 'sage', 'vyse'].includes(ag)) sentinelCount++;
      else if (['omen', 'astra', 'viper', 'brimstone', 'harbor', 'clove'].includes(ag)) controllerCount++;
      else initiatorCount++;
    });

    const averageProficiency = activeDraftCount > 0 ? Math.round(totalScore / activeDraftCount) : 0;
    
    const warnings: string[] = [];
    if (activeDraftCount > 0) {
      if (sentinelCount === 0) warnings.push('No Sentinel: Defense holds and flank protection will be weak.');
      if (controllerCount === 0) warnings.push('No Controller: Team lacks defensive or execution smoke coverage.');
      if (initiatorCount === 0) warnings.push('No Initiator: Lacking crucial scouting flashes and sight recon.');
      if (duelistCount === 0) warnings.push('No Duelist: site execution entries will lack dynamic entry space.');
    }

    return {
      averageProficiency,
      sentinelCount,
      controllerCount,
      initiatorCount,
      duelistCount,
      warnings
    };
  }, [draftList, finalProficiencies]);

  // --- PLAYBOOK GENERATOR STATE ---
  const [selectedMap, setSelectedMap] = useState(data.settings.maps[0] || 'Ascent');
  const [selectedSide, setSelectedSide] = useState('Attack');
  const [selectedStyle, setSelectedStyle] = useState('Default / General');
  const [customFocus, setCustomFocus] = useState('');
  const [generating, setGenerating] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [generatedStrat, setGeneratedStrat] = useState<any | null>(null);
  const [savingStrat, setSavingStrat] = useState(false);

  // Editable generated fields
  const [editedName, setEditedName] = useState('');
  const [editedAgents, setEditedAgents] = useState('');
  const [editedOverview, setEditedOverview] = useState('');
  const [editedPhase1, setEditedPhase1] = useState('');
  const [editedPhase2, setEditedPhase2] = useState('');
  const [editedPhase3, setEditedPhase3] = useState('');
  const [editedCombo, setEditedCombo] = useState('');
  const [editedNotes, setEditedNotes] = useState('');

  // Loading messages rotation
  const loadingPrompts = [
    'Drawing tactical overlays...',
    'Simulating site crossfires...',
    'Analyzing choke point utility combinations...',
    'Reviewing space-creation vectors...',
    'Compiling elite playbook strategies...',
    'Running micro-scenarios through the tactician matrix...'
  ];

  const handleGenerateStrategy = async () => {
    setGenerating(true);
    setGeneratedStrat(null);
    let msgIndex = 0;
    setLoadingMsg(loadingPrompts[0]);
    const interval = setInterval(() => {
      msgIndex = (msgIndex + 1) % loadingPrompts.length;
      setLoadingMsg(loadingPrompts[msgIndex]);
    }, 1500);

    try {
      const res = await apiFetch('/api/gemini/generate-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          map: selectedMap,
          side: selectedSide,
          playStyle: selectedStyle,
          customFocus: customFocus
        })
      });

      if (!res.ok) throw new Error('Strategy generator failed.');
      const stratData = await res.json();
      
      setGeneratedStrat(stratData);
      setEditedName(stratData.name);
      setEditedAgents(stratData.agents);
      setEditedOverview(stratData.overview);
      setEditedPhase1(stratData.phase1);
      setEditedPhase2(stratData.phase2);
      setEditedPhase3(stratData.phase3);
      setEditedCombo(stratData.combo);
      setEditedNotes(stratData.notes);
    } catch (err) {
      console.error(err);
      alert('AI Generation timed out or failed. Please ensure your Gemini API key is set in Settings.');
    } finally {
      clearInterval(interval);
      setGenerating(false);
    }
  };

  const handleSaveToPlaybook = async () => {
    if (!editedName) return;
    setSavingStrat(true);
    try {
      const fullNotes = `**Agents Required:** ${editedAgents}\n\n**Concept:** ${editedOverview}\n\n**Prep Phase:** ${editedPhase1}\n\n**Execution Phase:** ${editedPhase2}\n\n**Late Round/Post-Plant:** ${editedPhase3}\n\n**Utility Combo:** ${editedCombo}\n\n**Coach Insight:** ${editedNotes}`;
      
      await onUpsert('Strats', {
        map: selectedMap,
        side: selectedSide,
        name: editedName,
        notes: fullNotes,
        active: 'TRUE'
      });
      
      alert('Strategy successfully saved to your active Team Playbook!');
      setGeneratedStrat(null);
      setCustomFocus('');
    } catch (err) {
      console.error(err);
    } finally {
      setSavingStrat(false);
    }
  };

  // Strategy performance calculations
  const strategyStats = useMemo(() => {
    const roundsList = data.rounds || [];
    const statsMap: Record<string, { won: number; total: number }> = {};

    roundsList.forEach((r) => {
      if (!r.strategies) return;
      const stratsRun = r.strategies.split(', ').filter(Boolean);
      stratsRun.forEach((s) => {
        const cleanName = s.trim();
        if (!statsMap[cleanName]) {
          statsMap[cleanName] = { won: 0, total: 0 };
        }
        statsMap[cleanName].total++;
        if (r.result === 'W') {
          statsMap[cleanName].won++;
        }
      });
    });

    return statsMap;
  }, [data.rounds]);

  // Opening Duel conversions
  const entryStats = useMemo(() => {
    const roundsList = data.rounds || [];
    const stats: Record<string, { fbTotal: number; fbWon: number; fdTotal: number; fdWon: number }> = {};

    activePlayers.forEach(p => {
      stats[p] = { fbTotal: 0, fbWon: 0, fdTotal: 0, fdWon: 0 };
    });

    roundsList.forEach((r) => {
      // First Blood impact
      if (r.firstKillBy && stats[r.firstKillBy] !== undefined) {
        stats[r.firstKillBy].fbTotal++;
        if (r.result === 'W') {
          stats[r.firstKillBy].fbWon++;
        }
      }
      // First Death impact
      if (r.firstDeathBy && stats[r.firstDeathBy] !== undefined) {
        stats[r.firstDeathBy].fdTotal++;
        if (r.result === 'W') {
          stats[r.firstDeathBy].fdWon++;
        }
      }
    });

    return stats;
  }, [data.rounds, activePlayers]);

  // Chemistry Matrix pairings win rates
  const chemistryMatrix = useMemo(() => {
    const matchesList = data.matches || [];
    const roundsList = data.rounds || [];
    const playerStatsList = data.playerStats || [];

    // Map matchId to the list of players who actually played
    const matchPlayersMap: Record<string, string[]> = {};
    matchesList.forEach((m) => {
      const matchStats = playerStatsList.filter(ps => ps.matchId === m.id);
      matchPlayersMap[m.id] = matchStats.map(ps => ps.player);
    });

    // We will track total rounds played together and total rounds won
    const pairings: Record<string, { total: number; won: number }> = {};

    roundsList.forEach((r) => {
      const playersInMatch = matchPlayersMap[r.matchId] || [];
      // Double loop for pairings
      for (let i = 0; i < playersInMatch.length; i++) {
        for (let j = i + 1; j < playersInMatch.length; j++) {
          const p1 = playersInMatch[i];
          const p2 = playersInMatch[j];
          if (!activePlayers.includes(p1) || !activePlayers.includes(p2)) continue;

          // Standardized key
          const key = p1 < p2 ? `${p1}|||${p2}` : `${p2}|||${p1}`;
          if (!pairings[key]) {
            pairings[key] = { total: 0, won: 0 };
          }
          pairings[key].total++;
          if (r.result === 'W') {
            pairings[key].won++;
          }
        }
      }
    });

    return pairings;
  }, [data.matches, data.rounds, data.playerStats, activePlayers]);

  // --- INTERACTIVE LINEUP SIMULATOR STATE ---
  const [simMap, setSimMap] = useState(data.settings.maps[0] || 'Ascent');
  const [simSide, setSimSide] = useState('Attack');
  const [simRoster, setSimRoster] = useState<string[]>([]);

  const handleToggleSimPlayer = (player: string) => {
    if (simRoster.includes(player)) {
      setSimRoster(simRoster.filter(p => p !== player));
    } else {
      if (simRoster.length < 5) {
        setSimRoster([...simRoster, player]);
      } else {
        alert('Rosters are limited to exactly 5 active players.');
      }
    }
  };

  // Lineup simulator logic
  const simReport = useMemo(() => {
    if (simRoster.length < 5) return null;

    let totalScore = 70; // baseline compatibility
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    // 1. Map win rates check
    const matchesOnMap = (data.matches || []).filter(m => m.map === simMap);
    const roundsOnMap = (data.rounds || []).filter(r => {
      const m = matchesOnMap.find(match => match.id === r.matchId);
      return m !== undefined && r.side === (simSide === 'Attack' ? 'Attack' : 'Defense');
    });

    // 2. Pairwise chemistry check for selected 5
    let totalPairingWinrate = 0;
    let pairingsCount = 0;
    for (let i = 0; i < simRoster.length; i++) {
      for (let j = i + 1; j < simRoster.length; j++) {
        const key = simRoster[i] < simRoster[j] ? `${simRoster[i]}|||${simRoster[j]}` : `${simRoster[j]}|||${simRoster[i]}`;
        const pStat = chemistryMatrix[key];
        if (pStat && pStat.total > 15) {
          const wr = pStat.won / pStat.total;
          totalPairingWinrate += wr;
          pairingsCount++;
          if (wr > 0.58) {
            strengths.push(`Excellent tactical link: **${simRoster[i]}** and **${simRoster[j]}** have a ${(wr * 100).toFixed(0)}% joint round win rate.`);
            totalScore += 4;
          } else if (wr < 0.44) {
            weaknesses.push(`Friction warning: **${simRoster[i]}** and **${simRoster[j]}** show a lower ${(wr * 100).toFixed(0)}% round win rate.`);
            totalScore -= 4;
          }
        }
      }
    }

    // 3. First Blood / Opening space converters
    simRoster.forEach(player => {
      const pEst = entryStats[player];
      if (pEst) {
        const fbRate = pEst.fbTotal > 0 ? pEst.fbWon / pEst.fbTotal : 0;
        const fdRate = pEst.fdTotal > 0 ? pEst.fdWon / pEst.fdTotal : 0;

        if (fbRate > 0.58 && pEst.fbTotal > 5) {
          strengths.push(`Space Creator: **${player}** converted ${(fbRate * 100).toFixed(0)}% of first bloods into round wins.`);
          totalScore += 3;
        }
        if (fdRate > 0.48 && pEst.fdTotal > 5) {
          strengths.push(`Clutch Anchor: **${player}** is highly resilient, saving ${(fdRate * 100).toFixed(0)}% of rounds when dying first.`);
          totalScore += 3;
        } else if (fdRate < 0.35 && pEst.fdTotal > 5) {
          weaknesses.push(`Vulnerability: Losing **${player}** first crumbles the round (only ${(fdRate * 100).toFixed(0)}% recovery rate).`);
          totalScore -= 2;
        }
      }
    });

    // 4. IGL Caller status on this map
    const iglRounds = roundsOnMap.filter(r => simRoster.includes(r.iglPlayer || ''));
    if (iglRounds.length > 0) {
      const iglWins = iglRounds.filter(r => r.result === 'W').length;
      const iglWr = iglWins / iglRounds.length;
      if (iglWr > 0.55) {
        strengths.push(`Leadership Advantage: Roster callers hold a ${(iglWr * 100).toFixed(0)}% call conversion on ${simMap}.`);
        totalScore += 5;
      }
    } else {
      weaknesses.push(`Calling void: No active IGL callers show logged calling rounds on ${simMap} yet.`);
      totalScore -= 5;
    }

    // Cap totalScore
    totalScore = Math.max(30, Math.min(99, totalScore));

    return {
      score: totalScore,
      strengths: strengths.slice(0, 3),
      weaknesses: weaknesses.slice(0, 3),
      verdict: totalScore >= 85 ? '🏆 TIER-1 SYNCHRONIZED' : totalScore >= 70 ? '🟢 OPERATIONAL' : '⚠️ STRATEGIC RECONSTRUCTION ADVISED'
    };
  }, [simRoster, simMap, simSide, chemistryMatrix, entryStats, data.rounds, data.matches]);

  return (
    <div className="space-y-6">
      {/* Header and Core Navigation */}
      <div className={`p-6 rounded-2xl border ${theme.border} ${theme.bg} flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4`}>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-[#ff4655]/10 rounded-lg text-[#ff4655]">
              <Brain className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-black uppercase tracking-tight">AI Coaching Hub</h2>
          </div>
          <p className="text-xs text-gray-400 font-mono">Automate playbook generation, analyze team chemistry, and run roster simulators.</p>
        </div>

        <div className="flex bg-black/30 p-1 rounded-xl border border-white/5 w-full sm:w-auto flex-wrap gap-1">
          <button
            onClick={() => setSubTab('playbook')}
            className={`flex-1 sm:flex-none py-2 px-4 rounded-lg text-xs font-bold font-mono uppercase transition-all flex items-center justify-center gap-2 ${
              subTab === 'playbook' ? 'bg-[#ff4655] text-white shadow-lg shadow-[#ff4655]/20' : 'text-gray-400 hover:text-white'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            AI Playbook Strategist
          </button>
          <button
            onClick={() => setSubTab('chemistry')}
            className={`flex-1 sm:flex-none py-2 px-4 rounded-lg text-xs font-bold font-mono uppercase transition-all flex items-center justify-center gap-2 ${
              subTab === 'chemistry' ? 'bg-[#ff4655] text-white shadow-lg shadow-[#ff4655]/20' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            Synergy & KPIs
          </button>
          <button
            onClick={() => setSubTab('drafting')}
            className={`flex-1 sm:flex-none py-2 px-4 rounded-lg text-xs font-bold font-mono uppercase transition-all flex items-center justify-center gap-2 ${
              subTab === 'drafting' ? 'bg-[#ff4655] text-white shadow-lg shadow-[#ff4655]/20' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Compass className="w-4 h-4" />
            Draft Simulator
          </button>
        </div>
      </div>

      {subTab === 'playbook' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* AI Generator Settings */}
          <div className={`col-span-1 lg:col-span-4 p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-5 h-fit`}>
            <div className="flex items-center gap-2 border-b border-white/5 pb-3">
              <Sparkles className="w-4 h-4 text-[#ff4655]" />
              <h3 className="font-black text-xs uppercase tracking-wider text-gray-200">AI Playbook Blueprint</h3>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold tracking-wider text-gray-400 font-mono">Select Map</label>
                <select
                  value={selectedMap}
                  onChange={(e) => setSelectedMap(e.target.value)}
                  className="w-full bg-black border border-white/10 text-xs p-3 rounded-lg text-white font-mono"
                >
                  {data.settings.maps.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold tracking-wider text-gray-400 font-mono">Tactical Side</label>
                <div className="grid grid-cols-2 gap-2">
                  {['Attack', 'Defense'].map(side => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => setSelectedSide(side)}
                      className={`py-2 px-3 border text-xs font-bold rounded-lg font-mono uppercase transition-all ${
                        selectedSide === side
                          ? 'border-[#ff4655] bg-[#ff4655]/10 text-white'
                          : 'border-white/10 bg-transparent text-gray-400 hover:text-white'
                      }`}
                    >
                      {side === 'Attack' ? '🎯 Attack' : '🛡️ Defense'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold tracking-wider text-gray-400 font-mono">Tactical Style</label>
                <select
                  value={selectedStyle}
                  onChange={(e) => setSelectedStyle(e.target.value)}
                  className="w-full bg-black border border-white/10 text-xs p-3 rounded-lg text-white font-mono"
                >
                  <option value="Default / General">Default / General</option>
                  <option value="Aggressive Rush">Aggressive Rush & Site Entry</option>
                  <option value="Exec & Post-plant Setup">Vaporizing Exec & Post-plant Setup</option>
                  <option value="Slow Default / Map Split">Slow Map Control & Dual Split</option>
                  <option value="Trap Play & Counter-Attack">Bait-and-Switch Trap / Retake Counter</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold tracking-wider text-gray-400 font-mono">Custom Focus / Directives</label>
                <textarea
                  value={customFocus}
                  onChange={(e) => setCustomFocus(e.target.value)}
                  placeholder="e.g., Run an A-Split using Cypher Cage lurk and Omen blind for space..."
                  className="w-full bg-black border border-white/10 text-xs p-3 rounded-lg text-white h-20 placeholder:text-gray-600 focus:outline-none focus:border-[#ff4655]"
                />
              </div>

              <button
                type="button"
                onClick={handleGenerateStrategy}
                disabled={generating}
                className="w-full py-3 bg-[#ff4655] hover:bg-[#ff4655]/95 text-white text-xs font-black rounded-lg uppercase font-mono tracking-wider shadow-lg shadow-[#ff4655]/10 flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4.5 h-4.5 animate-spin" />
                    <span>GENERATING...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4.5 h-4.5" />
                    <span>GENERATE TACTICAL SETUP</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* AI Output / Saved Playbook */}
          <div className="col-span-1 lg:col-span-8 space-y-6">
            {generating && (
              <div className={`p-12 rounded-2xl border border-dashed border-[#ff4655]/20 bg-[#ff4655]/5 flex flex-col items-center justify-center text-center space-y-4`}>
                <div className="w-12 h-12 rounded-full bg-[#ff4655]/10 flex items-center justify-center text-[#ff4655] animate-pulse">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-white font-mono uppercase tracking-wider">Scrim Engine Core Engaged</h4>
                  <p className="text-xs text-gray-400 font-mono animate-pulse">{loadingMsg}</p>
                </div>
              </div>
            )}

            {generatedStrat && !generating && (
              <div className={`p-6 rounded-2xl border border-violet-500/30 bg-violet-950/10 space-y-6 animate-fadeIn`}>
                <div className="flex justify-between items-center border-b border-violet-500/20 pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-violet-400 animate-pulse" />
                    <span className="text-[10px] font-mono text-violet-400 uppercase tracking-widest font-bold">AI Draft Output</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setGeneratedStrat(null)}
                      className="px-3 py-1 bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 rounded text-[10px] font-mono uppercase font-bold"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={handleSaveToPlaybook}
                      disabled={savingStrat}
                      className="px-3.5 py-1 bg-violet-500 hover:bg-violet-600 text-white rounded text-[10px] font-mono uppercase font-bold flex items-center gap-1.5"
                    >
                      {savingStrat ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Add to Playbook
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase font-bold text-violet-400 tracking-wider font-mono">Strategy Name</label>
                    <input
                      type="text"
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      className="w-full bg-slate-900 border border-violet-500/25 p-2 rounded text-xs text-white font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase font-bold text-violet-400 tracking-wider font-mono">Recommended Agents</label>
                    <input
                      type="text"
                      value={editedAgents}
                      onChange={(e) => setEditedAgents(e.target.value)}
                      className="w-full bg-slate-900 border border-violet-500/25 p-2 rounded text-xs text-white"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[9px] uppercase font-bold text-violet-400 tracking-wider font-mono">Tactical Concept</label>
                  <textarea
                    value={editedOverview}
                    onChange={(e) => setEditedOverview(e.target.value)}
                    className="w-full bg-slate-900 border border-violet-500/25 p-2.5 rounded text-xs text-white h-16 leading-relaxed"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] bg-white/5 text-white/70 px-1 py-0.2 rounded font-mono font-bold">1</span>
                      <label className="text-[9px] uppercase font-bold text-violet-400 tracking-wider font-mono">Early Setup</label>
                    </div>
                    <textarea
                      value={editedPhase1}
                      onChange={(e) => setEditedPhase1(e.target.value)}
                      className="w-full bg-slate-900 border border-violet-500/25 p-2.5 rounded text-[11px] text-white h-28 leading-relaxed"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] bg-white/5 text-white/70 px-1 py-0.2 rounded font-mono font-bold">2</span>
                      <label className="text-[9px] uppercase font-bold text-violet-400 tracking-wider font-mono">Execution Trigger</label>
                    </div>
                    <textarea
                      value={editedPhase2}
                      onChange={(e) => setEditedPhase2(e.target.value)}
                      className="w-full bg-slate-900 border border-violet-500/25 p-2.5 rounded text-[11px] text-white h-28 leading-relaxed"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] bg-white/5 text-white/70 px-1 py-0.2 rounded font-mono font-bold">3</span>
                      <label className="text-[9px] uppercase font-bold text-violet-400 tracking-wider font-mono">Late Round Hold</label>
                    </div>
                    <textarea
                      value={editedPhase3}
                      onChange={(e) => setEditedPhase3(e.target.value)}
                      className="w-full bg-slate-900 border border-violet-500/25 p-2.5 rounded text-[11px] text-white h-28 leading-relaxed"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-violet-500/10 pt-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase font-bold text-violet-400 tracking-wider font-mono">⚡ Primary Utility Combo</label>
                    <input
                      type="text"
                      value={editedCombo}
                      onChange={(e) => setEditedCombo(e.target.value)}
                      className="w-full bg-slate-900 border border-violet-500/25 p-2 rounded text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] uppercase font-bold text-violet-400 tracking-wider font-mono">💡 Coaching Note</label>
                    <input
                      type="text"
                      value={editedNotes}
                      onChange={(e) => setEditedNotes(e.target.value)}
                      className="w-full bg-slate-900 border border-violet-500/25 p-2 rounded text-xs text-white italic"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Existing Playbook with Stats */}
            <div className={`p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-4`}>
              <div className="flex justify-between items-center border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-gray-400" />
                  <h3 className="font-black text-xs uppercase tracking-wider text-gray-200">Active Stratbook ({data.strats.length})</h3>
                </div>
                <span className="text-[9px] font-mono text-gray-500 uppercase">Live performance indexed</span>
              </div>

              {data.strats.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-gray-500 italic">No strategies added to the playbook yet. Generate one above or create custom ones in settings!</p>
                </div>
              ) : (
                <div className="space-y-3.5 max-h-[500px] overflow-y-auto pr-1">
                  {data.strats.map((strat: Strat) => {
                    const stats = strategyStats[strat.name] || { won: 0, total: 0 };
                    const winrate = stats.total > 0 ? Math.round((stats.won / stats.total) * 100) : 0;
                    const performanceColor = winrate >= 60 ? 'text-green-400 bg-green-500/5 border-green-500/10' : winrate >= 45 ? 'text-yellow-400 bg-yellow-500/5 border-yellow-500/10' : stats.total === 0 ? 'text-gray-500 bg-transparent border-transparent' : 'text-red-400 bg-red-500/5 border-red-500/10';

                    return (
                      <div key={strat.id} className="p-4 rounded-xl border border-white/5 bg-black/25 hover:border-white/10 transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black text-white">{strat.name}</span>
                            <span className="text-[8px] bg-[#ff4655]/10 border border-[#ff4655]/15 text-[#ff4655] px-1.5 py-0.5 rounded font-mono font-bold uppercase">{strat.map}</span>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono font-bold uppercase border ${strat.side === 'Attack' ? 'text-blue-400 bg-blue-500/5 border-blue-500/10' : 'text-orange-400 bg-orange-500/5 border-orange-500/10'}`}>{strat.side}</span>
                          </div>
                          {strat.notes && (
                            <p className="text-[10px] text-gray-400 leading-relaxed font-mono line-clamp-2 white-space-pre">{strat.notes.replace(/\*\*.*\*\*/g, '').replace(/concept/i, '').trim()}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-4 shrink-0 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 border-white/5 pt-2.5 md:pt-0">
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className="text-[9px] uppercase font-bold text-gray-400 font-mono block">Scrim Winrate</span>
                              <span className="text-xs font-black font-mono text-white">
                                {stats.total > 0 ? `${winrate}%` : '-'}
                              </span>
                            </div>
                            <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full bg-red-500" style={{ width: `${winrate}%` }} />
                            </div>
                            <span className="text-[9px] font-mono text-gray-500">({stats.total} rounds)</span>
                          </div>

                          <button
                            onClick={() => onRemove('Strats', strat.id)}
                            className="p-1.5 bg-white/5 hover:bg-red-500/10 text-gray-400 hover:text-red-400 border border-white/5 rounded transition-all cursor-pointer"
                            title="Remove Strategy"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : subTab === 'chemistry' ? (
        <div className="space-y-6 animate-fadeIn">
          {/* COMPARATIVE PLAYER KPI & CLUTCH ANALYSIS */}
          <div className={`p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-6 text-left`}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/5 pb-4 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#ff4655]" />
                  <h3 className="font-black text-xs uppercase tracking-wider text-gray-200">Comparative Player KPI & Clutch Analysis</h3>
                </div>
                <p className="text-[10px] text-gray-400 font-mono">Comparing Previous Period (first 50% of matches) vs Current Period (last 50% of matches)</p>
              </div>
              
              {/* Player Selector tabs */}
              <div className="flex gap-1 bg-black/30 p-1 rounded-xl border border-white/5 overflow-x-auto w-full sm:w-auto max-w-full">
                {activePlayers.map(p => (
                  <button
                    key={p}
                    onClick={() => setSelectedKpiPlayer(p)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black font-mono uppercase transition-all ${
                      selectedKpiPlayer === p ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const p = selectedKpiPlayer || activePlayers[0];
              if (!p) return <div className="text-xs text-gray-500 font-mono text-center">No active players to analyze.</div>;
              
              const curr = currPeriodMetrics[p] || { kills: 0, deaths: 0, untradedDeaths: 0, clutchesWon: 0, clutchesAttempted: 0, throws: 0, firstDeaths: 0, hsSum: 0, hsCount: 0 };
              const prev = prevPeriodMetrics[p] || { kills: 0, deaths: 0, untradedDeaths: 0, clutchesWon: 0, clutchesAttempted: 0, throws: 0, firstDeaths: 0, hsSum: 0, hsCount: 0 };

              const currKd = curr.deaths > 0 ? (curr.kills / curr.deaths).toFixed(2) : curr.kills.toFixed(2);
              const prevKd = prev.deaths > 0 ? (prev.kills / prev.deaths).toFixed(2) : prev.kills.toFixed(2);

              const currClutchRate = curr.clutchesAttempted > 0 ? Math.round((curr.clutchesWon / curr.clutchesAttempted) * 100) : 0;
              const prevClutchRate = prev.clutchesAttempted > 0 ? Math.round((prev.clutchesWon / prev.clutchesAttempted) * 100) : 0;

              const currUntradedRate = curr.deaths > 0 ? Math.round((curr.untradedDeaths / curr.deaths) * 100) : 0;
              const prevUntradedRate = prev.deaths > 0 ? Math.round((prev.untradedDeaths / prev.deaths) * 100) : 0;

              const currHs = curr.hsCount > 0 ? Math.round(curr.hsSum / curr.hsCount) : 0;
              const prevHs = prev.hsCount > 0 ? Math.round(prev.hsSum / prev.hsCount) : 0;

              const rec = getKpiRecommendation(p, curr, prev);
              const throwsDiff = curr.throws - prev.throws;

              return (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Metric comparisons */}
                  <div className="col-span-1 lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Clutch Efficiency Card */}
                    <div className="p-4 rounded-xl border border-white/5 bg-black/25 space-y-3">
                      <div className="flex justify-between items-center border-b border-white/5 pb-2">
                        <span className="text-[10px] uppercase font-bold text-gray-400 font-mono">Clutch Efficiency</span>
                        <span className="text-[9px] bg-[#ff4655]/10 text-[#ff4655] px-1.5 py-0.5 rounded font-mono font-bold">In-Game KPI</span>
                      </div>
                      <div className="flex justify-between items-end">
                        <div className="space-y-0.5">
                          <span className="text-[9px] text-gray-500 font-mono block">Previous Period</span>
                          <span className="text-sm font-black font-mono text-gray-400">{prevClutchRate}% <span className="text-[10px] text-gray-500">({prev.clutchesWon}/{prev.clutchesAttempted})</span></span>
                        </div>
                        <div className="text-right space-y-0.5">
                          <span className="text-[9px] text-[#ff4655] font-mono block font-black">Current Period</span>
                          <span className="text-xl font-black font-mono text-white">{currClutchRate}% <span className="text-[10px] text-gray-400">({curr.clutchesWon}/{curr.clutchesAttempted})</span></span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono mt-1">
                        {currClutchRate >= prevClutchRate ? (
                          <span className="text-green-400 flex items-center gap-1 font-bold">↗ +{currClutchRate - prevClutchRate}% winrate growth</span>
                        ) : (
                          <span className="text-red-400 flex items-center gap-1 font-bold">Layout trend: ↘ -{prevClutchRate - currClutchRate}% lower efficiency</span>
                        )}
                      </div>
                    </div>

                    {/* Spacing & Trade Efficiency Card */}
                    <div className="p-4 rounded-xl border border-white/5 bg-black/25 space-y-3">
                      <div className="flex justify-between items-center border-b border-white/5 pb-2">
                        <span className="text-[10px] uppercase font-bold text-gray-400 font-mono">Un-Traded Death Rate</span>
                        <span className="text-[9px] bg-[#ff4655]/10 text-[#ff4655] px-1.5 py-0.5 rounded font-mono font-bold">Spacing & Trades</span>
                      </div>
                      <div className="flex justify-between items-end">
                        <div className="space-y-0.5">
                          <span className="text-[9px] text-gray-500 font-mono block">Previous Period</span>
                          <span className="text-sm font-black font-mono text-gray-400">{prevUntradedRate}% <span className="text-[10px] text-gray-500">({prev.untradedDeaths} deaths)</span></span>
                        </div>
                        <div className="text-right space-y-0.5">
                          <span className="text-[9px] text-[#ff4655] font-mono block font-black">Current Period</span>
                          <span className="text-xl font-black font-mono text-white">{currUntradedRate}% <span className="text-[10px] text-gray-400">({curr.untradedDeaths} deaths)</span></span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono mt-1">
                        {currUntradedRate <= prevUntradedRate ? (
                          <span className="text-green-400 flex items-center gap-1 font-bold">↗ Improved: -{prevUntradedRate - currUntradedRate}% fewer solo deaths</span>
                        ) : (
                          <span className="text-red-400 flex items-center gap-1 font-bold">Vulnerability: +{currUntradedRate - prevUntradedRate}% higher isolation</span>
                        )}
                      </div>
                    </div>

                    {/* Discipline Throws Card */}
                    <div className="p-4 rounded-xl border border-white/5 bg-black/25 space-y-3">
                      <div className="flex justify-between items-center border-b border-white/5 pb-2">
                        <span className="text-[10px] uppercase font-bold text-gray-400 font-mono">Discipline Throws</span>
                        <span className="text-[9px] bg-[#ff4655]/10 text-[#ff4655] px-1.5 py-0.5 rounded font-mono font-bold">Discipline</span>
                      </div>
                      <div className="flex justify-between items-end">
                        <div className="space-y-0.5">
                          <span className="text-[9px] text-gray-500 font-mono block">Previous Period</span>
                          <span className="text-sm font-black font-mono text-gray-400">{prev.throws} thrown rounds</span>
                        </div>
                        <div className="text-right space-y-0.5">
                          <span className="text-[9px] text-[#ff4655] font-mono block font-black">Current Period</span>
                          <span className="text-xl font-black font-mono text-white">{curr.throws} thrown rounds</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono mt-1">
                        {throwsDiff <= 0 ? (
                          <span className="text-green-400 flex items-center gap-1 font-bold">↗ Disciplined: {throwsDiff === 0 ? 'No change' : `${throwsDiff} fewer throws`}</span>
                        ) : (
                          <span className="text-red-400 flex items-center gap-1 font-bold">Risk trend: +{throwsDiff} critical round throws</span>
                        )}
                      </div>
                    </div>

                    {/* Fragging & KD Ratio Card */}
                    <div className="p-4 rounded-xl border border-white/5 bg-black/25 space-y-3">
                      <div className="flex justify-between items-center border-b border-white/5 pb-2">
                        <span className="text-[10px] uppercase font-bold text-gray-400 font-mono">Kill / Death Ratio</span>
                        <span className="text-[9px] bg-[#ff4655]/10 text-[#ff4655] px-1.5 py-0.5 rounded font-mono font-bold">Mechanical</span>
                      </div>
                      <div className="flex justify-between items-end">
                        <div className="space-y-0.5">
                          <span className="text-[9px] text-gray-500 font-mono block">Previous Period</span>
                          <span className="text-sm font-black font-mono text-gray-400">{prevKd} K/D <span className="text-[10px] text-gray-500">({prev.kills} K)</span></span>
                        </div>
                        <div className="text-right space-y-0.5">
                          <span className="text-[9px] text-[#ff4655] font-mono block font-black">Current Period</span>
                          <span className="text-xl font-black font-mono text-white">{currKd} K/D <span className="text-[10px] text-gray-400">({curr.kills} K)</span></span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono mt-1">
                        {parseFloat(currKd) >= parseFloat(prevKd) ? (
                          <span className="text-green-400 flex items-center gap-1 font-bold">↗ +{Math.round((parseFloat(currKd) - parseFloat(prevKd)) * 100) / 100} mechanical increase</span>
                        ) : (
                          <span className="text-red-400 flex items-center gap-1 font-bold">↘ -{Math.round((parseFloat(prevKd) - parseFloat(currKd)) * 100) / 100} lower efficiency</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Smart recommendation Card */}
                  <div className="col-span-1 lg:col-span-5 p-5 rounded-xl border border-white/5 bg-white/2 space-y-4 h-full flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                        <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400 font-black">AI KPI Diagnosis</span>
                      </div>
                      
                      <div className="space-y-1">
                        <span className="text-[9px] uppercase font-bold text-gray-400 font-mono">Primary Focus Area</span>
                        <h4 className="text-xs font-black font-mono uppercase text-white tracking-tight">{rec.focus}</h4>
                      </div>

                      <p className="text-[11px] font-mono text-gray-300 leading-relaxed bg-black/25 border border-white/5 rounded-lg p-3.5 italic">
                        "{rec.text}"
                      </p>
                    </div>

                    <div className="text-[9px] font-mono text-gray-500 border-t border-white/5 pt-3 mt-3 flex items-center justify-between">
                      <span>Status: {rec.severity === 'high' ? '🚨 CRITICAL' : rec.severity === 'medium' ? '⚠️ MONITOR' : '🟢 STABLE'}</span>
                      <span>Target: Scrim Season</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Synergy Matrix Heatmap */}
          <div className={`p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-4`}>
            <div className="flex justify-between items-center border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-400" />
                <h3 className="font-black text-xs uppercase tracking-wider text-gray-200">Roster Synergy Heatmap (Round Win Rates)</h3>
              </div>
              <span className="text-[9px] font-mono text-gray-500 uppercase">Cross-pair analytics</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[550px]">
                <thead>
                  <tr className="border-b border-white/5 font-mono text-[9px] text-gray-400 uppercase">
                    <th className="py-2.5 px-3">Player</th>
                    {activePlayers.map(p => <th key={p} className="py-2.5 px-3 text-center font-bold">{p}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {activePlayers.map((p1) => (
                    <tr key={p1} className="border-b border-white/5 text-[11px] font-mono hover:bg-white/2">
                      <td className="py-3 px-3 font-bold text-white uppercase">{p1}</td>
                      {activePlayers.map((p2) => {
                        if (p1 === p2) {
                          return <td key={p2} className="py-3 px-3 text-center text-gray-600 font-bold bg-white/2">-</td>;
                        }
                        const key = p1 < p2 ? `${p1}|||${p2}` : `${p2}|||${p1}`;
                        const stats = chemistryMatrix[key];
                        if (!stats || stats.total < 10) {
                          return <td key={p2} className="py-3 px-3 text-center text-gray-500 italic bg-black/10">insufficient</td>;
                        }
                        const wr = Math.round((stats.won / stats.total) * 100);
                        const heatmapBg = wr >= 62 ? 'bg-green-500/25 text-green-300' : wr >= 53 ? 'bg-green-500/10 text-green-400' : wr >= 45 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/20 text-red-400';

                        return (
                          <td key={p2} className={`py-3 px-3 text-center font-bold font-mono transition-all ${heatmapBg}`} title={`${stats.won}/${stats.total} rounds won together`}>
                            {wr}%
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Entry Duel and FD Recoveries */}
            <div className={`col-span-1 lg:col-span-5 p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-4`}>
              <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                <Target className="w-4 h-4 text-[#ff4655]" />
                <h3 className="font-black text-xs uppercase tracking-wider text-gray-200">First Blood / First Death Conversion</h3>
              </div>

              <div className="space-y-3.5">
                {activePlayers.map(p => {
                  const est = entryStats[p] || { fbTotal: 0, fbWon: 0, fdTotal: 0, fdWon: 0 };
                  const fbWr = est.fbTotal > 0 ? Math.round((est.fbWon / est.fbTotal) * 100) : 0;
                  const fdWr = est.fdTotal > 0 ? Math.round((est.fdWon / est.fdTotal) * 100) : 0;

                  return (
                    <div key={p} className="p-3 bg-black/25 border border-white/5 rounded-xl space-y-2.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black text-white uppercase tracking-tight">{p}</span>
                        <span className="text-[8px] font-mono text-gray-500">First-duel counts: {est.fbTotal + est.fdTotal}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <span className="text-[9px] uppercase font-mono font-bold text-gray-400 block">First Blood Win Rate</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-mono font-black ${fbWr >= 60 ? 'text-green-400' : fbWr >= 45 ? 'text-yellow-400' : est.fbTotal === 0 ? 'text-gray-500' : 'text-red-400'}`}>
                              {est.fbTotal > 0 ? `${fbWr}%` : 'N/A'}
                            </span>
                            <span className="text-[9px] font-mono text-gray-500">({est.fbWon}/{est.fbTotal})</span>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[9px] uppercase font-mono font-bold text-gray-400 block">First Death Recovery</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-mono font-black ${fdWr >= 45 ? 'text-green-400' : fdWr >= 35 ? 'text-yellow-400' : est.fdTotal === 0 ? 'text-gray-500' : 'text-red-400'}`}>
                              {est.fdTotal > 0 ? `${fdWr}%` : 'N/A'}
                            </span>
                            <span className="text-[9px] font-mono text-gray-500">({est.fdWon}/{est.fdTotal})</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Lineup Interactive Simulator */}
            <div className={`col-span-1 lg:col-span-7 p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-5`}>
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-violet-400" />
                  <h3 className="font-black text-xs uppercase tracking-wider text-gray-200">Interactive Lineup Compatibility Simulator</h3>
                </div>
                <span className="text-[9px] font-mono text-gray-500 uppercase">Roster Optimizer</span>
              </div>

              {/* Sim Selectors */}
              <div className="grid grid-cols-2 gap-4 bg-black/15 p-3 rounded-xl border border-white/5">
                <div className="space-y-1">
                  <span className="text-[9px] uppercase font-bold text-gray-400 font-mono">Sim Map</span>
                  <select
                    value={simMap}
                    onChange={(e) => setSimMap(e.target.value)}
                    className="w-full bg-black border border-white/10 text-xs p-2 rounded text-white font-mono"
                  >
                    {data.settings.maps.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] uppercase font-bold text-gray-400 font-mono">Sim Side</span>
                  <select
                    value={simSide}
                    onChange={(e) => setSimSide(e.target.value)}
                    className="w-full bg-black border border-white/10 text-xs p-2 rounded text-white font-mono"
                  >
                    <option value="Attack">Attacking Side</option>
                    <option value="Defense">Defending Side</option>
                  </select>
                </div>
              </div>

              {/* Roster Pick list */}
              <div className="space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider font-mono">Pick Active 5 Players:</span>
                <div className="flex flex-wrap gap-2">
                  {activePlayers.map(p => {
                    const isSelected = simRoster.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handleToggleSimPlayer(p)}
                        className={`py-2 px-3.5 border text-xs font-bold rounded-lg font-mono uppercase transition-all flex items-center gap-1.5 ${
                          isSelected
                            ? 'border-violet-500 bg-violet-500/10 text-white shadow-sm'
                            : 'border-white/15 bg-transparent text-gray-400 hover:text-white'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 text-violet-400" />}
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Simulator output */}
              {simRoster.length < 5 ? (
                <div className="p-8 text-center border border-dashed border-white/5 rounded-xl bg-black/5 text-gray-500 text-xs italic">
                  Select exactly 5 players to simulate roster compatibility, chemistry indexes, and strategic alignment on {simMap} ({simSide}).
                </div>
              ) : (
                simReport && (
                  <div className="space-y-5 bg-violet-950/10 border border-violet-500/20 p-5 rounded-xl animate-fadeIn">
                    <div className="flex justify-between items-center border-b border-violet-500/20 pb-3">
                      <div>
                        <span className="text-[9px] uppercase font-black text-violet-400 tracking-wider font-mono">Tactical Verdict</span>
                        <h4 className="text-sm font-black text-white uppercase tracking-tight font-sans mt-0.5">{simReport.verdict}</h4>
                      </div>

                      <div className="text-right">
                        <span className="text-[9px] uppercase font-black text-violet-400 tracking-wider font-mono">Compatibility Score</span>
                        <h4 className="text-2xl font-black font-mono text-white mt-0.5">{simReport.score}%</h4>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {simReport.strengths.length > 0 && (
                        <div className="space-y-1.5">
                          <span className="text-[9px] font-bold text-green-400 uppercase tracking-wider font-mono flex items-center gap-1">
                            <ArrowUpRight className="w-3.5 h-3.5" /> Lineup Strengths
                          </span>
                          <div className="space-y-1 pl-1">
                            {simReport.strengths.map((str, idx) => (
                              <p key={idx} className="text-[11px] text-gray-300 font-mono leading-relaxed" dangerouslySetInnerHTML={{ __html: str }} />
                            ))}
                          </div>
                        </div>
                      )}

                      {simReport.weaknesses.length > 0 && (
                        <div className="space-y-1.5 pt-1.5 border-t border-white/5">
                          <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider font-mono flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Frictional Risks
                          </span>
                          <div className="space-y-1 pl-1">
                            {simReport.weaknesses.map((weak, idx) => (
                              <p key={idx} className="text-[11px] text-gray-300 font-mono leading-relaxed" dangerouslySetInnerHTML={{ __html: weak }} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      ) : (
        /* DRAFTING SIMULATOR & AGENT PROFICIENCY MATRIX TAB */
        <div className="space-y-6 animate-fadeIn text-left">
          {/* Agent Proficiency Matrix */}
          <div className={`p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-4`}>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/5 pb-3 gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-violet-400" />
                  <h3 className="font-black text-xs uppercase tracking-wider text-gray-200">Agent Proficiency Drafting Matrix</h3>
                </div>
                <p className="text-[10px] text-gray-400 font-mono">Calculated from scrim performance logs. Click on cells to dynamically cycle manual overrides (S ➡️ A ➡️ B ➡️ C ➡️ D ➡️ Auto) to simulate roster adjustments.</p>
              </div>
              <span className="text-[9px] bg-violet-500/10 text-violet-400 px-2 py-1 rounded font-mono font-bold shrink-0 uppercase">Click Cell to Override</span>
            </div>

            <div className="overflow-x-auto select-none">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="border-b border-white/5 font-mono text-[9px] text-gray-400 uppercase">
                    <th className="py-2.5 px-3">Player</th>
                    {standardAgents.map(ag => (
                      <th key={ag} className="py-2.5 px-2 text-center font-bold text-[9px] min-w-[55px]">{ag}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activePlayers.map((player) => (
                    <tr key={player} className="border-b border-white/5 text-[11px] font-mono hover:bg-white/2 transition-colors">
                      <td className="py-3 px-3 font-bold text-white uppercase">{player}</td>
                      {standardAgents.map((agent) => {
                        const prof = finalProficiencies[player]?.[agent];
                        const isOverride = matrixOverrides[player]?.[agent] !== undefined;
                        const grade = prof?.grade || 'B';
                        const count = prof?.count || 0;

                        let gradeColor = 'bg-gray-500/10 text-gray-400 border-white/5';
                        if (grade === 'S') gradeColor = 'bg-purple-500/20 text-purple-300 border-purple-500/30';
                        else if (grade === 'A') gradeColor = 'bg-green-500/20 text-green-300 border-green-500/30';
                        else if (grade === 'B') gradeColor = 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30';
                        else if (grade === 'C') gradeColor = 'bg-blue-500/15 text-blue-300 border-blue-500/30';
                        else if (grade === 'D') gradeColor = 'bg-red-500/15 text-red-300 border-red-500/30';

                        return (
                          <td key={agent} className="py-2 px-1 text-center">
                            <button
                              type="button"
                              onClick={() => handleCycleOverride(player, agent)}
                              className={`w-11 py-1 rounded text-[10px] font-black border transition-all cursor-pointer ${gradeColor} ${
                                isOverride ? 'ring-1 ring-violet-400 animate-pulse' : ''
                              }`}
                              title={`${player} on ${agent}: Grade ${grade} (${count} games logged) ${isOverride ? '(Overridden)' : '(Auto)'}`}
                            >
                              {grade}
                              {isOverride && <span className="text-[7px] block leading-none font-bold text-violet-400">OVR</span>}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Draft Setup board */}
            <div className={`col-span-1 lg:col-span-5 p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-4`}>
              <div className="flex items-center gap-2 border-b border-white/5 pb-3">
                <Compass className="w-4 h-4 text-[#ff4655]" />
                <h3 className="font-black text-xs uppercase tracking-wider text-gray-200">Active Team Composition Drafter</h3>
              </div>

              <div className="space-y-4">
                {draftList.map((slot, idx) => {
                  const selectedPlayerProf = slot.agent && finalProficiencies[slot.player]?.[slot.agent];
                  const grade = selectedPlayerProf?.grade || 'B';
                  const count = selectedPlayerProf?.count || 0;

                  return (
                    <div key={idx} className="p-3 bg-black/25 border border-white/5 rounded-xl space-y-2.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-mono text-gray-400 uppercase font-black">Position {idx + 1}</span>
                        {slot.agent && (
                          <span className={`text-[9px] font-mono font-black uppercase px-2 py-0.5 rounded border ${
                            grade === 'S' ? 'text-purple-400 border-purple-500/25 bg-purple-500/5' :
                            grade === 'A' ? 'text-green-400 border-green-500/25 bg-green-500/5' :
                            grade === 'B' ? 'text-yellow-400 border-yellow-500/25 bg-yellow-500/5' :
                            'text-gray-400 border-white/10'
                          }`}>
                            Proficiency: {grade} ({count} Scrims)
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[9px] uppercase font-bold text-gray-500 font-mono">Player</label>
                          <select
                            value={slot.player}
                            onChange={(e) => {
                              const newDraft = [...draftList];
                              newDraft[idx].player = e.target.value;
                              setDraftList(newDraft);
                            }}
                            className="w-full bg-black border border-white/10 text-xs p-2 rounded text-white font-mono"
                          >
                            <option value="">-- Pick Player --</option>
                            {activePlayers.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] uppercase font-bold text-gray-500 font-mono">Agent</label>
                          <select
                            value={slot.agent}
                            onChange={(e) => {
                              const newDraft = [...draftList];
                              newDraft[idx].agent = e.target.value;
                              setDraftList(newDraft);
                            }}
                            className="w-full bg-black border border-white/10 text-xs p-2 rounded text-white font-mono"
                          >
                            <option value="">-- Pick Agent --</option>
                            {standardAgents.map(ag => <option key={ag} value={ag}>{ag}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Metrics Style Meter Output */}
            <div className={`col-span-1 lg:col-span-7 p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-6 flex flex-col justify-between`}>
              <div className="space-y-5">
                <div className="flex justify-between items-center border-b border-white/5 pb-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#ff4655]" />
                    <h3 className="font-black text-xs uppercase tracking-wider text-gray-200">Composition Style Analysis</h3>
                  </div>
                  <span className="text-[10px] font-mono text-[#ff4655] uppercase tracking-wider font-black">{compStyle.archetype}</span>
                </div>

                {/* STYLE METER (Aggressive, Defensive, Balanced) */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] font-mono font-bold text-gray-400">
                    <span className="text-red-400 flex items-center gap-1">🔴 Aggressive ({compStyle.agg}%)</span>
                    <span className="text-gray-300 flex items-center gap-1">⚪ Tactical ({compStyle.bal}%)</span>
                    <span className="text-blue-400 flex items-center gap-1">🔵 Defensive ({compStyle.def}%)</span>
                  </div>

                  {/* Horizontal Stacked Bar */}
                  <div className="w-full h-4 bg-white/5 rounded-full overflow-hidden flex border border-white/10">
                    <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${compStyle.agg}%` }} title={`Aggressive: ${compStyle.agg}%`} />
                    <div className="h-full bg-neutral-500 transition-all duration-500" style={{ width: `${compStyle.bal}%` }} title={`Tactical/Balanced: ${compStyle.bal}%`} />
                    <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${compStyle.def}%` }} title={`Defensive: ${compStyle.def}%`} />
                  </div>
                </div>

                {/* Archetype explanation */}
                <div className="p-4 rounded-xl border border-white/5 bg-black/25 space-y-2">
                  <span className="text-[9px] uppercase font-bold text-gray-400 font-mono">Archetype Tactical Briefing</span>
                  <p className="text-[11px] font-mono text-gray-300 leading-relaxed italic">
                    "{compStyle.text}"
                  </p>
                </div>

                {/* Synergy rating display */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-xl border border-white/5 bg-black/25 text-center">
                    <span className="text-[9px] uppercase font-bold text-gray-400 font-mono block mb-1">Draft Synergy Rating</span>
                    <span className="text-2xl font-black font-mono text-white">
                      {draftAnalytics.averageProficiency > 0 ? `${draftAnalytics.averageProficiency}%` : '--'}
                    </span>
                    <span className="text-[8px] font-mono text-gray-500 block mt-0.5">
                      {draftAnalytics.averageProficiency >= 88 ? '🟢 TIER-1 OPTIMIZED' : draftAnalytics.averageProficiency >= 78 ? '🟡 COMPETENT' : '🔴 NEEDS COMP REBUILD'}
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl border border-white/5 bg-black/25 space-y-1 text-xs">
                    <span className="text-[9px] uppercase font-bold text-gray-400 font-mono block mb-1">Role Checklist</span>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono text-gray-300">
                      <div className="flex justify-between"><span>Duelist:</span> <strong className="text-white">{draftAnalytics.duelistCount}</strong></div>
                      <div className="flex justify-between"><span>Sentinel:</span> <strong className="text-white">{draftAnalytics.sentinelCount}</strong></div>
                      <div className="flex justify-between"><span>Smokes:</span> <strong className="text-white">{draftAnalytics.controllerCount}</strong></div>
                      <div className="flex justify-between"><span>Info:</span> <strong className="text-white">{draftAnalytics.initiatorCount}</strong></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Warnings and actionable lists */}
              {draftAnalytics.warnings.length > 0 && (
                <div className="p-4 bg-red-500/5 border border-red-500/25 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-red-400 font-mono uppercase">
                    <AlertTriangle className="w-4 h-4" /> Composition Warnings ({draftAnalytics.warnings.length})
                  </div>
                  <div className="space-y-1">
                    {draftAnalytics.warnings.map((w, i) => (
                      <p key={i} className="text-[10px] font-mono text-gray-300 flex items-start gap-1.5">
                        <span className="text-[#ff4655] select-none">▪</span> {w}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

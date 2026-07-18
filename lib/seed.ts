import { uid } from './utils';

// Default seed builder matching the original sheet database. Runs only when the
// datastore is completely empty (fresh install) — production is already populated.
export function createSeed() {
  const y = new Date().getFullYear();
  const mo = String(new Date().getMonth() + 1).padStart(2, '0');

  const settings = {
    teamName: 'MoeAZack Valorant Tracker',
    season: 'Split 2 (preview)',
    theme: 'radiant',
    density: 'comfortable',
    weekStart: 1,
    confirmOnSave: true,
    confirmOnDelete: true,
    players: ['Shalaby', 'Shniider', 'Depyro', 'Chrollo', 'Yassein'],
    maps: ['Abyss', 'Ascent', 'Bind', 'Breeze', 'Corrode', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split', 'Sunset'],
    agents: ['Astra', 'Breach', 'Brimstone', 'Chamber', 'Clove', 'Cypher', 'Deadlock', 'Fade', 'Gekko', 'Harbor', 'Iso', 'Jett', 'KAY/O', 'Killjoy', 'Neon', 'Omen', 'Phoenix', 'Raze', 'Reyna', 'Sage', 'Skye', 'Sova', 'Viper', 'Vyse', 'Yoru'],
    matchTypes: ['Scrim', 'Official', 'Tournament'],
    attendanceStates: ['Prac', 'Official', 'OFF', 'Late', 'Absent'],
    goalStates: ['Open', 'In progress', 'Done'],
    calendars: [
      { key: 'practice', name: 'Practice', color: '#ff4655', gcalId: '', sync: false },
      { key: 'official', name: 'Officials', color: '#3aa0ff', gcalId: '', sync: false },
      { key: 'review', name: 'VOD review', color: '#3ddc84', gcalId: '', sync: false }
    ],
    riotIds: {} as Record<string, { name: string; tag: string; region?: string; level?: number }>,
    vlr: { baseUrl: '', teamId: '', teamName: '' },
    ai: { model: 'gemini-2.5-flash' },
    weights: { mapWin: 25, attWin: 12.5, defWin: 12.5, pistol: 20, eco: 10, bonus: 10, kd: 10 },
    buyTypes: ['Full', 'Half', 'Force', 'Bonus', 'Eco'],
    winReasons: ['Elimination', 'Post-plant', 'Defuse', 'Retake', 'Time', 'Spike'],
    sites: ['A', 'B', 'C'],
    vetoActions: ['ban', 'pick', 'decider'],
    stats: {
      shrinkK: 10,
      decayEnabled: true,
      halfLifeDays: 120,
      lowSample: 15,
      rollingWindow: 10
    }
  };

  const secrets = {
    ANTHROPIC_API_KEY: false,
    HENRIK_API_KEY: false
  };

  const schedule = [
    {
      id: uid(),
      date: `${y}-${mo}-08`,
      kind: '',
      primary: 'Ascent',
      secondary: 'new comp',
      notes: '',
      attendance: { Shalaby: 'Prac', Shniider: 'Prac', Depyro: 'Prac', Chrollo: 'Prac', Yassein: 'Prac' },
      calendarKey: 'practice',
      gcalEventId: ''
    },
    {
      id: uid(),
      date: `${y}-${mo}-14`,
      kind: '',
      primary: 'VOD review',
      secondary: '',
      notes: 'Bind bonus rounds',
      attendance: {},
      calendarKey: 'review',
      gcalEventId: ''
    }
  ];

  const goals = [
    {
      id: uid(),
      date: `${y}-${mo}-05`,
      goal: 'Bind: stop losing the bonus round',
      notes: 'Save more',
      status: 'Open',
      owner: ''
    }
  ];

  const matches: any[] = [];
  const playerStats: any[] = [];
  const soloq: any[] = [];
  const rounds: any[] = [];
  const vetos: any[] = [];
  const strats: any[] = [];
  const stratRuns: any[] = [];

  const demo = [
    [`${y}-${mo}-09`, 'Gamax', 'Ascent', 9, 3, 4, 7, 'W', 'L', 'W', 'L', 'W', 'W'],
    [`${y}-${mo}-09`, 'Gamax', 'Bind', 5, 7, 4, 8, 'L', 'L', 'L', 'W', 'L', 'L'],
    [`${y}-${mo}-15`, 'Nasr', 'Icebox', 8, 4, 5, 6, 'W', 'W', 'L', 'W', 'W', 'L'],
    [`${y}-${mo}-16`, 'Top GZ', 'Split', 7, 5, 6, 5, 'L', 'W', 'W', 'W', 'L', 'W'],
    [`${y}-${mo}-21`, 'R8', 'Bind', 3, 9, 5, 7, 'L', 'L', 'L', 'L', 'W', 'L']
  ];

  demo.forEach((r, idx) => {
    const mid = uid();
    matches.push({
      id: mid,
      date: r[0],
      type: 'Official',
      opponent: r[1],
      map: r[2],
      attW: Number(r[3]),
      attL: Number(r[4]),
      defW: Number(r[5]),
      defL: Number(r[6]),
      pistolAtt: r[7],
      pistolDef: r[8],
      ecoAtt: r[9],
      ecoDef: r[10],
      bonusAtt: r[11],
      bonusDef: r[12],
      vod: '',
      notes: '',
      source: 'manual',
      vlrMatchId: ''
    });

    settings.players.forEach((p, pIdx) => {
      const b = 12 + ((pIdx * 3 + Number(r[3])) % 8);
      playerStats.push({
        id: uid(),
        matchId: mid,
        player: p,
        agent: settings.agents[pIdx % settings.agents.length],
        kAtt: b,
        kDef: b - 1 + (pIdx % 3),
        dAtt: b - 2 + (pIdx % 4),
        dDef: b - 3 + (pIdx % 2),
        aAtt: 3 + (pIdx % 5),
        aDef: 2 + (pIdx % 4),
        kills: b + b - 1 + (pIdx % 3),
        deaths: b - 2 + (pIdx % 4) + b - 3 + (pIdx % 2),
        assists: 3 + (pIdx % 5) + 2 + (pIdx % 4),
        acs: 180 + ((pIdx * 17 + Number(r[3])) % 90),
        adr: 120 + ((pIdx * 11) % 60),
        hs: 20 + ((pIdx * 5) % 18),
        fk: pIdx % 4,
        fd: (pIdx + 1) % 3,
        rating: (6.4 + ((pIdx * 7 + Number(r[3])) % 9) / 10).toFixed(1)
      });
    });
  });

  if (matches.length > 0) {
    const m0 = matches[0];
    for (let i = 1; i <= 24; i++) {
      rounds.push({
        id: uid(),
        matchId: m0.id,
        roundNo: i,
        side: i <= 12 ? 'Att' : 'Def',
        buy: ['Full', 'Full', 'Eco', 'Bonus', 'Half', 'Force'][i % 6],
        enemyBuy: ['Full', 'Eco', 'Full', 'Half', 'Bonus', 'Full'][i % 6],
        result: i % 3 === 0 ? 'L' : 'W',
        winBy: ['Elimination', 'Post-plant', 'Retake', 'Time', 'Defuse', 'Elimination'][i % 6],
        plant: i % 4 === 0 ? 'TRUE' : '',
        site: ['A', 'B', 'A', 'B'][i % 4],
        notes: ''
      });
    }

    [
      ['us', 'ban', 'Breeze'],
      ['them', 'ban', 'Lotus'],
      ['us', 'pick', 'Ascent'],
      ['them', 'pick', 'Bind'],
      ['', 'decider', 'Haven']
    ].forEach((v, i) => {
      vetos.push({
        id: uid(),
        matchId: m0.id,
        date: m0.date,
        opponent: m0.opponent,
        seq: i + 1,
        actor: v[0],
        action: v[1],
        map: v[2],
        result: ''
      });
    });
  }

  [8, 9, 10].forEach((dd, di) => {
    settings.players.forEach((p, i) => {
      soloq.push({
        id: uid(),
        date: `${y}-${mo}-${String(dd).padStart(2, '0')}`,
        player: p,
        wins: (i + di) % 5,
        losses: (i * 2 + di) % 4,
        rank: 'Immortal ' + (1 + (i % 3)),
        rr: 20 + ((i * 13 + di * 7) % 60),
        source: 'manual'
      });
    });
  });

  [
    ['Ascent', 'Att', 'A Exec'],
    ['Ascent', 'Def', 'Mid control'],
    ['Bind', 'Att', 'Gekko Ult B'],
    ['Bind', 'Retake', 'Default retake']
  ].forEach((t) => {
    const sid = uid();
    strats.push({
      id: sid,
      map: t[0],
      side: t[1],
      name: t[2],
      notes: '',
      active: 'TRUE'
    });

    [
      ['W', ''],
      ['L', 'Forgot to trade the entry'],
      ['W', '']
    ].forEach((r) => {
      stratRuns.push({
        id: uid(),
        stratId: sid,
        matchId: '',
        date: `${y}-${mo}-09`,
        map: t[0],
        side: t[1],
        result: r[0],
        reason: r[1]
      });
    });
  });

  return {
    settings,
    secrets,
    schedule,
    goals,
    matches,
    playerStats,
    soloq,
    rounds,
    vetos,
    strats,
    stratRuns,
    serverTime: `${y}-${mo}-${String(new Date().getDate()).padStart(2, '0')}`
  };
}

export interface CalendarConfig {
  key: string;
  name: string;
  color: string;
  gcalId: string;
  sync: boolean;
}

export interface RiotIdConfig {
  name: string;
  tag: string;
  region?: string;
  level?: number;
}

export interface StatsConfig {
  shrinkK: number;
  decayEnabled?: boolean;
  halfLifeDays?: number;
  lowSample: number;
  rollingWindow?: number;
}

export interface WeightsConfig {
  mapWin: number;
  attWin: number;
  defWin: number;
  pistol: number;
  eco: number;
  bonus: number;
  kd: number;
}

export interface Settings {
  teamName: string;
  season: string;
  theme: string;
  density: string;
  weekStart: number;
  confirmOnSave: boolean;
  confirmOnDelete: boolean;
  players: string[];
  maps: string[];
  agents: string[];
  inactivePlayers?: string[];
  inactiveMaps?: string[];
  inactiveAgents?: string[];
  matchTypes: string[];
  attendanceStates: string[];
  goalStates: string[];
  calendars: CalendarConfig[];
  riotIds: Record<string, RiotIdConfig>;
  vlr: {
    baseUrl: string;
    teamId: string;
    teamName: string;
  };
  ai: {
    model: string;
  };
  weights: WeightsConfig;
  buyTypes: string[];
  winReasons: string[];
  sites: string[];
  vetoActions: string[];
  stats?: StatsConfig;
  discordWebhook?: string;
  henrikApiKey?: string;
  gridApiKey?: string;
}

export interface Schedule {
  id: string;
  date: string;
  kind?: string;
  primary: string;
  secondary?: string;
  notes?: string;
  attendance: Record<string, string>;
  calendarKey?: string;
  gcalEventId?: string;
}

export interface Goal {
  id: string;
  date: string;
  goal: string;
  notes?: string;
  status: string;
  owner?: string;
}

export interface Match {
  id: string;
  date: string;
  type: string;
  opponent: string;
  map: string;
  attW: number;
  attL: number;
  defW: number;
  defL: number;
  pistolAtt?: string;
  pistolDef?: string;
  ecoAtt?: string;
  ecoDef?: string;
  bonusAtt?: string;
  bonusDef?: string;
  vod?: string;
  notes?: string;
  source?: string;
  vlrMatchId?: string;
}

export interface PlayerStats {
  id: string;
  matchId: string;
  player: string;
  agent: string;
  kAtt: number;
  kDef: number;
  dAtt: number;
  dDef: number;
  aAtt: number;
  aDef: number;
  kills: number;
  deaths: number;
  assists: number;
  acs?: number;
  adr?: number;
  hs?: number;
  fk?: number;
  fd?: number;
  rating?: string | number;
  plants?: number;
  defuses?: number;
  cl?: number;
  clAtt?: number;
  mk3?: number;
  mk4?: number;
  mk5?: number;
  dTraded?: number;
  kTraded?: number;
}

export interface SoloQ {
  id: string;
  date: string;
  player: string;
  wins: number;
  losses: number;
  rank?: string;
  rr?: number | string;
  source?: string;
}

export interface Round {
  id: string;
  matchId: string;
  roundNo: number;
  side: string;
  buy?: string;
  enemyBuy?: string;
  result: string;
  winBy?: string;
  plant?: string;
  site?: string;
  notes?: string;
  isThrow?: string;
  thrownBy?: string;
  throwReason?: string;
  firstKillBy?: string;
  firstDeathBy?: string;
  clutchType?: string; // "1v1", "1v2", "1v3"
  clutchPlayer?: string;
  clutchResult?: string; // "W" or "L"
  iglPlayer?: string;
  iglRole?: string; // "Primary" or "Secondary"
  midRoundIglChange?: boolean | string;
  strategies?: string; // Comma-separated strategies run
}

export interface Veto {
  id: string;
  matchId: string;
  date: string;
  opponent: string;
  seq: number;
  actor: string;
  action: string;
  map: string;
  result?: string;
}

export interface Strat {
  id: string;
  map: string;
  side: string;
  name: string;
  notes?: string;
  active: string | boolean;
}

export interface StratRun {
  id: string;
  stratId: string;
  matchId?: string;
  date: string;
  map: string;
  side: string;
  result: string;
  reason?: string;
}

export interface TrackerData {
  settings: Settings;
  secrets: Record<string, boolean>;
  schedule: Schedule[];
  goals: Goal[];
  matches: Match[];
  playerStats: PlayerStats[];
  soloq: SoloQ[];
  rounds: Round[];
  vetos: Veto[];
  strats: Strat[];
  stratRuns: StratRun[];
  serverTime: string;
}

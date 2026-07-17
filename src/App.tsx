import React, { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { TrackerData, Settings } from './types';
import LoginScreen from './components/LoginScreen';
import { apiFetch } from './utils/api';

// Heavy route views are code-split so the initial bundle only loads the shell + login.
const Dashboard = lazy(() => import('./components/Dashboard'));
const CalendarGoals = lazy(() => import('./components/CalendarGoals'));
const MatchLogRounds = lazy(() => import('./components/MatchLogRounds'));
const MapBestStats = lazy(() => import('./components/MapBestStats'));
const TeamCompositions = lazy(() => import('./components/TeamCompositions'));
const PlayerSoloTracker = lazy(() => import('./components/PlayerSoloTracker'));
const SettingsControl = lazy(() => import('./components/SettingsControl'));
const LiveLogger = lazy(() => import('./components/LiveLogger'));
const AITacticalHub = lazy(() => import('./components/AITacticalHub'));
const IntegrationStatus = lazy(() => import('./components/IntegrationStatus'));
const AccessControl = lazy(() => import('./components/AccessControl'));

import { 
  ShieldAlert, RefreshCw, Trophy, Calendar, Swords, Compass, 
  Layers, Users, Settings as SettingsIcon, Image, Upload, AlertCircle, Activity, Sparkles
} from 'lucide-react';

export default function App() {
  const [key, setKey] = useState<string | null>(localStorage.getItem('team_tracker_key'));
  const [role, setRole] = useState<string | null>(localStorage.getItem('team_tracker_role'));
  const [username, setUsername] = useState<string | null>(localStorage.getItem('team_tracker_username'));

  const [data, setData] = useState<TrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Navigation
  const [activeTab, setActiveTab] = useState<'dashboard' | 'calendar' | 'matches' | 'maps' | 'comps' | 'roster' | 'settings' | 'livelogger' | 'aitactical'>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // OCR Screenshot Modal
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrUploading, setOcrUploading] = useState(false);
  const [ocrResult, setOcrResult] = useState<any | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  // Load Database State
  const fetchDatabase = async () => {
    try {
      const res = await apiFetch('/api/data');
      if (!res.ok) throw new Error('Failed to retrieve tracker state.');
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Database fetch error.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (key) {
      fetchDatabase();
    } else {
      setLoading(false);
    }
  }, [key]);

  const handleLoginSuccess = (newKey: string, newRole: string, newUsername: string) => {
    setKey(newKey);
    setRole(newRole);
    setUsername(newUsername);
    setLoading(true);
  };


  // Theme configuration computed from data settings
  const theme = useMemo(() => {
    const mode = data?.settings?.theme || 'slate';
    if (mode === 'cosmic') {
      return {
        bg: 'bg-[#040814] text-white',
        border: 'border-violet-500/15',
        text: 'text-violet-400',
        textMuted: 'text-violet-300',
        primaryBg: 'bg-violet-600 hover:bg-violet-500',
        primaryHover: 'hover:bg-violet-600/10 shadow-violet-500/20',
        accent: '#9333ea',
        cardBg: 'bg-violet-950/20 backdrop-blur-md',
        navActive: 'bg-violet-500/10 text-violet-400 border-violet-500'
      };
    }
    if (mode === 'daylight') {
      return {
        bg: 'bg-[#f8fafc] text-slate-800',
        border: 'border-slate-200',
        text: 'text-slate-800',
        textMuted: 'text-slate-500',
        primaryBg: 'bg-slate-900 hover:bg-slate-800',
        primaryHover: 'hover:bg-slate-100 shadow-slate-200/10',
        accent: '#0f172a',
        cardBg: 'bg-white shadow-sm',
        navActive: 'bg-slate-100 text-slate-900 border-slate-900 font-bold'
      };
    }
    // Default 'slate'
    return {
      bg: 'bg-[#0F1923] text-white',
      border: 'border-white/10',
      text: 'text-[#ff4655]',
      textMuted: 'text-gray-400',
      primaryBg: 'bg-[#ff4655] hover:bg-[#ff5e6a]',
      primaryHover: 'hover:bg-white/5 shadow-red-500/10',
      accent: '#ff4655',
      cardBg: 'bg-white/5 backdrop-blur-md',
      navActive: 'bg-white/5 text-[#ff4655] border-[#ff4655] font-bold'
    };
  }, [data]);

  // --- MUTATION HELPERS ---
  // Client-side mirror of the server's sheet -> collection map.
  const SHEET_KEYS: Record<string, keyof TrackerData> = {
    Schedule: 'schedule', Goals: 'goals', Matches: 'matches',
    SoloQ: 'soloq', Strats: 'strats', StratRuns: 'stratRuns'
  };

  // Upsert a row into a collection in local state (no full refetch).
  const upsertLocal = (key: keyof TrackerData, row: any) => {
    setData((prev) => {
      if (!prev) return prev;
      const arr = [...((prev[key] as any[]) || [])];
      const idx = arr.findIndex((x) => x.id === row.id);
      if (idx >= 0) arr[idx] = row; else arr.push(row);
      return { ...prev, [key]: arr };
    });
  };

  const handleUpsert = async (sheet: string, row: any) => {
    try {
      const res = await apiFetch('/api/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet, row })
      });
      if (!res.ok) throw new Error('Upsert action failed on server.');
      const resJson = await res.json();
      const key = SHEET_KEYS[sheet];
      if (key) upsertLocal(key, resJson);
      return resJson;
    } catch (err: any) {
      alert(err.message || 'Error occurred during upsert.');
    }
  };

  const handleRemove = async (sheet: string, id: string) => {
    try {
      const res = await apiFetch('/api/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet, id })
      });
      if (!res.ok) throw new Error('Deletion request rejected.');
      const key = SHEET_KEYS[sheet];
      setData((prev) => {
        if (!prev) return prev;
        const next: any = { ...prev };
        if (key) next[key] = ((prev[key] as any[]) || []).filter((x) => x.id !== id);
        // Mirror the server's cascading deletes.
        if (sheet === 'Matches') {
          next.playerStats = (prev.playerStats || []).filter((p) => p.matchId !== id);
          next.rounds = (prev.rounds || []).filter((r) => r.matchId !== id);
          next.vetos = (prev.vetos || []).filter((v) => v.matchId !== id);
          next.stratRuns = (prev.stratRuns || []).filter((sr) => sr.matchId !== id);
        }
        if (sheet === 'Strats') {
          next.stratRuns = (prev.stratRuns || []).filter((sr) => sr.stratId !== id);
        }
        return next;
      });
    } catch (err: any) {
      alert(err.message || 'Error deleting row.');
    }
  };

  const handleSaveMatch = async (match: any, stats: any[]) => {
    try {
      const res = await apiFetch('/api/save-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match, stats })
      });
      if (!res.ok) throw new Error('Save Match failed.');
      const resJson = await res.json();
      const savedMatch = resJson.match || resJson;
      const savedStats: any[] = resJson.stats || [];
      setData((prev) => {
        if (!prev) return prev;
        const matches = [...(prev.matches || [])];
        const idx = matches.findIndex((m) => m.id === savedMatch.id);
        if (idx >= 0) matches[idx] = savedMatch; else matches.push(savedMatch);
        const playerStats = [
          ...(prev.playerStats || []).filter((ps) => ps.matchId !== savedMatch.id),
          ...savedStats
        ];
        return { ...prev, matches, playerStats };
      });
      return savedMatch;
    } catch (err: any) {
      alert(err.message || 'Error saving match details.');
    }
  };

  const handleSaveRounds = async (matchId: string, rows: any[]) => {
    try {
      const res = await apiFetch('/api/save-rounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, rows })
      });
      if (!res.ok) throw new Error('Failed to update round log sheets.');
      const resJson = await res.json();
      const savedRows: any[] = resJson.rows || [];
      setData((prev) => prev ? {
        ...prev,
        rounds: [...(prev.rounds || []).filter((r) => r.matchId !== matchId), ...savedRows]
      } : prev);
    } catch (err: any) {
      alert(err.message || 'Error saving rounds.');
    }
  };

  const handleSaveVeto = async (matchId: string, meta: any, actions: any[]) => {
    try {
      const res = await apiFetch('/api/save-veto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, meta, actions })
      });
      if (!res.ok) throw new Error('Veto record write failed.');
      const resJson = await res.json();
      const savedVetos: any[] = resJson.vetos || [];
      setData((prev) => prev ? {
        ...prev,
        vetos: [...(prev.vetos || []).filter((v) => v.matchId !== matchId), ...savedVetos]
      } : prev);
    } catch (err: any) {
      alert(err.message || 'Error saving veto draft.');
    }
  };

  const handleSyncSoloQ = async (player: string) => {
    const res = await apiFetch('/api/sync-soloq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player })
    });
    if (!res.ok) {
      const errJson = await res.json();
      throw new Error(errJson.error || 'Solo Queue syncing failed.');
    }
    // Solo Q sync is a rare, deliberate action; a targeted refetch keeps it simple.
    await fetchDatabase();
  };

  const handleSaveSettings = async (settings: Settings) => {
    try {
      const res = await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to save settings.');
      }
      const resJson = await res.json();
      setData((prev) => prev ? { ...prev, settings: resJson } : prev);
      return resJson;
    } catch (err: any) {
      alert(err.message || 'Error saving settings.');
      throw err;
    }
  };

  // --- OCR UPLOAD HANDLE ---
  const handleImportScreenshotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ocrFile) return;

    setOcrUploading(true);
    setOcrError(null);
    setOcrResult(null);

    try {
      // Server expects JSON { base64, mediaType }, so read the file as a base64 data URL first.
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('Could not read the selected image file.'));
        reader.readAsDataURL(ocrFile);
      });

      const response = await apiFetch('/api/import-screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mediaType: ocrFile.type || 'image/png' })
      });
      if (!response.ok) {
        const errorJson = await response.json();
        throw new Error(errorJson.error || 'Gemini Vision AI processing failed.');
      }
      const resJson = await response.json();
      setOcrResult(resJson);
      await fetchDatabase();
    } catch (err: any) {
      setOcrError(err.message || 'Screenshot import failed.');
    } finally {
      setOcrUploading(false);
    }
  };

  const handleConfirmOcrSave = async () => {
    if (!ocrResult) return;
    try {
      // The OCR endpoint returns a parsed scoreboard { map, ourScore, theirScore, players[] }.
      // Build a Match + PlayerStats from it. A scoreboard has no attack/defense split, so the
      // total is parked on the attack columns and flagged for the coach to correct.
      const num = (v: any) => (v === null || v === undefined || v === '' ? undefined : Number(v));
      const match = {
        date: new Date().toISOString().slice(0, 10),
        type: 'Scrim',
        opponent: '',
        map: ocrResult.map || '',
        attW: Number(ocrResult.ourScore) || 0,
        attL: Number(ocrResult.theirScore) || 0,
        defW: 0,
        defL: 0,
        notes: 'Imported from scoreboard screenshot — set opponent and attack/defense split manually.',
        source: 'ocr'
      };
      // Only keep rows matched to our roster (the scoreboard includes both teams).
      const stats = (ocrResult.players || [])
        .filter((p: any) => p.matched)
        .map((p: any) => ({
          player: p.matched,
          agent: p.agent || '',
          kills: Number(p.kills) || 0,
          deaths: Number(p.deaths) || 0,
          assists: Number(p.assists) || 0,
          acs: num(p.acs),
          adr: num(p.adr),
          hs: num(p.hs),
          fk: num(p.fk),
          fd: num(p.fd)
        }));
      await handleSaveMatch(match, stats);
      setOcrOpen(false);
      setOcrResult(null);
      setOcrFile(null);
      setActiveTab('matches');
    } catch (err) {
      console.error(err);
    }
  };

  const tabsList = [
    { id: 'dashboard', label: 'Dashboard', icon: Trophy },
    { id: 'calendar', label: 'Schedule & Goals', icon: Calendar },
    { id: 'matches', label: 'Matches Log', icon: Swords },
    { id: 'aitactical', label: 'AI Coach Hub', icon: Sparkles },
    { id: 'livelogger', label: 'Live Logger 🔴', icon: Activity },
    { id: 'maps', label: 'Map Analysis', icon: Compass },
    { id: 'comps', label: 'Compositions', icon: Layers },
    { id: 'roster', label: 'Roster & Solo Q', icon: Users },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ] as const;

  const visibleTabs = useMemo(() => {
    if (role === 'player') {
      return tabsList.filter(tab => tab.id !== 'settings' && tab.id !== 'livelogger');
    }
    return tabsList;
  }, [role]);

  const appTitle = data?.settings?.teamName || 'Vandals Esports';

  if (!key) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0F1923] flex flex-col items-center justify-center text-white font-mono space-y-3">
        <RefreshCw className="w-10 h-10 animate-spin text-[#ff4655]" />
        <span className="text-sm tracking-widest text-gray-400">LOADING ESPORTS SCRIM TRACKER...</span>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${theme.bg} flex flex-col lg:flex-row font-sans relative overflow-x-hidden selection:bg-[#ff4655]/30 selection:text-[#ff4655]`}>
      {/* Background flares */}
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-[#ff4655]/3 blur-[140px] pointer-events-none -z-10"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-[#ff4655]/2 blur-[140px] pointer-events-none -z-10"></div>

      {/* Sidebar Navigation */}
      <aside className={`hidden lg:flex w-72 border-r ${theme.border} flex-col ${theme.bg} p-6 shrink-0 min-h-screen justify-between`}>
        <div className="space-y-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#FF4655] rounded-sm flex items-center justify-center transform rotate-45 shrink-0 shadow-lg shadow-[#FF4655]/20">
              <div className="w-6 h-6 border-2 border-white transform -rotate-45"></div>
            </div>
            <div>
              <span className="text-xl font-black tracking-tighter uppercase italic block truncate max-w-[170px]">{appTitle}</span>
              <span className="text-[9px] font-mono text-gray-500 tracking-widest uppercase block -mt-1">SCRIM ENGINE v2</span>
            </div>
          </div>
          
          <nav className="space-y-1">
            {visibleTabs.map((tab) => {
              const IconComp = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-4 p-3 rounded-lg transition-all text-left uppercase text-xs tracking-wider font-bold font-mono border-l-4 ${
                    isActive
                      ? theme.navActive
                      : 'text-gray-400 hover:text-white hover:bg-white/5 border-transparent'
                  }`}
                >
                  <IconComp className="w-4.5 h-4.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Actions / Footer */}
        <div className="space-y-4">
          {/* Access Key Session Status Panel */}
          <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full ${role === 'coach' ? 'bg-[#ff4655]/10 text-[#ff4655]' : 'bg-[#3aa0ff]/10 text-[#3aa0ff]'} flex items-center justify-center font-mono font-bold text-xs shrink-0 border border-current/10`}>
                {role === 'coach' ? 'C' : 'P'}
              </div>
              <div className="min-w-0">
                <span className="text-[9px] uppercase font-bold tracking-widest text-gray-500 block leading-none mb-1">Authenticated</span>
                <span className="text-[11px] font-mono font-bold text-white block uppercase truncate">{username}</span>
              </div>
            </div>
            
            <button
              onClick={() => {
                localStorage.removeItem('team_tracker_key');
                localStorage.removeItem('team_tracker_role');
                localStorage.removeItem('team_tracker_username');
                setKey(null);
                setRole(null);
                setUsername(null);
                setActiveTab('dashboard');
              }}
              className="w-full py-1.5 bg-white/5 hover:bg-rose-500/10 hover:text-rose-400 border border-white/5 hover:border-rose-500/20 text-gray-400 text-[9px] font-bold font-mono uppercase tracking-widest rounded transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              Sign Out / Lock
            </button>
          </div>

          {/* Vision AI Import Module Button (Only Coach can use this) */}
          {role === 'coach' && (
            <div className="p-4 rounded-xl border border-dashed border-red-500/20 bg-red-500/5 space-y-2">
              <div className="flex items-center gap-1.5 text-[#ff4655] font-black text-[10px] tracking-widest uppercase font-mono">
                <Image className="w-4 h-4" /> AI SCOREBOARD IMPORT
              </div>
              <p className="text-[10px] text-gray-400 leading-normal font-mono">Upload match end scoreboard screenshots to auto-import stats using Gemini Vision.</p>
              <button
                onClick={() => {
                  setOcrResult(null);
                  setOcrFile(null);
                  setOcrError(null);
                  setOcrOpen(true);
                }}
                className="w-full py-2 bg-red-500/10 border border-red-500/20 hover:bg-[#FF4655] hover:text-white transition-all text-xs font-bold rounded text-[#ff4655] font-mono uppercase cursor-pointer"
              >
                LAUNCH AI IMPORT
              </button>
            </div>
          )}

          {role === 'coach' && (
            <Suspense fallback={null}>
              <IntegrationStatus />
            </Suspense>
          )}

          <footer className="text-[10px] font-mono text-gray-500 leading-relaxed">
            <p>© {new Date().getFullYear()} {appTitle} Scrim Tracker.</p>
            <p className="mt-0.5 text-gray-600">Built for tournament-tier analysis.</p>
          </footer>
        </div>
      </aside>

      {/* Header for Mobile */}
      <div className="flex-1 flex flex-col min-h-screen overflow-x-hidden">
        <header className={`lg:hidden border-b ${theme.border} ${theme.bg} sticky top-0 z-50 px-4 py-4 flex justify-between items-center`}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#FF4655] rounded-sm flex items-center justify-center transform rotate-45 shrink-0">
              <div className="w-5 h-5 border-2 border-white transform -rotate-45"></div>
            </div>
            <div>
              <span className="text-base font-black tracking-tighter uppercase italic block truncate max-w-[150px]">{appTitle}</span>
              <span className="text-[8px] font-mono text-gray-500 tracking-widest block -mt-1 font-bold">SCRIM ENGINE</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setOcrOpen(true)}
              className="p-2 bg-red-500/10 border border-red-500/20 text-[#ff4655] rounded-lg"
              title="AI Scoreboard Import"
            >
              <Image className="w-4 h-4" />
            </button>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={mobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
              </svg>
            </button>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <nav className={`lg:hidden ${theme.bg} border-b ${theme.border} px-4 py-4 space-y-2 relative z-40 animate-fadeIn`}>
            {visibleTabs.map((tab) => {
              const IconComp = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3.5 p-3 rounded-lg transition-all text-left uppercase text-xs tracking-wider font-bold font-mono border-l-4 ${
                    isActive
                      ? theme.navActive
                      : 'text-gray-400 hover:text-white hover:bg-white/5 border-transparent'
                  }`}
                >
                  <IconComp className="w-4.5 h-4.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}

            {/* Mobile Session Status and Sign Out */}
            <div className="pt-3 border-t border-white/5 mt-2 space-y-2 text-left">
              <div className="flex justify-between items-center px-3 py-2 rounded bg-white/[0.02]">
                <span className="text-[10px] uppercase tracking-widest font-mono text-gray-400">
                  User: <strong className="text-white font-mono">{username} ({role})</strong>
                </span>
              </div>
              <button
                onClick={() => {
                  localStorage.removeItem('team_tracker_key');
                  localStorage.removeItem('team_tracker_role');
                  localStorage.removeItem('team_tracker_username');
                  setKey(null);
                  setRole(null);
                  setUsername(null);
                  setMobileMenuOpen(false);
                  setActiveTab('dashboard');
                }}
                className="w-full py-2 bg-rose-500/15 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white text-xs font-bold font-mono uppercase tracking-widest rounded transition-all cursor-pointer text-center"
              >
                Sign Out / Lock
              </button>
            </div>
          </nav>
        )}

        {/* Main Workspace Frame */}
        <main className="flex-grow p-4 sm:p-6 lg:p-8 overflow-hidden max-w-7xl w-full mx-auto flex flex-col gap-6">
          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg font-mono text-center flex items-center justify-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              Error: {error}
            </div>
          )}

          {/* Tab Router Switch */}
          <div className="flex-grow">
            <Suspense fallback={
              <div className="flex items-center justify-center py-24 text-gray-500 font-mono text-sm gap-3">
                <RefreshCw className="w-5 h-5 animate-spin text-[#ff4655]" />
                Loading module…
              </div>
            }>
            {activeTab === 'dashboard' && data && (
              <Dashboard data={data} theme={theme} />
            )}
            {activeTab === 'calendar' && data && (
              <CalendarGoals data={data} theme={theme} onUpsert={handleUpsert} onRemove={handleRemove} />
            )}
            {activeTab === 'matches' && data && (
              <MatchLogRounds 
                data={data} 
                theme={theme} 
                onSaveMatch={handleSaveMatch} 
                onRemove={handleRemove} 
                onSaveRounds={handleSaveRounds}
                onSaveVeto={handleSaveVeto}
                onRefreshDatabase={fetchDatabase}
              />
            )}
            {activeTab === 'livelogger' && data && (
              <LiveLogger
                data={data}
                theme={theme}
                onSaveMatch={handleSaveMatch}
                onSaveRounds={handleSaveRounds}
                onRefreshDatabase={fetchDatabase}
                setActiveTab={setActiveTab}
                onUpsert={handleUpsert}
              />
            )}
            {activeTab === 'aitactical' && data && (
              <AITacticalHub data={data} theme={theme} onUpsert={handleUpsert} onRemove={handleRemove} />
            )}
            {activeTab === 'maps' && data && (
              <MapBestStats data={data} theme={theme} onUpsert={handleUpsert} onRemove={handleRemove} />
            )}
            {activeTab === 'comps' && data && (
              <TeamCompositions data={data} theme={theme} />
            )}
            {activeTab === 'roster' && data && (
              <PlayerSoloTracker data={data} theme={theme} onSyncSoloQ={handleSyncSoloQ} />
            )}
            {activeTab === 'settings' && data && (
              <div className="space-y-6">
                <AccessControl theme={theme} />
                <SettingsControl data={data} theme={theme} onSaveSettings={handleSaveSettings} />
              </div>
            )}
            </Suspense>
          </div>
        </main>
      </div>

      {/* --- VISION AI IMPORT SCREENSHOT MODAL --- */}
      {ocrOpen && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 overflow-y-auto animate-fadeIn">
          <div className={`w-full max-w-2xl p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-6 max-h-[90vh] overflow-y-auto`}>
            <div className="flex justify-between items-center border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Image className="w-5 h-5 text-[#ff4655]" />
                <h4 className="text-lg font-black tracking-tight uppercase">Vision AI Scoreboard Auto-Import</h4>
              </div>
              <button
                type="button"
                onClick={() => setOcrOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleImportScreenshotSubmit} className="space-y-4">
              <div className="p-8 border-2 border-dashed border-white/10 rounded-xl hover:border-[#ff4655]/40 transition-colors text-center relative flex flex-col items-center justify-center gap-3">
                <Upload className="w-8 h-8 text-gray-500" />
                <div className="space-y-1">
                  <p className="text-xs font-bold">Select or Drag Scoreboard Screenshot</p>
                  <p className="text-[10px] text-gray-500 font-mono">Supports PNG, JPG, JPEG match end scoreboards.</p>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  required
                  onChange={(e) => setOcrFile(e.target.files ? e.target.files[0] : null)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                {ocrFile && (
                  <p className="text-xs text-emerald-400 font-mono font-bold">✓ Selected: {ocrFile.name}</p>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOcrOpen(false)}
                  className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white font-mono"
                >
                  CANCEL
                </button>
                <button
                  type="submit"
                  disabled={ocrUploading || !ocrFile}
                  className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded text-white font-mono flex items-center gap-1.5 disabled:opacity-50`}
                >
                  {ocrUploading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      GEMINI VISION ANALYZING...
                    </>
                  ) : (
                    <>IMPORT SCRIM DETAILS</>
                  )}
                </button>
              </div>
            </form>

            {/* Error displays */}
            {ocrError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-lg font-mono flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                OCR Error: {ocrError}
              </div>
            )}

            {/* Results Review */}
            {ocrResult && (
              <div className="space-y-4 border-t border-white/5 pt-4">
                <h5 className="text-xs uppercase font-black text-emerald-400 font-mono">✓ Gemini parsed match successfully!</h5>
                <div className="p-4 bg-black/20 rounded-xl border border-white/5 font-mono text-[11px] text-gray-300 space-y-3">
                  <div>
                    <span className="text-[9px] text-gray-500">Match Meta:</span>
                    <p className="text-white text-xs font-bold mt-0.5">
                      Vs. {ocrResult.match.opponent} on {ocrResult.match.map} ({ocrResult.match.type})
                    </p>
                    <p className="mt-0.5 text-amber-500 font-bold">
                      Score: {ocrResult.match.attW + ocrResult.match.defW} - {ocrResult.match.attL + ocrResult.match.defL}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[9px] text-gray-500 block border-b border-white/5 pb-1">Individual Performance Metrics:</span>
                    <div className="space-y-1">
                      {ocrResult.stats.map((st: any) => (
                        <div key={st.player} className="flex justify-between items-center text-[10px]">
                          <span className="font-bold text-white">{st.player} ({st.agent})</span>
                          <span>ACS: {st.acs} | ADR: {st.adr} | KDA: {st.kills}/{st.deaths}/{st.assists}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => {
                      setOcrResult(null);
                      setOcrFile(null);
                    }}
                    className="px-3 py-1.5 bg-slate-500/10 text-gray-400 hover:text-white text-xs font-bold rounded font-mono"
                  >
                    RESET
                  </button>
                  <button
                    onClick={handleConfirmOcrSave}
                    className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded font-mono flex items-center gap-1"
                  >
                    CONFIRM & LOG SCRIM
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

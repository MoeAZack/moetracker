import React, { useState, useEffect, useRef } from 'react';
import { Key, ArrowRight, HelpCircle, AlertCircle } from 'lucide-react';
import Logo from './Logo';
import { apiFetch } from '../utils/api';

interface LoginScreenProps {
  onLoginSuccess: (key: string, role: string, username: string) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [mode, setMode] = useState<'player' | 'coach'>('player');
  const [playerName, setPlayerName] = useState('');
  const [playerPassword, setPlayerPassword] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(true);
  const [googleClientId, setGoogleClientId] = useState<string>('');
  const googleBtnRef = useRef<HTMLDivElement>(null);

  const finishLogin = (json: any) => {
    localStorage.setItem('team_tracker_key', json.key);
    localStorage.setItem('team_tracker_role', json.role);
    localStorage.setItem('team_tracker_username', json.username);
    onLoginSuccess(json.key, json.role, json.username);
  };

  const handleGoogleCredential = async (credential: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential })
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Google sign-in failed.');
      finishLogin(json);
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  // Discover whether Google Sign-In is enabled on the server.
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => { if (!cancelled && cfg?.googleEnabled && cfg.googleClientId) setGoogleClientId(cfg.googleClientId); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Load Google Identity Services and render the button once we have a client id.
  useEffect(() => {
    if (!googleClientId) return;
    const render = () => {
      const g = (window as any).google;
      if (!g?.accounts?.id || !googleBtnRef.current) return;
      g.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp: any) => handleGoogleCredential(resp.credential)
      });
      googleBtnRef.current.innerHTML = '';
      g.accounts.id.renderButton(googleBtnRef.current, { theme: 'filled_black', size: 'large', width: 320, text: 'signin_with', shape: 'pill' });
    };
    if ((window as any).google?.accounts?.id) { render(); return; }
    let script = document.getElementById('gis-script') as HTMLScriptElement | null;
    if (script) { script.addEventListener('load', render); return; }
    script = document.createElement('script');
    script.id = 'gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.body.appendChild(script);
  }, [googleClientId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'player' && (!playerName.trim() || playerPassword.length < 3)) {
      setError('Enter your player name and password (minimum 3 characters).');
      return;
    }
    if (mode === 'coach' && !accessKey.trim()) {
      setError('Please provide a valid coach password or access key.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const resp = await apiFetch('/api/login-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mode === 'player' ? { playerName: playerName.trim(), key: playerPassword } : { key: accessKey.trim() }),
      });

      const json = await resp.json();

      if (!resp.ok) {
        throw new Error(json.error || 'Authentication failed. Please check your key.');
      }

      // Success
      finishLogin(json);
    } catch (err: any) {
      setError(err.message || 'Connection failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="login-container" className="app-shell min-h-screen flex items-center justify-center p-4 relative overflow-hidden font-sans text-white selection:bg-[#ff4655]/30">
      <div className="ambient-orb top-[-12rem] left-[-10rem] h-[28rem] w-[28rem] bg-[#46d8c7]/10" />
      <div className="ambient-orb bottom-[-12rem] right-[-10rem] h-[30rem] w-[30rem] bg-[#ff5361]/8" />

      {/* Login Card */}
      <div id="login-card" className="liquid-panel w-full max-w-md rounded-2xl p-8 relative z-10 space-y-6">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-2.5 mb-1">
            <Logo size={64} className="drop-shadow-[0_0_16px_rgba(255,70,85,0.45)]" />
          </div>
          <h2 className="text-2xl font-black tracking-wider text-white uppercase font-mono">
            MoeAZack <span className="text-[#ff4655]">Valorant Tracker</span>
          </h2>
          <p className="text-xs uppercase font-bold tracking-widest text-[#ff4655] bg-[#ff4655]/5 px-2.5 py-1 rounded inline-block">
            Your team workspace
          </p>
        </div>

        {/* Dynamic Help Banner */}
        <div className="liquid-subtle p-3.5 rounded-lg space-y-2 text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-[#3aa0ff]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#43d5c4]" />
              Welcome back
            </div>
            <button
              type="button"
              onClick={() => setShowHelp(!showHelp)}
                className="ui-button inline-flex min-h-11 min-w-11 items-center justify-center text-gray-400 hover:text-white cursor-pointer text-xs"
              title="About Access Keys"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">
            Sign in to review practices, track progress, and prepare with your team.
          </p>

          {showHelp && (
            <div className="mt-2 pt-2 border-t border-white/5 text-[9px] text-gray-400 space-y-1 bg-black/20 p-2.5 rounded border border-white/5">
              <p>💡 <strong>Coach access</strong>: Use the private coach password.</p>
              <p>👥 <strong>Player access</strong>: Use the player name and password chosen by your manager. Existing player access keys still work under Coach/access key.</p>
            </div>
          )}
        </div>

        {/* Error Callout */}
        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono text-center flex items-center justify-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Login type">
          <button type="button" onClick={() => { setMode('player'); setError(null); }} className={`ui-button min-h-11 text-sm font-bold ${mode === 'player' ? 'ui-button-primary' : ''}`} aria-selected={mode === 'player'}>Player</button>
          <button type="button" onClick={() => { setMode('coach'); setError(null); }} className={`ui-button min-h-11 text-sm font-bold ${mode === 'coach' ? 'ui-button-primary' : ''}`} aria-selected={mode === 'coach'}>Coach / access key</button>
        </div>

        {/* Google Sign-In (only when configured on the server) */}
        {mode === 'coach' && googleClientId && (
          <div className="space-y-3">
            <div ref={googleBtnRef} className="flex justify-center min-h-[40px]" />
            <div className="flex items-center gap-3 text-[9px] uppercase tracking-widest text-gray-600">
              <div className="h-px flex-1 bg-white/10" />
              or use a coach password/access key
              <div className="h-px flex-1 bg-white/10" />
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          {mode === 'player' ? <>
          <div className="space-y-1.5"><label htmlFor="player-name" className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Player name</label><input id="player-name" required value={playerName} onChange={event => setPlayerName(event.target.value)} autoComplete="username" placeholder="Ahmed" className="ui-field w-full min-h-11 px-4 py-3 text-sm" /></div>
          <div className="space-y-1.5"><label htmlFor="player-password" className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">Password</label><input id="player-password" type="password" minLength={3} required value={playerPassword} onChange={event => setPlayerPassword(event.target.value)} autoComplete="current-password" placeholder="xyz" className="ui-field w-full min-h-11 px-4 py-3 text-sm" /><p className="text-[10px] text-gray-500">Minimum 3 characters. Use a longer password for better protection.</p></div>
          </> : <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label htmlFor="access-key" className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">
                Access key
              </label>
            </div>
            <div className="relative">
              <input
                id="access-key"
                type="password"
                autoComplete="current-password"
                required
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                placeholder="Coach password or existing access key"
                className="ui-field w-full min-h-11 pl-10 pr-4 py-3 text-sm font-mono placeholder-gray-600"
              />
              <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
            </div>
          </div>}

          <button
            type="submit"
            disabled={loading}
            className="ui-button ui-button-primary w-full min-h-11 mt-2 px-4 py-3 disabled:opacity-50 font-mono font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Sign in
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer info / help */}
        <div className="text-center pt-2">
          <p className="text-[9px] text-gray-500 leading-loose uppercase tracking-widest font-mono">
            MoeAZack Valorant Tracker · Secure Portal © 2026.
          </p>
        </div>
      </div>
    </div>
  );
}

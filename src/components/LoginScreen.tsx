import React, { useState, useEffect, useRef } from 'react';
import { Key, ArrowRight, HelpCircle, AlertCircle } from 'lucide-react';
import Logo from './Logo';
import { apiFetch } from '../utils/api';

interface LoginScreenProps {
  onLoginSuccess: (key: string, role: string, username: string) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
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
    if (!accessKey.trim()) {
      setError('Please provide a valid Access Key.');
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
        body: JSON.stringify({
          key: accessKey.trim(),
        }),
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
    <div id="login-container" className="min-h-screen bg-[#0F1923] flex items-center justify-center p-4 relative overflow-hidden font-sans text-white selection:bg-[#ff4655]/30">
      {/* Background neon glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-[#ff4655]/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#3aa0ff]/5 blur-[120px] pointer-events-none" />

      {/* Cyberpunk grid overlay background */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.01)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.01)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none opacity-30" />

      {/* Login Card */}
      <div id="login-card" className="w-full max-w-md bg-white/[0.03] backdrop-blur-md border border-white/10 rounded-2xl p-8 shadow-2xl relative z-10 space-y-6">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-2.5 mb-1">
            <Logo size={64} className="drop-shadow-[0_0_16px_rgba(255,70,85,0.45)]" />
          </div>
          <h2 className="text-2xl font-black tracking-wider text-white uppercase font-mono">
            MoeAZack <span className="text-[#ff4655]">Valorant Tracker</span>
          </h2>
          <p className="text-xs uppercase font-bold tracking-widest text-[#ff4655] bg-[#ff4655]/5 px-2.5 py-1 rounded inline-block">
            Tactical Access Gate
          </p>
        </div>

        {/* Dynamic Help Banner */}
        <div className="p-3.5 rounded-lg bg-white/[0.02] border border-white/5 space-y-2 text-left">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest text-[#3aa0ff]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#3aa0ff] animate-ping" />
              Dynamic Security Protocol
            </div>
            <button
              type="button"
              onClick={() => setShowHelp(!showHelp)}
              className="text-gray-400 hover:text-white transition cursor-pointer text-xs"
              title="About Access Keys"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 leading-relaxed">
            Please enter your unique Access Key to access the scrim tracker. If your key has been deleted/revoked by the Coach, you will be kicked out immediately.
          </p>

          {showHelp && (
            <div className="mt-2 pt-2 border-t border-white/5 text-[9px] text-gray-400 space-y-1 bg-black/20 p-2.5 rounded border border-white/5">
              <p>💡 <strong>Coach access</strong>: Sign in with Google (if enabled) or use your master coach password for full control of the panel.</p>
              <p>👥 <strong>Player access</strong>: Coaches grant access from Settings — either by Google email or a generated player key — and can revoke it instantly.</p>
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

        {/* Google Sign-In (only when configured on the server) */}
        {googleClientId && (
          <div className="space-y-3">
            <div ref={googleBtnRef} className="flex justify-center min-h-[40px]" />
            <div className="flex items-center gap-3 text-[9px] uppercase tracking-widest text-gray-600">
              <div className="h-px flex-1 bg-white/10" />
              or use an access key
              <div className="h-px flex-1 bg-white/10" />
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 block">
                Enter Tactical Access Key
              </label>
            </div>
            <div className="relative">
              <input
                type="text"
                required
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                placeholder="Player key or master coach password"
                className="w-full bg-[#0F1923]/80 border border-white/10 focus:border-[#ff4655]/60 hover:border-white/25 rounded-lg pl-10 pr-4 py-3 text-sm outline-none transition font-mono placeholder-gray-600 focus:ring-1 focus:ring-[#ff4655]/30 text-white"
              />
              <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 bg-[#ff4655] hover:bg-[#ff4655]/90 active:bg-[#d6323f] disabled:opacity-50 text-white font-mono font-bold text-xs uppercase tracking-widest rounded-lg transition-all shadow-lg hover:shadow-[#ff4655]/20 flex items-center justify-center gap-2 cursor-pointer border border-[#ff4655]/10"
          >
            {loading ? (
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Authorize Gateway
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

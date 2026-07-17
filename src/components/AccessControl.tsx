import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { UserPlus, Trash2, ShieldCheck, Users, AlertCircle } from 'lucide-react';

interface Allowed { email: string; role: string; name?: string; addedAt?: string; }

// Coach-only panel to manage which Google accounts can sign in.
export default function AccessControl({ theme }: { theme: any }) {
  const [users, setUsers] = useState<Allowed[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('player');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const cfg = await apiFetch('/api/config').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (cfg) setGoogleEnabled(!!cfg.googleEnabled);
      const res = await apiFetch('/api/access');
      if (res.ok) setUsers(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/access/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add access.');
      setUsers(json);
      setEmail('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (em: string) => {
    if (!window.confirm(`Remove access for ${em}? They will be signed out immediately.`)) return;
    try {
      const res = await apiFetch('/api/access/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em })
      });
      if (res.ok) setUsers(await res.json());
    } catch { /* ignore */ }
  };

  return (
    <div className={`rounded-2xl border ${theme.border} ${theme.cardBg} p-6 space-y-5`}>
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-[#ff4655]" />
        <h3 className="text-lg font-black tracking-tight uppercase">Google Sign-In Access</h3>
      </div>

      {!googleEnabled && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Google Sign-In isn’t activated yet (no <code>GOOGLE_CLIENT_ID</code> set on the server). You can still manage the allowlist here — it takes effect the moment Google login is switched on.</span>
        </div>
      )}

      <p className="text-xs text-gray-400 leading-relaxed">
        Add the Gmail address of anyone who should be able to sign in with Google. Removing them here revokes their access instantly — no passwords to change.
      </p>

      <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="person@gmail.com"
          className="flex-1 bg-black/20 border border-white/10 focus:border-[#ff4655]/60 rounded-lg px-3 py-2 text-sm outline-none font-mono"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none font-mono"
        >
          <option value="player">Player</option>
          <option value="coach">Coach</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-[#ff4655] hover:bg-[#ff5e6a] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-widest rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <UserPlus className="w-4 h-4" /> Grant
        </button>
      </form>

      {error && <p className="text-xs text-rose-400 font-mono">{error}</p>}

      <div className="space-y-1.5">
        {users.length === 0 && (
          <p className="text-xs text-gray-500 font-mono italic">No Google accounts authorized yet.</p>
        )}
        {users.map((u) => (
          <div key={u.email} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-white/[0.03] border border-white/5">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldCheck className={`w-4 h-4 shrink-0 ${u.role === 'coach' ? 'text-[#ff4655]' : 'text-[#3aa0ff]'}`} />
              <div className="min-w-0">
                <span className="text-sm font-mono truncate block">{u.email}</span>
                <span className="text-[9px] uppercase tracking-widest text-gray-500">{u.role}</span>
              </div>
            </div>
            <button
              onClick={() => remove(u.email)}
              className="p-1.5 rounded hover:bg-rose-500/10 text-gray-500 hover:text-rose-400 transition cursor-pointer shrink-0"
              title="Remove access"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

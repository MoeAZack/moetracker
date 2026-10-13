import React, { useState } from 'react';
import { Copy, KeyRound, X } from 'lucide-react';
import { apiFetch } from '../utils/api';

export default function PlayerPasswordForm({ playerId, playerName }: { playerId: string; playerName: string }) {
  const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [savedPassword, setSavedPassword] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'copied' | 'fallback' | null>(null);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await apiFetch('/api/player-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId, password }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Password reset failed.');
      setSavedPassword(password);
    } catch (err: any) { setError(err?.message || 'Password reset failed.'); }
    finally { setBusy(false); }
  };
  const dismiss = () => { setSavedPassword(null); setPassword(''); setError(null); setCopyStatus(null); };
  const copyLogin = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(`Player: ${playerName}\nPassword: ${savedPassword}`);
      setCopyStatus('copied');
    } catch { setCopyStatus('fallback'); }
  };
  if (savedPassword !== null) return <div className="space-y-2 rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs">
    <div className="flex items-center justify-between gap-2"><span>Login: <strong>{playerName}</strong> / <code>{savedPassword}</code></span><button type="button" onClick={dismiss} aria-label="Hide login details"><X className="h-4 w-4" /></button></div>
    <button type="button" className="ui-button px-2 py-1" onClick={copyLogin}><Copy className="mr-1 inline h-3.5 w-3.5" />{copyStatus === 'copied' ? 'Copied' : 'Copy login details'}</button>
    {copyStatus === 'fallback' && <label className="block text-amber-200">Copy unavailable. Select these login details:<textarea readOnly className="ui-field mt-1 w-full p-2" value={`Player: ${playerName}\nPassword: ${savedPassword}`} /></label>}
  </div>;
  return <form onSubmit={save} className="space-y-1">
    <div className="flex gap-1"><input aria-label={`New password for ${playerName}`} type="password" minLength={3} required value={password} onChange={event => setPassword(event.target.value)} placeholder="Set/reset password" autoComplete="new-password" className="ui-field min-h-9 w-36 px-2 text-xs" /><button disabled={busy || password.length < 3} className="ui-button min-h-9 px-2 text-xs font-bold disabled:opacity-50"><KeyRound className="mr-1 inline h-3.5 w-3.5" />Set</button></div>
    <p className="text-[10px] text-gray-500">Minimum 3 characters (for example, xyz). Use a longer password for better protection.</p>
    {error && <p role="alert" className="text-[10px] text-rose-400">{error}</p>}
  </form>;
}

import React, { useState, useMemo } from 'react';
import { TrackerData } from '../types';
import { apiFetch } from '../utils/api';
import { Crosshair, Plus, Trash2, MessageSquare, Send, ExternalLink } from 'lucide-react';

interface Props {
  data: TrackerData;
  theme: any;
  role: string | null;
  onRefresh: () => Promise<void>;
}

export default function LineupLibrary({ data, theme, role, onRefresh }: Props) {
  const lineups = data.lineups || [];
  const isCoach = role === 'coach';
  const maps = data.settings?.maps || [];
  const agents = data.settings?.agents || [];

  const [showAdd, setShowAdd] = useState(false);
  const [fMap, setFMap] = useState('');
  const [fAgent, setFAgent] = useState('');
  const [fSide, setFSide] = useState('');
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', map: maps[0] || '', agent: agents[0] || '', side: 'Attack', ability: '', site: '', description: '', imageUrl: '', videoUrl: '' });

  const filtered = useMemo(() => lineups.filter((l) =>
    (!fMap || l.map === fMap) && (!fAgent || l.agent === fAgent) && (!fSide || l.side === fSide)
  ), [lineups, fMap, fAgent, fSide]);

  const post = async (url: string, body: any) => {
    setBusy(true);
    try {
      const res = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed.');
      await onRefresh();
    } catch (err: any) {
      alert(err.message || 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const addLineup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    await post('/api/lineup/save', { lineup: { ...form, title: form.title.trim() } });
    setForm({ title: '', map: maps[0] || '', agent: agents[0] || '', side: 'Attack', ability: '', site: '', description: '', imageUrl: '', videoUrl: '' });
    setShowAdd(false);
  };

  const addComment = async (lineupId: string) => {
    if (!commentText.trim()) return;
    await post('/api/lineup/comment', { lineupId, text: commentText.trim() });
    setCommentText(''); setCommentFor(null);
  };

  const inputCls = 'bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crosshair className="w-6 h-6 text-[#ff4655]" />
          <h2 className="text-2xl font-black tracking-tight uppercase">Lineup Library</h2>
        </div>
        {isCoach && (
          <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-2 bg-[#ff4655] hover:bg-[#ff5e6a] text-white text-xs font-bold uppercase tracking-widest rounded-lg flex items-center gap-1.5 cursor-pointer">
            <Plus className="w-4 h-4" /> New Lineup
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select value={fMap} onChange={(e) => setFMap(e.target.value)} className={inputCls}><option value="">All maps</option>{maps.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        <select value={fAgent} onChange={(e) => setFAgent(e.target.value)} className={inputCls}><option value="">All agents</option>{agents.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        <select value={fSide} onChange={(e) => setFSide(e.target.value)} className={inputCls}><option value="">Both sides</option><option value="Attack">Attack</option><option value="Defense">Defense</option></select>
      </div>

      {isCoach && showAdd && (
        <form onSubmit={addLineup} className={`rounded-xl border ${theme.border} ${theme.cardBg} p-4 grid sm:grid-cols-2 gap-3`}>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (e.g. Sova dart A-main)" className={inputCls} />
          <select value={form.map} onChange={(e) => setForm({ ...form, map: e.target.value })} className={inputCls}>{maps.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <select value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })} className={inputCls}>{agents.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })} className={inputCls}><option value="Attack">Attack</option><option value="Defense">Defense</option></select>
          <input value={form.ability} onChange={(e) => setForm({ ...form, ability: e.target.value })} placeholder="Ability (e.g. Recon Dart)" className={inputCls} />
          <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} placeholder="Site (A / B / C / Mid)" className={inputCls} />
          <input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="Image URL (screenshot)" className={`${inputCls} font-mono`} />
          <input value={form.videoUrl} onChange={(e) => setForm({ ...form, videoUrl: e.target.value })} placeholder="Clip URL (optional)" className={`${inputCls} font-mono`} />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="How to line it up…" className={`${inputCls} sm:col-span-2`} rows={2} />
          <button type="submit" disabled={busy} className="px-4 py-2 bg-[#ff4655] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-widest rounded-lg cursor-pointer sm:col-span-2">Save Lineup</button>
        </form>
      )}

      {/* Lineup grid */}
      <div className="grid md:grid-cols-2 gap-4">
        {filtered.length === 0 && <p className="text-sm text-gray-500 font-mono italic">No lineups match these filters.</p>}
        {filtered.map((l) => (
          <div key={l.id} className={`rounded-xl border ${theme.border} ${theme.cardBg} overflow-hidden flex flex-col`}>
            {l.imageUrl && (
              <a href={l.imageUrl} target="_blank" rel="noreferrer">
                <img src={l.imageUrl} alt={l.title} className="w-full h-44 object-cover" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </a>
            )}
            <div className="p-4 space-y-2 flex-1 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{l.title}</div>
                  <div className="text-[10px] text-gray-500 font-mono mt-0.5 flex flex-wrap gap-1.5">
                    <span className="px-1.5 py-0.5 rounded bg-white/5">{l.map}</span>
                    <span className="px-1.5 py-0.5 rounded bg-white/5">{l.agent}</span>
                    <span className={`px-1.5 py-0.5 rounded ${l.side === 'Attack' ? 'bg-amber-500/10 text-amber-400' : 'bg-cyan-500/10 text-cyan-400'}`}>{l.side}</span>
                    {l.site && <span className="px-1.5 py-0.5 rounded bg-white/5">Site {l.site}</span>}
                    {l.ability && <span className="px-1.5 py-0.5 rounded bg-white/5">{l.ability}</span>}
                  </div>
                </div>
                {isCoach && <button onClick={() => post('/api/lineup/remove', { id: l.id })} className="text-gray-500 hover:text-rose-400 cursor-pointer shrink-0"><Trash2 className="w-4 h-4" /></button>}
              </div>

              {l.description && <p className="text-xs text-gray-400 leading-relaxed">{l.description}</p>}
              {l.videoUrl && <a href={l.videoUrl} target="_blank" rel="noreferrer" className="text-[11px] text-[#3aa0ff] hover:underline flex items-center gap-1"><ExternalLink className="w-3 h-3" /> Watch clip</a>}

              {/* Comments */}
              <div className="mt-auto pt-2 space-y-1.5">
                {(l.comments || []).map((c) => (
                  <div key={c.id} className="text-xs bg-white/[0.03] rounded px-2 py-1.5">
                    <span className="text-gray-300">{c.text}</span>
                    <div className="text-[9px] uppercase tracking-widest text-gray-600 font-mono">{c.name} · {c.role}</div>
                  </div>
                ))}
                {commentFor === l.id ? (
                  <div className="flex gap-2 items-center">
                    <input autoFocus value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addComment(l.id)} placeholder="Add a comment…" className="flex-1 bg-black/20 border border-white/10 rounded px-2 py-1 text-xs outline-none" />
                    <button onClick={() => addComment(l.id)} disabled={busy} className="p-1 text-[#3aa0ff] cursor-pointer"><Send className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <button onClick={() => { setCommentFor(l.id); setCommentText(''); }} className="text-[10px] text-gray-500 hover:text-[#3aa0ff] flex items-center gap-1 cursor-pointer"><MessageSquare className="w-3 h-3" /> Comment</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

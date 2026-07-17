import React, { useState, useMemo } from 'react';
import { TrackerData } from '../types';
import { apiFetch } from '../utils/api';
import { Film, Plus, Trash2, Clock, MessageSquare, Send, ExternalLink } from 'lucide-react';

interface Props {
  data: TrackerData;
  theme: any;
  role: string | null;
  onRefresh: () => Promise<void>;
}

// Parse "1:23" or "83" into seconds.
function parseSeconds(label: string): number {
  const parts = String(label).split(':').map((p) => parseInt(p, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

// Build a timestamped link for YouTube/Twitch VODs.
function timestampedUrl(url: string, seconds: number): string {
  if (!url) return url;
  try {
    if (/youtube\.com|youtu\.be/.test(url)) {
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}t=${seconds}s`;
    }
    if (/twitch\.tv/.test(url)) {
      const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}t=${h}h${m}m${s}s`;
    }
  } catch { /* ignore */ }
  return url;
}

export default function VodReview({ data, theme, role, onRefresh }: Props) {
  const reviews = data.vodReviews || [];
  const isCoach = role === 'coach';
  const [selectedId, setSelectedId] = useState<string | null>(reviews[0]?.id || null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', vodUrl: '', matchId: '', date: new Date().toISOString().slice(0, 10) });
  const [noteTime, setNoteTime] = useState('');
  const [noteText, setNoteText] = useState('');
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => reviews.find((r) => r.id === selectedId) || null, [reviews, selectedId]);

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

  const addReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.vodUrl.trim()) return;
    await post('/api/vod/save', { review: { title: form.title.trim() || 'Untitled VOD', vodUrl: form.vodUrl.trim(), matchId: form.matchId || '', date: form.date } });
    setForm({ title: '', vodUrl: '', matchId: '', date: new Date().toISOString().slice(0, 10) });
    setShowAdd(false);
  };

  const addNote = async () => {
    if (!noteText.trim() || !selected) return;
    const seconds = parseSeconds(noteTime || '0');
    await post('/api/vod/note', { reviewId: selected.id, seconds, timeLabel: noteTime || '0:00', text: noteText.trim() });
    setNoteText(''); setNoteTime('');
  };

  const addReply = async (noteId: string) => {
    if (!replyText.trim() || !selected) return;
    await post('/api/vod/reply', { reviewId: selected.id, noteId, text: replyText.trim() });
    setReplyText(''); setReplyFor(null);
  };

  const matchLabel = (id?: string) => {
    const m = (data.matches || []).find((x) => x.id === id);
    return m ? `${m.opponent} · ${m.map}` : '';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="w-6 h-6 text-[#ff4655]" />
          <h2 className="text-2xl font-black tracking-tight uppercase">VOD Review</h2>
        </div>
        {isCoach && (
          <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-2 bg-[#ff4655] hover:bg-[#ff5e6a] text-white text-xs font-bold uppercase tracking-widest rounded-lg flex items-center gap-1.5 cursor-pointer">
            <Plus className="w-4 h-4" /> New VOD
          </button>
        )}
      </div>

      {isCoach && showAdd && (
        <form onSubmit={addReview} className={`rounded-xl border ${theme.border} ${theme.cardBg} p-4 grid sm:grid-cols-2 gap-3`}>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (e.g. vs Nasr — Bind review)" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none" />
          <input value={form.vodUrl} onChange={(e) => setForm({ ...form, vodUrl: e.target.value })} placeholder="VOD URL (YouTube / Twitch)" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none font-mono" />
          <select value={form.matchId} onChange={(e) => setForm({ ...form, matchId: e.target.value })} className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none">
            <option value="">Link to match (optional)</option>
            {(data.matches || []).map((m) => <option key={m.id} value={m.id}>{m.date} — {m.opponent} ({m.map})</option>)}
          </select>
          <button type="submit" disabled={busy} className="px-4 py-2 bg-[#ff4655] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-widest rounded-lg cursor-pointer">Save VOD</button>
        </form>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Review list */}
        <div className="space-y-2 lg:col-span-1">
          {reviews.length === 0 && <p className="text-sm text-gray-500 font-mono italic">No VOD reviews yet.</p>}
          {reviews.map((r) => (
            <button key={r.id} onClick={() => setSelectedId(r.id)} className={`w-full text-left p-3 rounded-lg border transition ${selectedId === r.id ? 'border-[#ff4655]/40 bg-[#ff4655]/5' : 'border-white/5 bg-white/[0.02] hover:bg-white/5'}`}>
              <div className="font-bold text-sm truncate">{r.title}</div>
              <div className="text-[10px] text-gray-500 font-mono mt-0.5">{r.date} {r.matchId ? `· ${matchLabel(r.matchId)}` : ''} · {(r.notes || []).length} notes</div>
            </button>
          ))}
        </div>

        {/* Selected review */}
        <div className="lg:col-span-2 space-y-4">
          {!selected && <p className="text-sm text-gray-500 font-mono italic">Select a VOD to view coach insights.</p>}
          {selected && (
            <div className={`rounded-xl border ${theme.border} ${theme.cardBg} p-5 space-y-4`}>
              <div className="flex items-center justify-between gap-3">
                <a href={selected.vodUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm font-bold text-[#3aa0ff] hover:underline truncate">
                  <ExternalLink className="w-4 h-4 shrink-0" /> {selected.title}
                </a>
                {isCoach && (
                  <button onClick={() => post('/api/vod/remove', { id: selected.id }).then(() => setSelectedId(null))} className="text-gray-500 hover:text-rose-400 cursor-pointer shrink-0"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>

              {/* Add insight (coach) */}
              {isCoach && (
                <div className="flex gap-2 items-center bg-black/20 rounded-lg p-2 border border-white/5">
                  <div className="flex items-center gap-1 shrink-0">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <input value={noteTime} onChange={(e) => setNoteTime(e.target.value)} placeholder="1:23" className="w-14 bg-transparent border-b border-white/10 text-sm outline-none font-mono text-center" />
                  </div>
                  <input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} placeholder="Coach insight at this timestamp…" className="flex-1 bg-transparent text-sm outline-none" />
                  <button onClick={addNote} disabled={busy} className="p-1.5 text-[#ff4655] cursor-pointer disabled:opacity-50"><Send className="w-4 h-4" /></button>
                </div>
              )}

              {/* Notes / insights thread */}
              <div className="space-y-3">
                {(selected.notes || []).length === 0 && <p className="text-xs text-gray-500 font-mono italic">No insights yet.</p>}
                {(selected.notes || []).map((n) => (
                  <div key={n.id} className="rounded-lg bg-white/[0.03] border border-white/5 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <a href={timestampedUrl(selected.vodUrl, n.seconds)} target="_blank" rel="noreferrer" className="shrink-0 px-1.5 py-0.5 rounded bg-[#ff4655]/15 text-[#ff4655] text-[11px] font-mono font-bold hover:bg-[#ff4655]/25">{n.timeLabel}</a>
                        <span className="text-sm">{n.text}</span>
                      </div>
                      {isCoach && <button onClick={() => post('/api/vod/note/remove', { reviewId: selected.id, noteId: n.id })} className="text-gray-600 hover:text-rose-400 cursor-pointer shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                    <div className="text-[9px] uppercase tracking-widest text-gray-500 font-mono">{n.name} · {n.role}</div>

                    {/* Replies */}
                    {(n.replies || []).map((rep) => (
                      <div key={rep.id} className="ml-4 pl-3 border-l border-white/10 py-1">
                        <span className="text-xs text-gray-300">{rep.text}</span>
                        <div className="text-[9px] uppercase tracking-widest text-gray-600 font-mono">{rep.name} · {rep.role}</div>
                      </div>
                    ))}

                    {/* Reply box (everyone) */}
                    {replyFor === n.id ? (
                      <div className="ml-4 flex gap-2 items-center">
                        <input autoFocus value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addReply(n.id)} placeholder="Reply…" className="flex-1 bg-black/20 border border-white/10 rounded px-2 py-1 text-xs outline-none" />
                        <button onClick={() => addReply(n.id)} disabled={busy} className="p-1 text-[#3aa0ff] cursor-pointer"><Send className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <button onClick={() => { setReplyFor(n.id); setReplyText(''); }} className="ml-4 text-[10px] text-gray-500 hover:text-[#3aa0ff] flex items-center gap-1 cursor-pointer"><MessageSquare className="w-3 h-3" /> Reply</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

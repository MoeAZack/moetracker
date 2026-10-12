import React, { useEffect, useState, useMemo } from 'react';
import { TrackerData } from '../types';
import { apiFetch } from '../utils/api';
import { Film, Plus, Trash2, Clock, MessageSquare, Send, ExternalLink, AlertTriangle, CheckCircle2, Database } from 'lucide-react';
import { cairoDateKeyAt, resolveInitialVodSelection, vodContextMatchId } from '../../lib/uiIntegration';

interface Props {
  data: TrackerData;
  theme: any;
  role: string | null;
  onRefresh: () => Promise<void>;
  initialMatchId?: string | null;
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

export default function VodReview({ data, theme, role, onRefresh, initialMatchId }: Props) {
  const reviews = useMemo(() => data.vodReviews || [], [data.vodReviews]);
  const isCoach = role === 'coach';
  const [selectedId, setSelectedId] = useState<string | null>(() => resolveInitialVodSelection(reviews, initialMatchId));
  const [explicitlySelected, setExplicitlySelected] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', vodUrl: '', matchId: resolveInitialVodSelection(reviews, initialMatchId) ? '' : initialMatchId || '', date: cairoDateKeyAt() });
  const [noteTime, setNoteTime] = useState('');
  const [noteText, setNoteText] = useState('');
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [adapterState, setAdapterState] = useState<any>(null);
  const [parserCorrection, setParserCorrection] = useState('');

  const selected = useMemo(() => reviews.find((r) => r.id === selectedId) || null, [reviews, selectedId]);
  const focusedMatchId = vodContextMatchId(reviews, selectedId, initialMatchId, explicitlySelected);
  const focusedMatch = useMemo(() => (data.matches || []).find(match => match.id === focusedMatchId) || null, [data.matches, focusedMatchId]);
  const focusedRounds = useMemo(() => focusedMatch ? (data.rounds || []).filter(round => round.matchId === focusedMatch.id) : [], [data.rounds, focusedMatch]);
  const focusedStats = useMemo(() => focusedMatch ? (data.playerStats || []).filter(stat => stat.matchId === focusedMatch.id) : [], [data.playerStats, focusedMatch]);
  const replayRecord = useMemo(() => (Array.isArray(adapterState?.replay) ? adapterState.replay : []).find((item: any) => item.matchId === focusedMatchId) || null, [adapterState, focusedMatchId]);

  const loadAdapters = async () => {
    const response = await apiFetch('/api/engine-adapters');
    if (response.ok) setAdapterState(await response.json());
  };
  useEffect(() => { loadAdapters().catch(() => {}); }, []);

  const post = async (url: string, body: any): Promise<boolean> => {
    setBusy(true);
    setActionError('');
    try {
      const res = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed.');
      await onRefresh();
      await loadAdapters();
      return true;
    } catch (err: any) {
      setActionError(err.message || 'Action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.vodUrl.trim()) return;
    if (await post('/api/vod/save', { review: { title: form.title.trim() || 'Untitled VOD', vodUrl: form.vodUrl.trim(), matchId: form.matchId || '', date: form.date } })) {
      setForm({ title: '', vodUrl: '', matchId: '', date: cairoDateKeyAt() });
      setShowAdd(false);
    }
  };

  if (!isCoach) return <section className="rounded-xl border border-white/10 bg-white/[0.03] p-8 text-center"><Film className="mx-auto h-5 w-5 text-gray-600" aria-hidden="true" /><h2 className="mt-3 text-lg font-semibold">Coach VOD review is private</h2><p className="mt-1 text-sm text-gray-500">Players receive simplified read-only performance views; private notes and replies are not shared.</p></section>;

  const addNote = async () => {
    if (!noteText.trim() || !selected) return;
    const seconds = parseSeconds(noteTime || '0');
    if (await post('/api/vod/note', { reviewId: selected.id, seconds, timeLabel: noteTime || '0:00', text: noteText.trim() })) { setNoteText(''); setNoteTime(''); }
  };

  const addReply = async (noteId: string) => {
    if (!replyText.trim() || !selected) return;
    if (await post('/api/vod/reply', { reviewId: selected.id, noteId, text: replyText.trim() })) { setReplyText(''); setReplyFor(null); }
  };

  const matchLabel = (id?: string) => {
    const m = (data.matches || []).find((x) => x.id === id);
    return m ? `${m.opponent} · ${m.map}` : '';
  };

  return (
    <div className="space-y-6">
      {actionError && <p role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{actionError}</p>}
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

      {focusedMatch && <section className="rounded-xl border border-white/10 bg-white/[0.035] p-4" aria-labelledby="match-context-title"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Focused match</p><h3 id="match-context-title" className="mt-1 text-lg font-semibold">{focusedMatch.opponent} · {focusedMatch.map}</h3><p className="mt-1 text-xs text-gray-500">{focusedMatch.date} · {focusedMatch.type}</p></div><div className="flex gap-2"><EvidencePill label="Round log" value={focusedRounds.length ? `${focusedRounds.length} recorded` : 'Unknown'} available={focusedRounds.length > 0} /><EvidencePill label="Player stats" value={focusedStats.length ? `${focusedStats.length} rows` : 'Unknown'} available={focusedStats.length > 0} /></div></div></section>}

      {isCoach && showAdd && (
        <form onSubmit={addReview} className={`rounded-xl border ${theme.border} ${theme.cardBg} p-4 grid sm:grid-cols-2 gap-3`}>
          <label className="sr-only" htmlFor="vod-title">Review title</label><input id="vod-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (e.g. vs Nasr — Bind review)" className="min-w-0 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none" />
          <label className="sr-only" htmlFor="vod-url">VOD URL</label><input id="vod-url" value={form.vodUrl} onChange={(e) => setForm({ ...form, vodUrl: e.target.value })} placeholder="VOD URL (YouTube / Twitch)" className="min-w-0 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none font-mono" />
          <label className="sr-only" htmlFor="vod-match">Linked match</label><select id="vod-match" value={form.matchId} onChange={(e) => setForm({ ...form, matchId: e.target.value })} className="min-w-0 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none">
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
            <button key={r.id} onClick={() => { setExplicitlySelected(true); setSelectedId(r.id); }} className={`w-full min-w-0 text-left p-3 rounded-lg border transition ${selectedId === r.id ? 'border-[#ff4655]/40 bg-[#ff4655]/5' : `${theme.border} ${theme.cardBg}`}`}>
              <div className="font-bold text-sm truncate">{r.title}</div>
              <div className="text-[10px] text-gray-500 font-mono mt-0.5">{r.date} {r.matchId ? `· ${matchLabel(r.matchId)}` : ''} · {(r.notes || []).length} notes</div>
            </button>
          ))}
        </div>

        {/* Selected review */}
        <div className="lg:col-span-2 space-y-4">
          {!selected && <div className="rounded-xl border border-dashed border-white/10 p-8 text-center"><Film className="mx-auto h-5 w-5 text-gray-600" aria-hidden="true" /><p className="mt-3 text-sm text-gray-400">{focusedMatch ? 'This match has no linked VOD review.' : 'Select a VOD to view coaching context.'}</p><p className="mt-1 text-xs text-gray-600">{isCoach ? 'Manual review remains available; parser drafts are review-only and are never written automatically.' : 'Ask the coach to link a review when it is ready.'}</p>{isCoach && focusedMatch && <button type="button" onClick={() => setShowAdd(true)} className="mt-4 rounded-lg bg-[#ff4655] px-3 py-2 text-xs font-semibold text-white">Link a VOD</button>}</div>}
          {selected && (
            <div className={`rounded-xl border ${theme.border} ${theme.cardBg} p-5 space-y-4`}>
              <div className="flex items-center justify-between gap-3">
                <a href={selected.vodUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm font-bold text-[#3aa0ff] hover:underline truncate">
                  <ExternalLink className="w-4 h-4 shrink-0" /> {selected.title}
                </a>
                {isCoach && (
                  <button aria-label="Delete VOD review" onClick={async () => { if (await post('/api/vod/remove', { id: selected.id })) { setExplicitlySelected(true); setSelectedId(null); } }} className="text-gray-500 hover:text-rose-400 cursor-pointer shrink-0"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-3" aria-label="Evidence status"><EvidenceStatus icon={CheckCircle2} title="Coach notes" detail={`${selected.notes?.length || 0} reviewed`} available /><EvidenceStatus icon={Database} title="Replay parser" detail={replayRecord ? `${replayRecord.status} · revision ${replayRecord.revision}` : 'No stored draft'} available={!!replayRecord} /><EvidenceStatus icon={AlertTriangle} title="Automated metrics" detail={replayRecord ? `${replayRecord.draft?.coverage?.resolvedRounds ?? 0}/${replayRecord.draft?.coverage?.playedRounds ?? 0} rounds resolved` : 'Unavailable'} available={!!replayRecord} /></div>
              <p className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">Replay/VOD extraction is review-required and non-writing. Trades, clutches, assists, economy, utility and other signals appear only when the parser proves coverage; missing signals are unknown, never zero.</p>
              {replayRecord && <section className="rounded-lg border border-white/10 bg-black/10 p-3 space-y-2" aria-label="Persisted replay evidence"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">Persisted replay evidence</p><p className="text-[10px] text-gray-500">{replayRecord.draft?.parser?.name} {replayRecord.draft?.parser?.version} · {replayRecord.draft?.file?.format}</p></div>{replayRecord.status === 'review-required' && <button type="button" disabled={busy} onClick={() => post('/api/engine-adapters/replay/accept', { matchId: replayRecord.matchId, expectedRevision: replayRecord.revision, requestId: crypto.randomUUID() })} className="rounded-md bg-emerald-500/15 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-300">Accept evidence</button>}</div><div className="grid grid-cols-3 gap-2 text-[10px]"><span>Rounds {replayRecord.draft?.coverage?.playedRounds ?? '—'}</span><span>Resolved {replayRecord.draft?.coverage?.resolvedRounds ?? '—'}</span><span>Unknown {replayRecord.draft?.coverage?.unknownRounds ?? '—'}</span></div><details><summary className="cursor-pointer text-[10px] text-gray-400">Inspect evidence details</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-[9px] text-gray-500">{JSON.stringify({ crossChecks: replayRecord.draft?.crossChecks, coverage: replayRecord.draft?.coverage, playerTotals: replayRecord.draft?.playerTotals, evidence: replayRecord.draft?.evidence }, null, 2)}</pre></details>{replayRecord.status === 'review-required' && <details><summary className="cursor-pointer text-[10px] text-gray-400">Replace with corrected parser evidence</summary><label htmlFor="parser-correction" className="mt-2 block text-[10px] text-gray-500">Paste a complete normalized parser input. It is revalidated and recomputed before replacing this draft.</label><textarea id="parser-correction" value={parserCorrection} onChange={event => setParserCorrection(event.target.value)} className="mt-1 h-28 w-full rounded-md border border-white/10 bg-black/20 p-2 font-mono text-[9px]" /><button type="button" disabled={busy || !parserCorrection.trim()} onClick={async () => { try { const parserInput = JSON.parse(parserCorrection); if (await post('/api/engine-adapters/replay/draft', { matchId: replayRecord.matchId, expectedRevision: replayRecord.revision, requestId: crypto.randomUUID(), parserInput })) setParserCorrection(''); } catch { setActionError('Corrected parser evidence must be valid JSON.'); } }} className="mt-2 rounded-md border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold">Validate replacement</button></details>}</section>}

              {/* Add insight (coach) */}
              {isCoach && (
                <div className="flex gap-2 items-center bg-black/20 rounded-lg p-2 border border-white/5">
                  <div className="flex items-center gap-1 shrink-0">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <label className="sr-only" htmlFor="vod-note-time">Note timestamp</label><input id="vod-note-time" value={noteTime} onChange={(e) => setNoteTime(e.target.value)} placeholder="1:23" className="w-14 bg-transparent border-b border-white/10 text-sm outline-none font-mono text-center" />
                  </div>
                  <label className="sr-only" htmlFor="vod-note-text">Private coach note</label><input id="vod-note-text" value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} placeholder="Private coach insight at this timestamp…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                  <button aria-label="Add private coach note" onClick={addNote} disabled={busy} className="p-1.5 text-[#ff4655] cursor-pointer disabled:opacity-50"><Send className="w-4 h-4" /></button>
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
                      {isCoach && <button aria-label={`Delete note at ${n.timeLabel}`} onClick={() => post('/api/vod/note/remove', { reviewId: selected.id, noteId: n.id })} className="text-gray-600 hover:text-rose-400 cursor-pointer shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>}
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
                      <div className="ml-4 flex min-w-0 gap-2 items-center">
                        <label className="sr-only" htmlFor={`reply-${n.id}`}>Reply to note at {n.timeLabel}</label><input id={`reply-${n.id}`} autoFocus value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addReply(n.id)} placeholder="Reply…" className="min-w-0 flex-1 bg-black/20 border border-white/10 rounded px-2 py-1 text-xs outline-none" />
                        <button aria-label={`Send reply to note at ${n.timeLabel}`} onClick={() => addReply(n.id)} disabled={busy} className="p-1 text-[#3aa0ff] cursor-pointer"><Send className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <button aria-label={`Reply to note at ${n.timeLabel}`} onClick={() => { setReplyFor(n.id); setReplyText(''); }} className="ml-4 text-[10px] text-gray-500 hover:text-[#3aa0ff] flex items-center gap-1 cursor-pointer"><MessageSquare className="w-3 h-3" /> Reply</button>
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

function EvidencePill({ label, value, available }: { label: string; value: string; available: boolean }) { return <div className={`rounded-lg border px-3 py-2 ${available ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/10 bg-black/10'}`}><span className="block text-[9px] uppercase tracking-wider text-gray-500">{label}</span><span className={`mt-0.5 block text-xs font-semibold ${available ? 'text-emerald-300' : 'text-gray-400'}`}>{value}</span></div>; }
function EvidenceStatus({ icon: Icon, title, detail, available = false }: { icon: React.ComponentType<any>; title: string; detail: string; available?: boolean }) { return <div className="rounded-lg border border-white/10 bg-black/10 p-3"><div className="flex items-center gap-1.5"><Icon className={`h-3.5 w-3.5 ${available ? 'text-emerald-400' : 'text-gray-600'}`} aria-hidden="true" /><span className="text-xs font-semibold">{title}</span></div><p className="mt-1 text-[10px] text-gray-500">{detail}</p></div>; }

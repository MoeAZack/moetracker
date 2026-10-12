import React, { useState } from 'react';
import { EntrySourceMetadata, MatchStatsUpdate, TrackerData } from '../types';
import { apiFetch } from '../utils/api';
import { Sparkles, Upload, X, Loader2, CheckCircle, Image as ImageIcon } from 'lucide-react';
import { canCommitScreenshotReview } from '../../lib/entryEngine';

interface Props {
  data: TrackerData;
  theme: any;
  onSaveMatch: (match: any, statsUpdate: MatchStatsUpdate) => Promise<any>;
  onSaveRounds: (matchId: string, rows: any[]) => Promise<void>;
  onClose: () => void;
}

const toB64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the image.'));
    r.readAsDataURL(file);
  });

const num = (v: any) => (v === null || v === undefined || v === '' ? undefined : Number(v));

export default function ScrimImport({ data, theme, onSaveMatch, onSaveRounds, onClose }: Props) {
  const roster = data.settings?.players || [];
  const [scoreboard, setScoreboard] = useState<File | null>(null);
  const [timeline, setTimeline] = useState<File | null>(null);
  const [step, setStep] = useState<'upload' | 'processing' | 'review'>('upload');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editable review model
  const [meta, setMeta] = useState({ opponent: '', type: 'Scrim', date: new Date().toISOString().slice(0, 10), map: '', ourScore: null as number | null, theirScore: null as number | null, firstHalf: 'Att' as 'Att' | 'Def' });
  const [players, setPlayers] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);
  const [sourceMetadata, setSourceMetadata] = useState<EntrySourceMetadata | undefined>();
  const [alliedSideConfirmed, setAlliedSideConfirmed] = useState(false);

  const sideForRound = (roundNo: number, firstHalf: 'Att' | 'Def') => {
    const opp = firstHalf === 'Att' ? 'Def' : 'Att';
    if (roundNo <= 12) return firstHalf;
    if (roundNo <= 24) return opp;
    return roundNo % 2 === 1 ? firstHalf : opp; // OT alternates
  };

  const runImport = async () => {
    if (!scoreboard) return;
    setStep('processing');
    setError(null);
    try {
      const body: any = { scoreboard: { base64: await toB64(scoreboard), mediaType: scoreboard.type || 'image/png' } };
      if (timeline) body.timeline = { base64: await toB64(timeline), mediaType: timeline.type || 'image/png' };
      const res = await apiFetch('/api/import-scrim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.details || 'Import failed.');

      setMeta((m) => ({
        ...m,
        map: json.match?.map || '',
        ourScore: json.match?.ourScore ?? null,
        theirScore: json.match?.theirScore ?? null,
      }));
      // Keep only players matched to our roster by default; coach can adjust.
      setPlayers((json.stats || []).map((p: any) => ({ ...p, include: !!p.matchedPlayerName })));
      setRounds(json.rounds || []);
      setSourceMetadata(json.sourceMetadata);
      setAlliedSideConfirmed(false);
      setStep('review');
    } catch (err: any) {
      setError(err.message || 'Import failed.');
      setStep('upload');
    }
  };

  const save = async () => {
    if (!canCommitScreenshotReview(meta, alliedSideConfirmed)) {
      setError('Complete the opponent, map, and score, then explicitly confirm the allied side to save.');
      return;
    }
    setSaving(true);
    try {
      const hasRounds = rounds.length > 0;
      let attW = 0, attL = 0, defW = 0, defL = 0;
      if (hasRounds) {
        rounds.forEach((r) => {
          const side = sideForRound(r.roundNo, meta.firstHalf);
          if (side === 'Att') { r.result === 'W' ? attW++ : attL++; } else { r.result === 'W' ? defW++ : defL++; }
        });
      }

      const match = {
        date: meta.date, type: meta.type, opponent: meta.opponent, map: meta.map,
        attW: hasRounds ? attW : null, attL: hasRounds ? attL : null,
        defW: hasRounds ? defW : null, defL: hasRounds ? defL : null,
        ourScore: meta.ourScore, theirScore: meta.theirScore,
        notes: hasRounds ? 'Screenshot draft confirmed after round review.' : 'Screenshot draft confirmed; attack/defense split is unknown.',
        source: 'scrim-import', sourceMetadata,
        reviewConfirmation: { alliedSideConfirmed: true },
      };

      const stats = players
        .filter((p) => p.include && p.matchedPlayerName)
        .map((p) => ({
          player: p.matchedPlayerName, agent: p.agent || '',
          kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null,
          kills: num(p.kills) ?? null, deaths: num(p.deaths) ?? null, assists: num(p.assists) ?? null,
          acs: num(p.acs) ?? null, adr: num(p.adr) ?? null, hs: num(p.hs) ?? null,
          fk: num(p.fk) ?? null, fd: num(p.fd) ?? null, sourceMetadata,
        }));

      const result = await onSaveMatch(match, { operation: 'replace', stats });
      const saved = result?.match || result;
      if (saved?.id && hasRounds) {
        const roundRows = rounds.map((r) => ({ roundNo: r.roundNo, side: sideForRound(r.roundNo, meta.firstHalf), result: r.result, winBy: r.winBy || '' }));
        await onSaveRounds(saved.id, roundRows);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const fileRow = (label: string, file: File | null, set: (f: File | null) => void, required?: boolean) => (
    <label className={`flex items-center gap-3 p-3 rounded-lg border border-dashed cursor-pointer transition ${file ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/15 hover:border-white/30'}`}>
      {file ? <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" /> : <ImageIcon className="w-5 h-5 text-gray-500 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">{label} {required && <span className="text-[#ff4655]">*</span>}</div>
        <div className="text-[11px] text-gray-500 font-mono truncate">{file ? file.name : 'Click to choose an image'}</div>
      </div>
      <input type="file" accept="image/*" className="hidden" onChange={(e) => set(e.target.files?.[0] || null)} />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className={`w-full max-w-3xl p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-5 max-h-[92vh] overflow-y-auto`}>
        <div className="flex justify-between items-center border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#ff4655]" />
            <h4 className="text-lg font-black tracking-tight uppercase">Scrim Auto-Import</h4>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {error && <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">{error}</div>}

        {step === 'upload' && (
          <div className="space-y-4">
            <p className="text-xs text-gray-400 leading-relaxed">Drop in the end-of-game <strong>scoreboard</strong> and (optionally) the <strong>round-history timeline</strong> screenshot. Gemini Vision extracts the players, score, and round-by-round results for you to review before saving.</p>
            {fileRow('Scoreboard screenshot', scoreboard, setScoreboard, true)}
            {fileRow('Round timeline screenshot (optional)', timeline, setTimeline)}
            <button onClick={runImport} disabled={!scoreboard} className="w-full py-3 bg-[#ff4655] hover:bg-[#ff5e6a] disabled:opacity-40 text-white font-bold text-xs uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 cursor-pointer">
              <Upload className="w-4 h-4" /> Extract with AI
            </button>
          </div>
        )}

        {step === 'processing' && (
          <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin text-[#ff4655]" />
            <span className="text-sm font-mono">Reading screenshots with Gemini Vision…</span>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-5">
            {/* Match header */}
            <div className="grid sm:grid-cols-3 gap-3">
              <input value={meta.opponent} onChange={(e) => setMeta({ ...meta, opponent: e.target.value })} placeholder="Opponent" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none" />
              <input value={meta.map} onChange={(e) => setMeta({ ...meta, map: e.target.value })} placeholder="Map" className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none" />
              <input type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none" />
              <select value={meta.type} onChange={(e) => setMeta({ ...meta, type: e.target.value })} className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none">
                {(data.settings?.matchTypes || ['Scrim', 'Official', 'Tournament']).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="flex items-center gap-2 text-sm">
                <input type="number" value={meta.ourScore ?? ''} onChange={(e) => setMeta({ ...meta, ourScore: e.target.value === '' ? null : Number(e.target.value) })} className="w-16 bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-center outline-none" />
                <span className="text-gray-500">–</span>
                <input type="number" value={meta.theirScore ?? ''} onChange={(e) => setMeta({ ...meta, theirScore: e.target.value === '' ? null : Number(e.target.value) })} className="w-16 bg-black/20 border border-white/10 rounded-lg px-2 py-2 text-center outline-none" />
              </div>
              <select value={meta.firstHalf} onChange={(e) => setMeta({ ...meta, firstHalf: e.target.value as 'Att' | 'Def' })} className="bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none" title="Which side we started on (first 12 rounds)">
                <option value="Att">Started Attack</option>
                <option value="Def">Started Defense</option>
              </select>
            </div>

            {/* Players */}
            <div>
              <div className="text-[10px] uppercase font-bold tracking-widest text-gray-500 mb-2">Players (only our roster is saved)</div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {players.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-white/[0.03] rounded-lg px-2.5 py-1.5">
                    <input type="checkbox" checked={!!p.include} onChange={(e) => setPlayers(players.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))} />
                    <span className="w-24 truncate font-mono text-gray-400">{p.extractedName}</span>
                    <select value={p.matchedPlayerName || ''} onChange={(e) => setPlayers(players.map((x, j) => j === i ? { ...x, matchedPlayerName: e.target.value, include: !!e.target.value } : x))} className="bg-black/20 border border-white/10 rounded px-1.5 py-1 outline-none">
                      <option value="">— unmapped —</option>
                      {roster.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <span className="text-gray-500 font-mono ml-auto">{p.agent} · {p.kills}/{p.deaths}/{p.assists}{p.acs ? ` · ${p.acs} ACS` : ''}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Rounds summary */}
            <div className="text-xs text-gray-400 font-mono">
              {rounds.length > 0
                ? `${rounds.length} rounds detected — attack/defense split will be computed from the "${meta.firstHalf === 'Att' ? 'Started Attack' : 'Started Defense'}" setting.`
                : 'No round timeline provided — total score will be logged on the attack columns (edit later in Match Log).'}
            </div>

            <label className="flex items-start gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={alliedSideConfirmed} onChange={(e) => setAlliedSideConfirmed(e.target.checked)} />
              <span>I confirm which scoreboard side belongs to our team and have reviewed the opponent, map, and score.</span>
            </label>

            <div className="flex gap-2">
              <button onClick={() => setStep('upload')} className="px-4 py-2.5 border border-white/10 text-gray-300 text-xs font-bold uppercase tracking-widest rounded-lg cursor-pointer">Back</button>
              <button onClick={save} disabled={saving || !canCommitScreenshotReview(meta, alliedSideConfirmed)} className="flex-1 py-2.5 bg-[#ff4655] hover:bg-[#ff5e6a] disabled:opacity-40 text-white font-bold text-xs uppercase tracking-widest rounded-lg flex items-center justify-center gap-2 cursor-pointer">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Save Scrim
              </button>
            </div>
            {!canCommitScreenshotReview(meta, alliedSideConfirmed) && <p className="text-[11px] text-amber-400/80 text-center">Complete the opponent, map, and score, then explicitly confirm the allied side to save.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

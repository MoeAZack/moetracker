import React, { useEffect, useRef, useState } from 'react';
import type { ScoreboardSelection } from '../../lib/localOcrEngine';

export default function ScoreboardCrop({ file, onApply, onCancel }: { file: File; onApply: (selection: ScoreboardSelection) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<'names' | 'kda'>('names');
  const [selection, setSelection] = useState<ScoreboardSelection>({ names: { left: .043, top: .076, width: .323, height: .918 }, kda: { left: .41, top: .076, width: .1, height: .918 } });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => setUrl(String(reader.result));
    reader.onerror = () => setError('This image could not be opened. Try saving it as PNG or JPEG.');
    reader.readAsDataURL(file);
    return () => { if (reader.readyState === 1) reader.abort(); };
  }, [file]);
  const point = (event: React.PointerEvent) => { const r = surface.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)) }; };
  return <section ref={dialog} role="dialog" aria-modal="true" aria-label="Adjust scoreboard columns" className="fixed inset-0 z-[100] overflow-y-auto bg-black/80 p-4" onKeyDown={event => {
    if (event.key === 'Escape') onCancel();
    if (event.key === 'Tab') {
      const items = Array.from(dialog.current?.querySelectorAll('button:not([disabled]), input:not([disabled])') || []) as HTMLElement[];
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="liquid-panel mx-auto max-w-5xl rounded-2xl p-5 space-y-4">
      <h2 className="text-xl font-semibold">Select the scoreboard columns</h2>
      <p className="text-sm text-slate-300">Draw one box around all ten names and another around all ten K/D/A rows. Leave the header and agent portraits outside. Any image size or crop is welcome.</p>
      <div className="flex gap-2">{(['names', 'kda'] as const).map(key => <button autoFocus={key === 'names'} key={key} type="button" aria-pressed={selected === key} onClick={() => setSelected(key)} className={`ui-button min-h-11 px-4 ${selected === key ? 'ui-button-primary' : ''}`}>{key === 'names' ? '1 · Names' : '2 · K / D / A'}</button>)}</div>
      {error && <p role="alert">{error}</p>}
      <div ref={surface} className="relative select-none touch-none" onPointerDown={event => { if (!url || error) return; drag.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!drag.current) return; const end = point(event); const start = drag.current; setSelection(old => ({ ...old, [selected]: { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.max(.005, Math.abs(end.x - start.x)), height: Math.max(.005, Math.abs(end.y - start.y)) } })); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {url && <img src={url} alt="Your scoreboard with adjustable name and KDA regions" draggable={false} onError={() => setError('The image cannot be decoded. Save a fresh PNG or JPEG screenshot.')} onLoad={event => { const image = event.currentTarget; if (image.naturalWidth / image.naturalHeight < 2.35) setSelection({ names: { left: .25, top: .28, width: .216, height: .586 }, kda: { left: .519, top: .28, width: .069, height: .586 } }); }} className="block w-full rounded-lg" />}
        {url && (['names', 'kda'] as const).map(key => { const box = selection[key]; return <div key={key} className={`pointer-events-none absolute border-2 ${key === 'names' ? 'border-cyan-300 bg-cyan-300/10' : 'border-amber-300 bg-amber-300/10'}`} style={{ left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}>{Array.from({ length: 9 }, (_, i) => <div key={i} className="absolute w-full border-t border-white/40" style={{ top: `${(i + 1) * 10}%` }} />)}</div>; })}
      </div>
      <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4"><legend className="text-sm text-slate-300">Fine adjustment for {selected === 'names' ? 'names' : 'K/D/A'} (percent of image)</legend>{(['left', 'top', 'width', 'height'] as const).map(field => <label key={field} className="text-sm capitalize">{field}<input type="number" min={0} max={100} step={.1} value={Number((selection[selected][field] * 100).toFixed(1))} onChange={event => setSelection(old => ({ ...old, [selected]: { ...old[selected], [field]: Number(event.target.value) / 100 } }))} className="ui-field mt-1 min-h-11 w-full px-3" /></label>)}</fieldset>
      <div className="flex justify-end gap-3"><button type="button" onClick={onCancel} className="ui-button min-h-11 px-4">Cancel</button><button type="button" disabled={!url || !!error} onClick={() => onApply(selection)} className="ui-button ui-button-primary min-h-11 px-4">Read selected rows</button></div>
    </div>
  </section>;
}

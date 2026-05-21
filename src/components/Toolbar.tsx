import { useRef } from 'react';

interface Props {
  canUndo: boolean;
  waypointCount: number;
  onUndo: () => void;
  onPlay: () => void;
  onClear: () => void;
  onStylePicker: () => void;
  onImport: (file: File) => void;
}

export function Toolbar({
  canUndo,
  waypointCount,
  onUndo,
  onPlay,
  onClear,
  onStylePicker,
  onImport,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canPlay = waypointCount >= 2;

  const btnBase = 'w-12 h-12 rounded-full bg-white/15 flex items-center justify-center text-xl shadow transition-all active:scale-90';

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 pointer-events-none">
      {!canPlay && waypointCount > 0 && (
        <div className="flex justify-center mb-14 pointer-events-none">
          <span className="bg-navy/80 backdrop-blur text-white/60 text-xs px-3 py-1 rounded-full shadow">
            Add a destination to play
          </span>
        </div>
      )}

      <div className="relative bg-navy border-t border-white/10 pb-safe pointer-events-auto">
        {/* Play button — floats centered above the bar */}
        <div className="absolute -top-4 left-0 right-0 flex justify-center pointer-events-none">
          <button
            onClick={onPlay}
            disabled={!canPlay}
            className={[
              'w-16 h-16 rounded-full flex items-center justify-center text-2xl shadow-xl transition-all active:scale-90 pointer-events-auto',
              canPlay
                ? 'bg-amber text-navy shadow-[0_4px_24px_rgba(245,166,35,0.6)]'
                : 'bg-navy border-2 border-white/30 text-white/50',
            ].join(' ')}
            aria-label="Preview animation"
          >
            ▶
          </button>
        </div>

        {/* 🗺️ · 📂 · [gap] · ↩ · 🗑 — symmetric 2+2 around the centered play button */}
        <div className="flex items-center justify-center gap-4 py-3 px-6">
          <button onClick={onStylePicker} className={btnBase} aria-label="Map style">🗺️</button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className={btnBase}
            aria-label="Import GPX"
          >
            📂
          </button>

          {/* Gap placeholder aligned with the floating play button */}
          <div className="w-16 shrink-0" aria-hidden="true" />

          <button onClick={onUndo} disabled={!canUndo} className={`${btnBase} text-white disabled:opacity-30`} aria-label="Undo">↩</button>
          <button onClick={onClear} disabled={waypointCount === 0} className={`${btnBase} disabled:opacity-30`} aria-label="Clear all">🗑</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gpx,application/gpx+xml,text/xml"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onImport(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}

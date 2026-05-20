interface Props {
  canUndo: boolean;
  canRedo: boolean;
  waypointCount: number;
  onUndo: () => void;
  onRedo: () => void;
  onPlay: () => void;
  onClear: () => void;
  onStylePicker: () => void;
  onMenu: () => void;
}

export function Toolbar({
  canUndo,
  canRedo,
  waypointCount,
  onUndo,
  onRedo,
  onPlay,
  onClear,
  onStylePicker,
  onMenu,
}: Props) {
  const canPlay = waypointCount >= 2;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 pointer-events-none">
      {!canPlay && waypointCount > 0 && (
        <div className="flex justify-center mb-1 pointer-events-none">
          <span className="bg-navy/80 backdrop-blur text-white/60 text-xs px-3 py-1 rounded-full">
            Add a destination to play
          </span>
        </div>
      )}

      <div className="bg-navy border-t border-white/10 pb-safe pointer-events-auto">
        <div className="flex items-center justify-center gap-3 px-4 py-2">

          <button
            onClick={onMenu}
            className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white text-base shadow transition-all active:scale-90"
            aria-label="Menu"
          >
            ☰
          </button>

          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white text-base shadow transition-all active:scale-90 disabled:opacity-30"
            aria-label="Undo"
          >
            ↩
          </button>

          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white text-base shadow transition-all active:scale-90 disabled:opacity-30"
            aria-label="Redo"
          >
            ↪
          </button>

          <button
            onClick={onPlay}
            disabled={!canPlay}
            className={[
              'w-16 h-16 rounded-full flex items-center justify-center text-3xl transition-all active:scale-90',
              canPlay
                ? 'bg-amber text-navy shadow-[0_4px_20px_rgba(245,166,35,0.55)]'
                : 'bg-white/15 text-white/40',
            ].join(' ')}
            aria-label="Preview animation"
          >
            ▶
          </button>

          <button
            onClick={onStylePicker}
            className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-base shadow transition-all active:scale-90"
            aria-label="Map style"
          >
            🗺️
          </button>

          <button
            onClick={onClear}
            disabled={waypointCount === 0}
            className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-base shadow transition-all active:scale-90 disabled:opacity-30"
            aria-label="Clear all"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

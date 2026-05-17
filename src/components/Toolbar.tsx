interface Props {
  canUndo: boolean;
  canRedo: boolean;
  waypointCount: number;
  onUndo: () => void;
  onRedo: () => void;
  onPlay: () => void;
  onClear: () => void;
  onStylePicker: () => void;
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
}: Props) {
  const canPlay = waypointCount >= 2;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 pointer-events-none">
      {/* Hint above the play button when not enough waypoints */}
      {!canPlay && waypointCount > 0 && (
        <div className="flex justify-center mb-1 pointer-events-none">
          <span className="bg-navy/80 backdrop-blur text-white/60 text-xs px-3 py-1 rounded-full">
            Add a destination to play
          </span>
        </div>
      )}

      {/* Toolbar bar */}
      <div className="bg-navy/80 backdrop-blur-md border-t border-white/10 pb-safe pointer-events-auto">
        <div className="flex items-center justify-center gap-4 px-6 py-3">

          {/* Undo */}
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white text-xl shadow-lg transition-all active:scale-90 disabled:opacity-30"
            aria-label="Undo"
          >
            ←
          </button>

          {/* Redo */}
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="w-12 h-12 rounded-full bg-white/25 flex items-center justify-center text-white text-xl shadow-lg transition-all active:scale-90 disabled:opacity-30"
            aria-label="Redo"
          >
            →
          </button>

          {/* Play — big amber button */}
          <button
            onClick={onPlay}
            disabled={!canPlay}
            className={[
              'w-20 h-20 rounded-full flex items-center justify-center text-4xl transition-all active:scale-90',
              canPlay
                ? 'bg-amber text-navy shadow-[0_4px_24px_rgba(245,166,35,0.6)]'
                : 'bg-white/20 text-white/40',
            ].join(' ')}
            aria-label="Preview animation"
          >
            ▶
          </button>

          {/* Map style */}
          <button
            onClick={onStylePicker}
            className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-xl shadow-lg transition-all active:scale-90"
            aria-label="Map style"
          >
            🗺️
          </button>

          {/* Clear */}
          <button
            onClick={onClear}
            disabled={waypointCount === 0}
            className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-white text-xl shadow-lg transition-all active:scale-90 disabled:opacity-30"
            aria-label="Clear all"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

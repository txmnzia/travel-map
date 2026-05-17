interface Props {
  canUndo: boolean;
  canRedo: boolean;
  hasWaypoints: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onPlay: () => void;
  onClear: () => void;
  onStylePicker: () => void;
}

export function Toolbar({
  canUndo,
  canRedo,
  hasWaypoints,
  onUndo,
  onRedo,
  onPlay,
  onClear,
  onStylePicker,
}: Props) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 pb-safe">
      <div className="flex items-center justify-center gap-4 px-6 py-4">
        {/* Undo */}
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white text-xl shadow-lg transition-all active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Undo"
        >
          ←
        </button>

        {/* Redo */}
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="w-12 h-12 rounded-full bg-gray-500 flex items-center justify-center text-white text-xl shadow-lg transition-all active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Redo"
        >
          →
        </button>

        {/* Play — big yellow button */}
        <button
          onClick={onPlay}
          disabled={!hasWaypoints}
          className="w-20 h-20 rounded-full bg-amber shadow-[0_4px_24px_rgba(245,166,35,0.5)] flex items-center justify-center text-navy text-4xl transition-all active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Preview animation"
        >
          ▶
        </button>

        {/* Map style */}
        <button
          onClick={onStylePicker}
          className="w-12 h-12 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white text-xl shadow-lg transition-all active:scale-90"
          aria-label="Map style"
        >
          🗺️
        </button>

        {/* Clear / Delete */}
        <button
          onClick={onClear}
          disabled={!hasWaypoints}
          className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-white text-xl shadow-lg transition-all active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Clear all"
        >
          🗑
        </button>
      </div>
    </div>
  );
}

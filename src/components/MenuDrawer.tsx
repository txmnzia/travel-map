import { MapStyleId } from '../types';
import { MAP_STYLES } from '../utils/mapStyles';

interface Props {
  currentStyle: MapStyleId;
  hasWaypoints: boolean;
  onClose: () => void;
  onStyleChange: (id: MapStyleId) => void;
  onClearAll: () => void;
}

export function MenuDrawer({
  currentStyle,
  hasWaypoints,
  onClose,
  onStyleChange,
  onClearAll,
}: Props) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-40 bg-black/40"
        onClick={onClose}
        onTouchStart={(e) => e.stopPropagation()}
      />

      {/* Drawer */}
      <div
        className="absolute top-0 left-0 bottom-0 z-50 w-72 bg-navy flex flex-col shadow-2xl"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="pt-safe">
          <div className="px-6 py-5 border-b border-white/10 flex items-center gap-3">
            <span className="text-3xl">✈️</span>
            <div>
              <h2 className="text-white font-black text-xl">TravelBoast</h2>
              <p className="text-white/40 text-xs">Travel Video Creator</p>
            </div>
          </div>
        </div>

        {/* Map styles */}
        <div className="px-4 pt-4 pb-2">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3 px-2">
            Map Style
          </p>
          <div className="flex flex-col gap-1">
            {MAP_STYLES.map(style => (
              <button
                key={style.id}
                onClick={() => { onStyleChange(style.id); onClose(); }}
                className={[
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all active:scale-95 text-left',
                  currentStyle === style.id
                    ? 'bg-amber text-navy font-bold'
                    : 'text-white hover:bg-white/10',
                ].join(' ')}
              >
                <span className="text-xl">{style.thumbnail}</span>
                <span className="text-sm">{style.label}</span>
                {currentStyle === style.id && (
                  <span className="ml-auto text-xs">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 pt-2 pb-2 border-t border-white/10 mt-2">
          <button
            onClick={() => { if (hasWaypoints) onClearAll(); onClose(); }}
            disabled={!hasWaypoints}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full text-left transition-all active:scale-95 disabled:opacity-30 text-red-400 hover:bg-white/10"
          >
            <span className="text-xl">🗑</span>
            <span className="text-sm font-medium">New Trip (Clear all)</span>
          </button>
        </div>

        {/* Gesture guide */}
        <div className="px-6 py-4 border-t border-white/10 mt-auto">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">
            Gestures
          </p>
          {[
            ['👆', 'Tap map → add waypoint'],
            ['✌️', 'Tap route line → insert point'],
            ['👇', 'Hold waypoint → change vehicle'],
            ['👆👆', 'Double-tap waypoint → remove'],
            ['↔️', 'Drag orange handle → curve route'],
          ].map(([icon, text]) => (
            <div key={text} className="flex gap-2 mb-1">
              <span className="text-xs w-5">{icon}</span>
              <span className="text-white/40 text-xs">{text}</span>
            </div>
          ))}
        </div>

        {/* Version */}
        <div className="px-6 py-3 border-t border-white/10 pb-safe">
          <p className="text-white/20 text-xs text-center">Draw a Route · v20260519-7</p>
        </div>
      </div>
    </>
  );
}

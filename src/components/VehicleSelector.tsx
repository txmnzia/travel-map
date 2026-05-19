import { useRef } from 'react';
import { VehicleType } from '../types';
import { VEHICLES, VEHICLE_CATEGORIES } from '../utils/vehicles';

interface Props {
  segmentId: string;
  current: VehicleType;
  onSelect: (segmentId: string, vehicle: VehicleType) => void;
  onClose: () => void;
}

export function VehicleSelector({ segmentId, current, onSelect, onClose }: Props) {
  const swipeTouchStartY = useRef<number>(0);

  const onSwipeStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    swipeTouchStartY.current = e.touches[0].clientY;
  };

  const onSwipeEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (e.changedTouches[0].clientY - swipeTouchStartY.current > 60) onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-30"
        onClick={onClose}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      />

      {/* Bottom sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 z-40 bg-navy rounded-t-3xl pb-safe"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Drag handle — swipe down here to close */}
        <div
          className="flex justify-center pt-3 pb-2 cursor-grab"
          onTouchStart={onSwipeStart}
          onTouchEnd={onSwipeEnd}
        >
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <h2
          className="text-white text-center font-bold text-lg tracking-wide mb-3 px-4 cursor-grab"
          onTouchStart={onSwipeStart}
          onTouchEnd={onSwipeEnd}
        >
          CHOOSE TRANSPORT
        </h2>

        <div className="overflow-y-auto max-h-[60vh] px-4 pb-6">
          {VEHICLE_CATEGORIES.map(cat => {
            const vehicles = VEHICLES.filter(v => v.category === cat);
            return (
              <div key={cat} className="mb-4">
                <p className="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">{cat}</p>
                <div className="grid grid-cols-4 gap-2">
                  {vehicles.map(v => {
                    const selected = v.type === current;
                    return (
                      <button
                        key={v.type}
                        onClick={() => {
                          onSelect(segmentId, v.type);
                          onClose();
                        }}
                        className={[
                          'flex flex-col items-center gap-1 py-3 px-1 rounded-2xl transition-all active:scale-95',
                          selected
                            ? 'bg-amber text-navy ring-2 ring-white/40'
                            : 'bg-white/10 text-white hover:bg-white/20',
                        ].join(' ')}
                      >
                        <span className="text-2xl leading-none">{v.emoji}</span>
                        <span className="text-xs font-semibold leading-tight text-center">{v.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

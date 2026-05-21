import { useRef, useEffect, useState, useCallback } from 'react';
import { VehicleType } from '../types';
import { VEHICLES, VEHICLE_CATEGORIES } from '../utils/vehicles';

const TINTS: { label: string; hex: string | null }[] = [
  { label: 'Default', hex: null },
  { label: 'White', hex: '#f8fafc' },
  { label: 'Red', hex: '#ef4444' },
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Yellow', hex: '#fbbf24' },
  { label: 'Green', hex: '#22c55e' },
  { label: 'Black', hex: '#1f2937' },
  { label: 'Orange', hex: '#f97316' },
  { label: 'Purple', hex: '#a855f7' },
  { label: 'Silver', hex: '#94a3b8' },
];

interface Props {
  segmentId: string;
  current: VehicleType;
  currentColor: string | null;
  onSelect: (segmentId: string, vehicle: VehicleType, color: string | null) => void;
  onClose: () => void;
}

export function VehicleSelector({ segmentId, current, currentColor, onSelect, onClose }: Props) {
  const headerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const [backdropVisible, setBackdropVisible] = useState(false);
  const [selVehicle, setSelVehicle] = useState<VehicleType>(current);
  const [selColor, setSelColor] = useState<string | null>(currentColor ?? null);
  const swipeStartY = useRef(0);
  const swipeDY = useRef(0);

  // Slide up on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setBackdropVisible(true);
      if (sheetRef.current) {
        sheetRef.current.style.transition = 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)';
        sheetRef.current.style.transform = 'translateY(0)';
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Slide down then unmount
  const animateClose = useCallback(() => {
    setBackdropVisible(false);
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 280ms ease-in';
      sheetRef.current.style.transform = 'translateY(100%)';
    }
    setTimeout(() => onCloseRef.current(), 280);
  }, []);

  const animateCloseRef = useRef(animateClose);
  useEffect(() => { animateCloseRef.current = animateClose; }, [animateClose]);

  const commitAndClose = useCallback((vehicle: VehicleType, color: string | null) => {
    onSelect(segmentId, vehicle, color);
    animateCloseRef.current();
  }, [segmentId, onSelect]);

  // Drag-to-dismiss: sheet follows finger; commits close at 80px threshold
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const onStart = (e: TouchEvent) => {
      e.stopPropagation();
      swipeStartY.current = e.touches[0].clientY;
      swipeDY.current = 0;
      if (sheetRef.current) sheetRef.current.style.transition = 'none';
    };

    const onMove = (e: TouchEvent) => {
      e.stopPropagation();
      const dy = Math.max(0, e.touches[0].clientY - swipeStartY.current);
      swipeDY.current = dy;
      if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
    };

    const onEnd = (e: TouchEvent) => {
      e.stopPropagation();
      if (swipeDY.current > 80) {
        animateCloseRef.current();
      } else {
        if (sheetRef.current) {
          sheetRef.current.style.transition = 'transform 200ms ease-out';
          sheetRef.current.style.transform = 'translateY(0)';
        }
      }
    };

    header.addEventListener('touchstart', onStart, { passive: true });
    header.addEventListener('touchmove', onMove, { passive: true });
    header.addEventListener('touchend', onEnd);
    return () => {
      header.removeEventListener('touchstart', onStart);
      header.removeEventListener('touchmove', onMove);
      header.removeEventListener('touchend', onEnd);
    };
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-[55] transition-opacity duration-300 ${backdropVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={animateClose}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      />

      {/* Bottom sheet — starts off-screen; enter effect slides it up */}
      <div
        ref={sheetRef}
        style={{ transform: 'translateY(100%)' }}
        className="absolute bottom-0 left-0 right-0 z-[60] bg-navy rounded-t-3xl pb-safe flex flex-col max-h-[90vh]"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Drag handle + title */}
        <div ref={headerRef} className="cursor-grab flex-shrink-0">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/30" />
          </div>
          <h2 className="text-white text-center font-bold text-lg tracking-wide py-2 px-4">
            CHOOSE TRANSPORT
          </h2>
        </div>

        {/* Scrollable vehicle grid */}
        <div className="overflow-y-auto flex-1 min-h-0 px-4 pb-4">
          {VEHICLE_CATEGORIES.map(cat => {
            const vehicles = VEHICLES.filter(v => v.category === cat);
            return (
              <div key={cat} className="mb-4">
                <p className="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">{cat}</p>
                <div className="grid grid-cols-4 gap-2">
                  {vehicles.map(v => {
                    const selected = v.type === selVehicle;
                    return (
                      <button
                        key={v.type}
                        onClick={() => setSelVehicle(v.type)}
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

        {/* Colour picker — fixed at bottom */}
        <div className="flex-shrink-0 px-4 pt-3 pb-2 border-t border-white/10">
          <p className="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">Colour</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {TINTS.map(tint => {
              const selected = tint.hex === selColor;
              return (
                <button
                  key={tint.label}
                  title={tint.label}
                  onClick={() => {
                    setSelColor(tint.hex);
                    commitAndClose(selVehicle, tint.hex);
                  }}
                  className={[
                    'w-9 h-9 rounded-full transition-all active:scale-90 border-2',
                    selected ? 'border-amber scale-110' : 'border-white/20',
                  ].join(' ')}
                  style={
                    tint.hex
                      ? { background: tint.hex }
                      : {
                          background: 'repeating-conic-gradient(#94a3b8 0% 25%, #1e293b 0% 50%) 0 0 / 12px 12px',
                        }
                  }
                />
              );
            })}
          </div>
          <button
            onClick={() => commitAndClose(selVehicle, selColor)}
            className="w-full py-3 rounded-2xl font-bold text-base bg-amber text-navy active:scale-95 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}

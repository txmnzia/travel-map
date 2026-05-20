import { useRef, useEffect, useState, useCallback } from 'react';
import { VehicleType } from '../types';
import { VEHICLES, VEHICLE_CATEGORIES } from '../utils/vehicles';

interface Props {
  segmentId: string;
  current: VehicleType;
  onSelect: (segmentId: string, vehicle: VehicleType) => void;
  onClose: () => void;
}

export function VehicleSelector({ segmentId, current, onSelect, onClose }: Props) {
  const headerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const [backdropVisible, setBackdropVisible] = useState(false);
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
        className="absolute bottom-0 left-0 right-0 z-[60] bg-navy rounded-t-3xl pb-safe"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Drag handle + title */}
        <div ref={headerRef} className="cursor-grab">
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-white/30" />
          </div>
          <h2 className="text-white text-center font-bold text-lg tracking-wide py-2 px-4">
            CHOOSE TRANSPORT
          </h2>
        </div>

        {/* Scrollable vehicle grid */}
        <div className="overflow-y-auto max-h-[72vh] px-4 pb-4">
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
                        onClick={() => { onSelect(segmentId, v.type); animateClose(); }}
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

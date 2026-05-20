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
  const swipeStartY = useRef(0);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Entry/exit animation state
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => onCloseRef.current(), 280);
  }, []);

  const handleCloseRef = useRef(handleClose);
  useEffect(() => { handleCloseRef.current = handleClose; }, [handleClose]);

  // Native (non-React) touch listeners on the header so swipe-down is reliable
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const onStart = (e: TouchEvent) => {
      e.stopPropagation();
      swipeStartY.current = e.touches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      e.stopPropagation();
      if (e.changedTouches[0].clientY - swipeStartY.current > 50) {
        handleCloseRef.current();
      }
    };

    header.addEventListener('touchstart', onStart, { passive: true });
    header.addEventListener('touchend', onEnd);
    return () => {
      header.removeEventListener('touchstart', onStart);
      header.removeEventListener('touchend', onEnd);
    };
  }, []);

  const shown = isVisible && !isClosing;

  return (
    <>
      {/* Backdrop — fades in/out */}
      <div
        className={`absolute inset-0 z-[55] transition-opacity duration-[280ms] ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      />

      {/* Bottom sheet — slides up on enter, slides down on exit */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-[60] bg-navy rounded-t-3xl pb-safe transition-transform duration-[280ms] ${isClosing ? 'ease-in' : 'ease-out'} ${shown ? 'translate-y-0' : 'translate-y-full'}`}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Swipeable header */}
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
                        onClick={() => {
                          onSelect(segmentId, v.type);
                          handleClose();
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

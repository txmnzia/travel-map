import { useRef, useEffect, useState, useCallback } from 'react';
import { VehicleType } from '../types';
import { VEHICLES, VEHICLE_CATEGORIES } from '../utils/vehicles';
import { getThumbRenderer } from '../utils/thumbRenderer';

// Kick off parallel GLB loading the moment the selector first mounts
let _preloaded = false;
function ensurePreloaded() {
  if (_preloaded) return;
  _preloaded = true;
  getThumbRenderer().preload(VEHICLES.map(v => v.type));
}

const TINTS: { label: string; hex: string | null }[] = [
  { label: 'Default', hex: null },
  { label: 'Red',     hex: '#ef4444' },
  { label: 'Blue',    hex: '#3b82f6' },
  { label: 'Yellow',  hex: '#fbbf24' },
  { label: 'Green',   hex: '#22c55e' },
  { label: 'Black',   hex: '#1f2937' },
  { label: 'Orange',  hex: '#f97316' },
  { label: 'Purple',  hex: '#a855f7' },
  { label: 'Silver',  hex: '#94a3b8' },
];

const NO_COLOUR_VEHICLES: VehicleType[] = ['rowboat'];

// Renders a single thumbnail — loads async, shows shimmer while loading
function ThumbImg({
  vehicleType,
  color,
  priority = false,
}: {
  vehicleType: VehicleType;
  color?: string | null;
  priority?: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    getThumbRenderer()
      .get(vehicleType, color ?? null, priority)
      .then(url => { if (!cancelled && url) setSrc(url); });
    return () => { cancelled = true; };
  }, [vehicleType, color, priority]);

  if (!src) {
    return <div className="w-full aspect-square bg-white/5 animate-pulse rounded-xl" />;
  }
  return <img src={src} className="w-full aspect-square object-contain" alt="" />;
}

type Step = 'vehicle' | 'color';

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
  const [step, setStep] = useState<Step>('vehicle');
  const [selVehicle, setSelVehicle] = useState<VehicleType>(current);
  const swipeStartY = useRef(0);
  const swipeDY = useRef(0);

  // Start parallel loading of all vehicle GLBs immediately
  useEffect(() => { ensurePreloaded(); }, []);

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

  // Drag-to-dismiss
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
      } else if (sheetRef.current) {
        sheetRef.current.style.transition = 'transform 200ms ease-out';
        sheetRef.current.style.transform = 'translateY(0)';
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

  const pickVehicle = (type: VehicleType) => {
    if (NO_COLOUR_VEHICLES.includes(type)) {
      commitAndClose(type, null);
      return;
    }
    setSelVehicle(type);
    setStep('color');
  };

  const goBack = () => setStep('vehicle');

  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-[55] transition-opacity duration-300 ${backdropVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={animateClose}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      />

      {/* Bottom sheet */}
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
          <div className="flex items-center px-4 py-2 min-h-[48px]">
            {step === 'color' && (
              <button
                onClick={goBack}
                className="w-8 h-8 flex items-center justify-center text-white/60 hover:text-white rounded-full bg-white/10 flex-shrink-0"
              >
                ←
              </button>
            )}
            <h2 className="flex-1 text-white text-center font-bold text-lg tracking-wide">
              {step === 'vehicle' ? 'CHOOSE TRANSPORT' : 'CHOOSE COLOUR'}
            </h2>
            {step === 'color' && <div className="w-8 flex-shrink-0" />}
          </div>
        </div>

        {/* ── Step 1: vehicle grid ──────────────────────────────────────── */}
        {step === 'vehicle' && (
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
                          onClick={() => pickVehicle(v.type)}
                          className={[
                            'flex flex-col items-center gap-1 pt-2 pb-2 px-1 rounded-2xl transition-all active:scale-95 overflow-hidden',
                            selected
                              ? 'bg-amber text-navy ring-2 ring-white/40'
                              : 'bg-white/10 text-white hover:bg-white/20',
                          ].join(' ')}
                        >
                          <ThumbImg vehicleType={v.type} />
                          <span className="text-[11px] font-semibold leading-tight text-center">
                            {v.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Step 2: colour grid ───────────────────────────────────────── */}
        {step === 'color' && (
          <div className="overflow-y-auto flex-1 min-h-0 px-4 pb-4">
            <div className="grid grid-cols-4 gap-2">
              {TINTS.map(tint => {
                const selected = tint.hex === currentColor;
                return (
                  <button
                    key={tint.label}
                    onClick={() => commitAndClose(selVehicle, tint.hex)}
                    className={[
                      'flex flex-col items-center gap-1 pt-2 pb-2 px-1 rounded-2xl transition-all active:scale-95 overflow-hidden',
                      selected
                        ? 'bg-amber text-navy ring-2 ring-white/40'
                        : 'bg-white/10 text-white hover:bg-white/20',
                    ].join(' ')}
                  >
                    <ThumbImg vehicleType={selVehicle} color={tint.hex} priority />
                    <span className="text-[11px] font-semibold leading-tight text-center">
                      {tint.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

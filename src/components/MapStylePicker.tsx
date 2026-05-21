import { useRef, useEffect, useState, useCallback } from 'react';
import { MapStyleId } from '../types';
import { MAP_STYLES } from '../utils/mapStyles';

interface Props {
  current: MapStyleId;
  onChange: (id: MapStyleId) => void;
  onClose: () => void;
}

export function MapStylePicker({ current, onChange, onClose }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const [backdropVisible, setBackdropVisible] = useState(false);
  const swipeStartY = useRef(0);
  const swipeDY = useRef(0);

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
      <div
        className={`absolute inset-0 z-[60] transition-opacity duration-300 ${backdropVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={animateClose}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      />

      <div
        ref={sheetRef}
        style={{ transform: 'translateY(100%)' }}
        className="absolute bottom-0 left-0 right-0 z-[70] bg-navy rounded-t-3xl pb-safe"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div ref={headerRef} className="cursor-grab">
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>
          <h2 className="text-white text-center font-bold text-lg tracking-wide mb-4 px-4">
            MAP STYLE
          </h2>
        </div>
        <div className="flex flex-wrap gap-3 px-4 pb-4 justify-center">
          {MAP_STYLES.map(style => (
            <button
              key={style.id}
              onClick={() => { onChange(style.id); animateClose(); }}
              className={[
                'flex flex-col items-center gap-2 py-3 w-24 rounded-2xl transition-all active:scale-95',
                current === style.id
                  ? 'bg-amber text-navy ring-2 ring-white/40'
                  : 'bg-white/10 text-white hover:bg-white/20',
              ].join(' ')}
            >
              <span className="text-3xl w-10 text-center leading-none">{style.thumbnail}</span>
              <span className="text-sm font-semibold">{style.label}</span>
            </button>
          ))}
        </div>
        <p className="text-white/20 text-xs text-center pb-4">v20260521-7</p>
      </div>
    </>
  );
}

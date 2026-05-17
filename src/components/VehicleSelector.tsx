import { VehicleType } from '../types';
import { VEHICLES } from '../utils/vehicles';

interface Props {
  segmentId: string;
  current: VehicleType;
  onSelect: (segmentId: string, vehicle: VehicleType) => void;
  onClose: () => void;
}

export function VehicleSelector({ segmentId, current, onSelect, onClose }: Props) {
  return (
    <>
      {/* Backdrop — absorbs all touch/click so the map underneath is blocked */}
      <div
        className="absolute inset-0 z-[60]"
        onClick={onClose}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      />

      {/* Bottom sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[70] bg-navy rounded-t-3xl overflow-hidden pb-safe"
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        <h2 className="text-white text-center font-bold text-lg tracking-wide mb-4 px-4">
          CHOOSE TRANSPORT
        </h2>

        <div className="grid grid-cols-5 gap-2 px-4 pb-6">
          {VEHICLES.map(v => {
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
                <span className="text-xs font-semibold leading-tight">{v.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

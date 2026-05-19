import { VehicleType } from '../types';
import { VEHICLES, VEHICLE_CATEGORIES } from '../utils/vehicles';

interface Props {
  segmentId: string;
  current: VehicleType;
  onSelect: (segmentId: string, vehicle: VehicleType) => void;
  onClose: () => void;
}

export function VehicleSelector({ segmentId, current, onSelect, onClose }: Props) {
  return (
    <>
      {/* Backdrop */}
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

        <h2 className="text-white text-center font-bold text-lg tracking-wide mb-3 px-4">
          CHOOSE TRANSPORT
        </h2>

        <div className="overflow-y-auto max-h-[60vh] px-4 pb-6">
          {VEHICLE_CATEGORIES.map(category => {
            const vehicles = VEHICLES.filter(v => v.category === category);
            return (
              <div key={category} className="mb-4">
                <p className="text-white/40 text-xs font-bold tracking-widest uppercase mb-2 px-1">
                  {category}
                </p>
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
                        <span className="text-[10px] font-semibold leading-tight text-center">
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
      </div>
    </>
  );
}

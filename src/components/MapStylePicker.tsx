import { MapStyleId } from '../types';
import { MAP_STYLES } from '../utils/mapStyles';

interface Props {
  current: MapStyleId;
  onChange: (id: MapStyleId) => void;
  onClose: () => void;
}

export function MapStylePicker({ current, onChange, onClose }: Props) {
  return (
    <>
      <div className="absolute inset-0 z-[60]" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 z-[70] bg-navy rounded-t-3xl pb-safe">
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        <h2 className="text-white text-center font-bold text-lg tracking-wide mb-4 px-4">
          MAP STYLE
        </h2>
        <div className="flex gap-3 px-4 pb-6 justify-center">
          {MAP_STYLES.map(style => (
            <button
              key={style.id}
              onClick={() => { onChange(style.id); onClose(); }}
              className={[
                'flex flex-col items-center gap-2 py-3 px-4 rounded-2xl transition-all active:scale-95',
                current === style.id
                  ? 'bg-amber text-navy ring-2 ring-white/40'
                  : 'bg-white/10 text-white hover:bg-white/20',
              ].join(' ')}
            >
              <span className="text-3xl">{style.thumbnail}</span>
              <span className="text-sm font-semibold">{style.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

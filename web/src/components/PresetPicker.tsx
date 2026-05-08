import type { PresetView } from '../lib/api';

type Props = {
  templateId: string;
  presets: PresetView[];
  onApply: (preset: PresetView) => void;
};

export function PresetPicker({ templateId, presets, onApply }: Props) {
  const matching = presets.filter((p) => p.templateId === templateId);
  const others = presets.filter((p) => p.templateId !== templateId);

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wide font-semibold text-ink-300">
        Presets
      </div>
      {presets.length === 0 ? (
        <div className="text-xs text-ink-400">loading…</div>
      ) : (
        <>
          {matching.length > 0 && (
            <div className="space-y-1">
              {matching.map((p) => (
                <PresetRow key={p.id} preset={p} onApply={onApply} />
              ))}
            </div>
          )}
          {others.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-400 hover:text-ink-200">
                Other templates ({others.length})
              </summary>
              <div className="mt-1 space-y-1">
                {others.map((p) => (
                  <PresetRow key={p.id} preset={p} onApply={onApply} />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function PresetRow({
  preset,
  onApply,
}: {
  preset: PresetView;
  onApply: (preset: PresetView) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onApply(preset)}
      className="block w-full text-left rounded border border-ink-700 hover:border-amber-400/60 px-2 py-1.5 bg-ink-800 hover:bg-ink-700 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-100 truncate">{preset.name}</span>
        <span className="text-[10px] uppercase tracking-wide text-ink-500">
          {preset.source === 'builtin' ? 'built-in' : 'custom'}
        </span>
      </div>
      <div className="text-[11px] text-ink-400 font-mono truncate">
        {preset.templateId === 'reel-clone' ? 'cinematic' : preset.templateId}
      </div>
    </button>
  );
}

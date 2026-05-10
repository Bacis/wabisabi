type Props = {
  value: string;
  onChange: (next: string) => void;
  durationSec: number;
  disabled?: boolean;
};

// Lightweight script editor for theme creation. The user types narration
// over a stock clip; we re-derive a uniformly-timed Transcript on the fly
// (see useEffect in Editor.tsx) and the live <Player> picks up the change
// instantly. No server roundtrip — there's no audio to align with, so the
// timing is purely visual cadence.
export function TranscriptEditor({ value, onChange, durationSec, disabled }: Props) {
  const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
  const wps = wordCount > 0 && durationSec > 0 ? wordCount / durationSec : 0;
  return (
    <div className="space-y-2">
      <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-300">
        Caption text
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={6}
        spellCheck
        placeholder="Type the words you want to display as captions…"
        className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1.5 text-sm leading-snug text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50"
      />
      <div className="text-[10px] text-ink-400 flex justify-between">
        <span>
          {wordCount} {wordCount === 1 ? 'word' : 'words'} · {durationSec.toFixed(1)}s clip
        </span>
        <span>
          {wps > 0 ? `${wps.toFixed(1)} words/sec` : ''}
        </span>
      </div>
    </div>
  );
}

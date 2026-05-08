import { useRef, useState } from 'react';
import { uploadForEditing } from '../lib/api';

type Props = {
  onUploaded: (jobId: string) => void;
};

export function UploadButton({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await uploadForEditing({ file, keepInputMinutes: 60 });
      onUploaded(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="px-4 py-3 border-b border-ink-700 space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="w-full text-sm font-medium px-3 py-2 rounded bg-amber-400 text-ink-900 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Uploading…' : '+ Upload video to edit'}
      </button>
      <p className="text-[11px] text-ink-400 leading-snug">
        Input is kept for 60 min so live preview keeps working after the render finishes.
      </p>
      {error && <div className="text-xs text-rose-300">{error}</div>}
    </div>
  );
}

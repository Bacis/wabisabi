import { useState } from 'react';
import { savePreset } from '../lib/api';

type Props = {
  templateId: string;
  styleSpec: Record<string, any>;
  onSaved?: (id: string) => void;
};

export function SavePresetButton({ templateId, styleSpec, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !name.trim()) {
      setError('id and name are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await savePreset({
        id: id.trim(),
        name: name.trim(),
        description: description.trim(),
        templateId,
        styleSpec,
      });
      onSaved?.(id.trim());
      setOpen(false);
      setId('');
      setName('');
      setDescription('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded bg-amber-400 text-ink-900 font-medium hover:bg-amber-300"
      >
        Save as preset
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 p-3 rounded border border-amber-400/50 bg-ink-800"
    >
      <div className="space-y-1">
        <label className="block text-[11px] uppercase tracking-wide text-ink-300">
          Preset id
        </label>
        <input
          type="text"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="my-preset"
          className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1 text-sm font-mono text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-[11px] uppercase tracking-wide text-ink-300">
          Display name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Preset"
          className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-[11px] uppercase tracking-wide text-ink-300">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </div>
      {error && <div className="text-xs text-rose-300">{error}</div>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs px-2 py-1 rounded bg-amber-400 text-ink-900 font-medium hover:bg-amber-300 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs px-2 py-1 rounded bg-ink-700 text-ink-200 hover:bg-ink-600"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

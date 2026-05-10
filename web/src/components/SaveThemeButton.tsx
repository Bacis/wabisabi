import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createTheme, publishTheme } from '../lib/api';

type Props = {
  templateId: string;
  styleSpec: Record<string, any>;
  // The clip the user is currently editing against. If it's a stock clip
  // we use it as the showcase clip out of the gate, so a published theme
  // already has a permanent backdrop. For job-sourced themes (the user
  // uploaded their own video), this is null and the theme starts as a
  // draft — they must pick a stock clip in /themes/:id before publishing.
  defaultShowcaseClipId: string | null;
  // Disabled when the editing surface is read-only / source is gone.
  disabled?: boolean;
};

export function SaveThemeButton({ templateId, styleSpec, defaultShowcaseClipId, disabled }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [publishNow, setPublishNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('name is required');
      return;
    }
    if (publishNow && !defaultShowcaseClipId) {
      setError(
        'Pick a stock clip as the showcase before publishing — uploaded videos expire.',
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const theme = await createTheme({
        name: name.trim(),
        description: description.trim(),
        templateId,
        styleSpec,
        showcaseClipId: defaultShowcaseClipId,
      });
      if (publishNow) {
        await publishTheme(theme.id);
      }
      navigate(`/themes/${theme.id}`);
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
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded bg-amber-400 text-ink-900 font-semibold hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Save as theme
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2 p-3 rounded border border-amber-400/50 bg-ink-800 w-[280px]"
    >
      <div className="space-y-1">
        <label className="block text-[11px] uppercase tracking-wide text-ink-300">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="Neon Vibe"
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
          placeholder="Optional"
          className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-200 cursor-pointer">
        <input
          type="checkbox"
          checked={publishNow}
          onChange={(e) => setPublishNow(e.target.checked)}
          disabled={!defaultShowcaseClipId}
        />
        Publish to community
        {!defaultShowcaseClipId && (
          <span className="text-[10px] text-ink-400">(needs a stock clip)</span>
        )}
      </label>
      {error && <div className="text-xs text-rose-300">{error}</div>}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs px-3 py-1.5 rounded bg-amber-400 text-ink-900 font-semibold hover:bg-amber-300 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : publishNow ? 'Save & publish' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs px-3 py-1.5 rounded bg-ink-700 text-ink-200 hover:bg-ink-600"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

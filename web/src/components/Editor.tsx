import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchJob, fetchPresets, type JobDetail, type PresetView } from '../lib/api';
import { COMMON_GROUPS } from '../lib/commonDescriptor';
import { getTemplateDescriptor } from '../lib/templateDescriptors';
import { getPath, setPath } from '../lib/dotPath';
import { mergeStyleSpec } from '@shared/presets';
import type { Control, ControlGroup } from '../lib/types';
import { ControlRenderer } from './Form/ControlRenderer';
import { PlayerPreview } from './PlayerPreview';
import { ExportRenderButton } from './ExportRenderButton';

type Props = {
  jobId: string;
};

// Pick the best default preset for a template. Prefers built-in presets,
// then ones whose id matches "<templateId>-default" or the templateId itself,
// then any other matching built-in. Returns null if no preset matches.
function pickDefaultPreset(presets: PresetView[], templateId: string): PresetView | null {
  const matching = presets.filter((p) => p.templateId === templateId);
  if (matching.length === 0) return null;
  const builtins = matching.filter((p) => p.source === 'builtin');
  const pool = builtins.length > 0 ? builtins : matching;
  return (
    pool.find((p) => p.id === `${templateId}-default`) ??
    pool.find((p) => p.id.includes('-default')) ??
    pool.find((p) => p.id === templateId) ??
    pool[0] ??
    null
  );
}

export function Editor({ jobId }: Props) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [styleSpec, setStyleSpec] = useState<Record<string, any>>({});
  const [templateId, setTemplateId] = useState<string>('pop-words');
  const [frameSec, setFrameSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetView[]>([]);
  // The polling tick reads presets via a ref so we don't have to retrigger
  // the polling effect when /presets resolves — it just picks up the
  // latest list on its next iteration.
  const presetsRef = useRef<PresetView[]>([]);

  // Fetch presets once on mount. Used by `changeTemplate` to swap defaults
  // and by the seeding tick to apply the default preset on a fresh upload
  // (the preset picker UI was removed; the lone preset per template is now
  // applied automatically).
  useEffect(() => {
    fetchPresets()
      .then((list) => {
        setPresets(list);
        presetsRef.current = list;
      })
      .catch((err) => console.error('preset fetch failed', err));
  }, []);

  // On jobId change, reset local state then poll until transcript arrives.
  // Workers populate transcript mid-pipeline, so a click on a `running` job
  // should auto-flip into editor view as soon as transcribe lands. Once
  // seeded, polling stops so it doesn't clobber the user's edits.
  useEffect(() => {
    setJob(null);
    setError(null);
    setStyleSpec({});
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let seeded = false;

    const tick = async () => {
      try {
        const j = await fetchJob(jobId);
        if (cancelled) return;
        setJob(j);
        if (!seeded) {
          // Fresh uploads land with no styleSpec — apply the matching
          // template's default preset so the preview pane shows a usable
          // look immediately (replaces the removed PresetPicker).
          const fromJob = j.styleSpec ?? {};
          const empty = !fromJob || Object.keys(fromJob).length === 0;
          let initial: Record<string, any> = fromJob;
          if (empty && presetsRef.current.length > 0) {
            const def = pickDefaultPreset(presetsRef.current, j.templateId);
            if (def) initial = def.styleSpec;
          }
          setStyleSpec(initial);
          setTemplateId(j.templateId);
          if (j.transcript) {
            const dur = j.transcript.duration ?? 0;
            setFrameSec(dur > 1 ? Math.min(2, dur / 2) : 0);
            seeded = true;
            return; // stop polling — we have a transcript
          }
        }
        if (j.status !== 'failed') {
          timer = setTimeout(tick, 2000);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  const groups = useMemo<ControlGroup[]>(() => {
    const desc = getTemplateDescriptor(templateId);
    const exclude = new Set(desc?.excludeCommonPaths ?? []);
    // Filter common-fields the template doesn't honor, then drop any group
    // that ends up empty so the form doesn't render dead headers.
    const filteredCommon = COMMON_GROUPS.map((g) => ({
      ...g,
      controls: g.controls.filter((c) => !exclude.has(c.path)),
    })).filter((g) => g.controls.length > 0);
    return desc ? [...filteredCommon, ...desc.groups] : filteredCommon;
  }, [templateId]);

  const update = (path: string, value: unknown) => {
    setStyleSpec((prev) => setPath(prev, path, value));
  };

  // Theme apply: deep-merge a partial styleSpec into the current one. Used
  // by the reel-clone Theme picker. Unlike a full preset apply (full
  // replacement), this preserves any non-overlapping keys (animation timing,
  // position, safeMargin, italic rate, etc.) so the user's tweaks survive a
  // theme swap.
  const applyTheme = useCallback((patch: Record<string, any>) => {
    setStyleSpec((prev) => mergeStyleSpec(prev as any, patch));
  }, []);

  // Switching templates reloads that template's defaults so settings
  // (font, palette, reel.* extension fields) match the new look. We pick
  // the matching built-in preset; if none exists, fall back to {} which
  // causes the template to use its in-code Zod-schema defaults.
  const changeTemplate = useCallback(
    (newId: string) => {
      const preset = pickDefaultPreset(presets, newId);
      setTemplateId(newId);
      setStyleSpec(preset ? preset.styleSpec : {});
    },
    [presets],
  );

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-rose-300 text-sm">
        {error}
      </div>
    );
  }
  if (!job) {
    return (
      <div className="h-full flex items-center justify-center text-ink-400 text-sm">
        Loading job…
      </div>
    );
  }
  if (!job.transcript) {
    return (
      <div className="h-full flex items-center justify-center text-ink-400 text-sm px-8 text-center">
        Job has no transcript yet (status: {job.status}, stage: {job.stage ?? 'queued'}).
        Wait for it to finish transcribing, then refresh.
      </div>
    );
  }

  const duration = job.transcript.duration ?? 30;

  return (
    <div className="h-full flex">
      {/* Form pane */}
      <div className="w-[380px] shrink-0 border-r border-ink-700 bg-ink-800 overflow-y-auto">
        <div className="p-4 space-y-4 border-b border-ink-700">
          <div>
            <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-300 mb-1">
              Template
            </label>
            <select
              value={templateId}
              onChange={(e) => changeTemplate(e.target.value)}
              className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1.5 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
            >
              {[
                { id: 'pop-words', label: 'Pop Words' },
                { id: 'reel-clone', label: 'Cinematic' },
              ].map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="divide-y divide-ink-700">
          {groups.map((group) => (
            <Group
              key={group.id}
              group={group}
              styleSpec={styleSpec}
              onChange={update}
              onApplyTheme={applyTheme}
            />
          ))}
        </div>
      </div>

      {/* Preview pane — Player runs the same React composition tree as the
          renderer; styleSpec edits update animations live, no server roundtrip. */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-3">
          <PlayerPreview
            jobId={jobId}
            templateId={templateId}
            styleSpec={styleSpec}
            transcript={job.transcript}
            captionPlan={job.captionPlan}
            fallbackFrameSec={frameSec}
            inputAvailable={job.inputAvailable}
            jobStatus={job.status}
          />
          <div className="max-w-[420px] mx-auto flex items-center justify-between gap-3">
            <span className="text-[11px] text-ink-400">
              Total duration: {duration.toFixed(1)}s · {Math.ceil(duration * 30)} frames
            </span>
            <ExportRenderButton
              sourceJobId={jobId}
              templateId={templateId}
              styleSpec={styleSpec}
              inputAvailable={job.inputAvailable}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({
  group,
  styleSpec,
  onChange,
  onApplyTheme,
}: {
  group: ControlGroup;
  styleSpec: Record<string, any>;
  onChange: (path: string, value: unknown) => void;
  onApplyTheme: (patch: Record<string, any>) => void;
}) {
  return (
    <details open className="px-4 py-3" key={group.id}>
      <summary className="cursor-pointer text-xs uppercase tracking-wide font-semibold text-ink-300 mb-3">
        {group.label}
      </summary>
      {group.description && (
        <p className="text-[11px] text-ink-400 mb-2">{group.description}</p>
      )}
      <div className="space-y-3 pt-2">
        {group.controls.map((control: Control) => {
          // Conditional visibility: skip this control if its `showIf` clause
          // points at a sibling whose current value isn't in the allow-list.
          if (control.showIf) {
            const siblingValue = getPath(styleSpec, control.showIf.path);
            const allowed =
              typeof siblingValue === 'string' &&
              control.showIf.oneOf.includes(siblingValue);
            if (!allowed) return null;
          }
          return (
            <ControlRenderer
              key={control.path}
              control={control}
              value={getPath(styleSpec, control.path)}
              onChange={(v) => onChange(control.path, v)}
              onApplyTheme={onApplyTheme}
            />
          );
        })}
      </div>
    </details>
  );
}

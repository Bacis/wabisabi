import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchPresets, type PresetView, type Transcript } from '../lib/api';
import { COMMON_GROUPS } from '../lib/commonDescriptor';
import { getTemplateDescriptor } from '../lib/templateDescriptors';
import { getPath, setPath } from '../lib/dotPath';
import { mergeStyleSpec } from '@shared/presets';
import { buildTranscriptFromText } from '@shared/buildTranscript';
import type { Control, ControlGroup } from '../lib/types';
import { ControlRenderer } from './Form/ControlRenderer';
import { PlayerPreview } from './PlayerPreview';
import { ExportRenderButton } from './ExportRenderButton';
import { TranscriptEditor } from './TranscriptEditor';
import { useEditableSource, type EditorSource } from '../lib/useEditableSource';

type Props = {
  source: EditorSource;
  // Right-pane action button. Defaults to ExportRenderButton (only valid for
  // job sources); the theme creator/viewer pages override this with a
  // SaveThemeButton or read-only badge.
  actions?: (ctx: {
    templateId: string;
    styleSpec: Record<string, any>;
    inputAvailable: boolean;
  }) => ReactNode;
  // Read-only mode disables the form pane (used by /themes/:id viewer).
  readOnly?: boolean;
  // Lift the editor's working state to the parent so save/publish buttons
  // can read the current values without prop-drilling. Optional.
  onStateChange?: (state: { templateId: string; styleSpec: Record<string, any> }) => void;
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

export function Editor({ source, actions, readOnly, onStateChange }: Props) {
  const sourceState = useEditableSource(source);
  const [styleSpec, setStyleSpec] = useState<Record<string, any>>({});
  const [templateId, setTemplateId] = useState<string>('pop-words');
  const [frameSec, setFrameSec] = useState(0);
  const [presets, setPresets] = useState<PresetView[]>([]);
  // Transcript override: when the user edits the script in the form pane,
  // we rebuild a uniformly-timed Transcript here and feed it to the
  // PlayerPreview. Falls back to the source's original transcript when
  // the user hasn't touched the input.
  const [transcriptText, setTranscriptText] = useState<string>('');
  const [transcriptOverridden, setTranscriptOverridden] = useState(false);
  const presetsRef = useRef<PresetView[]>([]);
  // Track which loaded source we've already seeded local state from, so a
  // re-render of `useEditableSource` (e.g. polling tick) doesn't clobber the
  // user's edits.
  const seededFor = useRef<string | null>(null);

  // Fetch presets once on mount. Used by `changeTemplate` to swap defaults.
  useEffect(() => {
    fetchPresets()
      .then((list) => {
        setPresets(list);
        presetsRef.current = list;
      })
      .catch((err) => console.error('preset fetch failed', err));
  }, []);

  // Seed local state from the loaded source the first time data arrives. If
  // the server's initialStyleSpec is empty (fresh job upload, freshly picked
  // stock clip), apply the matching template's default preset so the
  // preview pane shows a usable look immediately.
  useEffect(() => {
    if (sourceState.status !== 'ready') return;
    const key = sourceKeyOf(source);
    if (seededFor.current === key) return;
    seededFor.current = key;
    const initial = sourceState.data.initialStyleSpec ?? {};
    const empty = !initial || Object.keys(initial).length === 0;
    let nextSpec: Record<string, any> = initial;
    if (empty && presetsRef.current.length > 0) {
      const def = pickDefaultPreset(presetsRef.current, sourceState.data.initialTemplateId);
      if (def) nextSpec = def.styleSpec;
    }
    setStyleSpec(nextSpec);
    setTemplateId(sourceState.data.initialTemplateId);
    const dur = sourceState.data.durationSec;
    setFrameSec(dur > 1 ? Math.min(2, dur / 2) : 0);
    // Seed the transcript editor from the source's words. The user can
    // edit this freely — we re-derive timing on the fly.
    const text = sourceState.data.transcript.words.map((w) => w.word).join(' ');
    setTranscriptText(text);
    setTranscriptOverridden(false);
  }, [sourceState, source]);

  // Reset the seeding guard when the source key changes — switching from a
  // job to a stock clip (or vice versa) on the same Editor mount needs a
  // fresh seed.
  useEffect(() => {
    seededFor.current = null;
  }, [sourceKeyOf(source)]);

  useEffect(() => {
    onStateChange?.({ templateId, styleSpec });
  }, [templateId, styleSpec, onStateChange]);

  const groups = useMemo<ControlGroup[]>(() => {
    const desc = getTemplateDescriptor(templateId);
    const exclude = new Set(desc?.excludeCommonPaths ?? []);
    const filteredCommon = COMMON_GROUPS.map((g) => ({
      ...g,
      controls: g.controls.filter((c) => !exclude.has(c.path)),
    })).filter((g) => g.controls.length > 0);
    return desc ? [...filteredCommon, ...desc.groups] : filteredCommon;
  }, [templateId]);

  const update = (path: string, value: unknown) => {
    setStyleSpec((prev) => setPath(prev, path, value));
  };

  // Theme apply: deep-merge a partial styleSpec into the current one.
  const applyTheme = useCallback((patch: Record<string, any>) => {
    setStyleSpec((prev) => mergeStyleSpec(prev as any, patch));
  }, []);

  // Switching templates reloads that template's defaults so settings
  // (font, palette, reel.* extension fields) match the new look.
  const changeTemplate = useCallback(
    (newId: string) => {
      const preset = pickDefaultPreset(presets, newId);
      setTemplateId(newId);
      setStyleSpec(preset ? preset.styleSpec : {});
    },
    [presets],
  );

  if (sourceState.status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center text-ink-400 text-sm">
        Loading…
      </div>
    );
  }
  if (sourceState.status === 'error') {
    return (
      <div className="h-full flex items-center justify-center text-rose-300 text-sm px-8 text-center">
        {sourceState.error}
      </div>
    );
  }
  const data = sourceState.data;
  // Source input has been swept off disk and the render is already done.
  // The preview swaps to a static <video> of the baked output, so style
  // tweaks can't update anything visually and Export Render would 410.
  // Disable the form so the controls stop pretending to be live.
  const editingDisabled = readOnly || (!data.inputAvailable && data.status === 'done');
  const duration = data.durationSec || 30;
  const jobIdForStillPreview = source.kind === 'job' ? source.jobId : undefined;
  // Live transcript: use the user's overridden text when they've typed
  // anything, otherwise the source's original (real audio timing for jobs,
  // hand-written placeholder for stock clips). The captionPlan is dropped
  // when the transcript changes — its chunk indices wouldn't align — so
  // the renderer falls back to its built-in fixed-N chunker.
  const liveTranscript: Transcript = transcriptOverridden
    ? buildTranscriptFromText(transcriptText, duration)
    : data.transcript;
  const liveCaptionPlan = transcriptOverridden ? null : data.captionPlan;

  // Default action: keep ExportRenderButton wired up for job sources so
  // /jobs/:id behavior is unchanged. Stock/theme sources have no
  // exportable source to re-upload, so we hide the button entirely
  // unless the parent provided its own actions slot.
  const renderedActions = actions
    ? actions({ templateId, styleSpec, inputAvailable: data.inputAvailable })
    : source.kind === 'job'
      ? (
          <ExportRenderButton
            sourceJobId={source.jobId}
            templateId={templateId}
            styleSpec={styleSpec}
            inputAvailable={data.inputAvailable}
          />
        )
      : null;

  return (
    <div className="h-full min-h-0 flex">
      {/* Form pane */}
      <div className="w-[380px] shrink-0 border-r border-ink-700 bg-ink-800 overflow-y-auto min-h-0">
        {editingDisabled && !readOnly && (
          <div className="px-4 py-3 border-b border-ink-700 bg-amber-400/5 text-[11px] text-amber-200/90 leading-snug">
            <span className="font-semibold text-amber-200">Editing disabled.</span>{' '}
            Source input expired — re-upload the original to keep tweaking captions.
          </div>
        )}
        <fieldset disabled={editingDisabled} className="contents">
          <div className="p-4 space-y-4 border-b border-ink-700">
            <div>
              <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-300 mb-1">
                Template
              </label>
              <select
                value={templateId}
                onChange={(e) => changeTemplate(e.target.value)}
                className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1.5 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
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
            <TranscriptEditor
              value={transcriptText}
              onChange={(next) => {
                setTranscriptText(next);
                setTranscriptOverridden(true);
              }}
              durationSec={duration}
              disabled={editingDisabled}
            />
          </div>

          <div
            className={`divide-y divide-ink-700 ${editingDisabled ? 'opacity-50 pointer-events-none' : ''}`}
            aria-disabled={editingDisabled || undefined}
          >
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
        </fieldset>
      </div>

      {/* Preview pane — Player runs the same React composition tree as the
          renderer; styleSpec edits update animations live, no server roundtrip. */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-6 space-y-3">
          <PlayerPreview
            videoSrc={data.videoSrc}
            templateId={templateId}
            styleSpec={styleSpec}
            transcript={liveTranscript}
            captionPlan={liveCaptionPlan}
            fallbackFrameSec={frameSec}
            inputAvailable={data.inputAvailable}
            status={data.status}
            outputUrl={data.outputUrl}
            jobIdForStillPreview={jobIdForStillPreview}
          />
          <div className="max-w-[420px] mx-auto flex items-center justify-between gap-3">
            <span className="text-[11px] text-ink-400">
              Total duration: {duration.toFixed(1)}s · {Math.ceil(duration * 30)} frames
            </span>
            {renderedActions}
          </div>
        </div>
      </div>
    </div>
  );
}

function sourceKeyOf(source: EditorSource): string {
  switch (source.kind) {
    case 'job':
      return `job:${source.jobId}`;
    case 'stock':
      return `stock:${source.clipId}`;
    case 'theme':
      return `theme:${source.themeId}`;
  }
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

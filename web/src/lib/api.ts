// Thin API client. The dev server proxies these paths to the Fastify server
// (vite.config.ts), so relative URLs work in both dev and production.

export type JobSummary = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  stage: string | null;
  templateId: string;
  createdAt: string;
  finishedAt: string | null;
};

export type Word = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
};

export type CaptionChunk = {
  words: Word[];
  emphasis: boolean[];
};

export type CaptionPlan = { chunks: CaptionChunk[] };

export type Transcript = {
  language?: string;
  duration?: number;
  words: Word[];
};

export type JobDetail = {
  id: string;
  status: JobSummary['status'];
  stage: string | null;
  templateId: string;
  styleSpec: Record<string, any>;
  transcript: Transcript | null;
  captionPlan: CaptionPlan | null;
  faces: unknown;
  inputPath: string;
  outputPath: string | null;
  // Server tells us whether the source input file still exists. When false
  // (pipeline cleanup ran, or sweeper expired it after 1h), the editor's
  // live overlay <Player> can't load the source — we fall back to a plain
  // <video> of the rendered output mp4 instead.
  inputAvailable: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type PresetView = {
  id: string;
  name: string;
  description: string;
  templateId: string;
  styleSpec: Record<string, any>;
  source: 'builtin' | 'custom';
};

export async function fetchJobs(): Promise<JobSummary[]> {
  const r = await fetch('/jobs');
  if (!r.ok) throw new Error(`GET /jobs ${r.status}`);
  return r.json();
}

// Upload a video for editing. The keepInputMinutes flag opts the new job
// out of the worker's per-render cleanup so the editor can keep using the
// input file for live preview after the render completes.
export async function uploadForEditing(input: {
  file: File;
  preset?: string;
  templateId?: string;
  keepInputMinutes?: number;
}): Promise<{ id: string }> {
  const form = new FormData();
  form.set('video', input.file);
  if (input.preset) form.set('preset', input.preset);
  if (input.templateId) form.set('templateId', input.templateId);
  form.set('keepInputMinutes', String(input.keepInputMinutes ?? 60));
  const r = await fetch('/jobs', { method: 'POST', body: form });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`upload ${r.status}: ${body.error ?? 'failed'}`);
  }
  return r.json();
}

// Submit a new render job that reuses an existing job's input file —
// used by the editor's "Export render" button so the user doesn't have
// to re-upload. Always flagged hidden=true: it's a derivative render of
// the job already in the editor and shouldn't show up as a separate row
// in the sidebar. The server resolves sourceJobId → inputPath and 410s
// if it's already been swept off disk.
export async function submitRender(input: {
  sourceJobId: string;
  templateId: string;
  styleSpec: Record<string, any>;
  keepInputMinutes?: number;
}): Promise<{ id: string }> {
  const form = new FormData();
  form.set('sourceJobId', input.sourceJobId);
  form.set('templateId', input.templateId);
  form.set('styleSpec', JSON.stringify(input.styleSpec));
  form.set('keepInputMinutes', String(input.keepInputMinutes ?? 60));
  form.set('hidden', '1');
  const r = await fetch('/jobs', { method: 'POST', body: form });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`render ${r.status}: ${body.error ?? 'failed'}`);
  }
  return r.json();
}

export async function fetchJob(id: string): Promise<JobDetail> {
  const r = await fetch(`/jobs/${id}`);
  if (!r.ok) throw new Error(`GET /jobs/${id} ${r.status}`);
  return r.json();
}

export async function fetchPresets(): Promise<PresetView[]> {
  const r = await fetch('/presets');
  if (!r.ok) throw new Error(`GET /presets ${r.status}`);
  return r.json();
}

export async function savePreset(input: {
  id: string;
  name: string;
  description?: string;
  templateId: string;
  styleSpec: Record<string, any>;
}): Promise<{ id: string }> {
  const r = await fetch('/presets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`POST /presets ${r.status}: ${body.error ?? 'unknown'}`);
  }
  return r.json();
}

export async function deletePreset(id: string): Promise<void> {
  const r = await fetch(`/presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`DELETE /presets/${id} ${r.status}`);
}

// POST /jobs/:id/preview returns image/png. Returns a Blob URL the caller
// must revokeObjectURL when replacing.
export async function fetchPreviewPng(input: {
  jobId: string;
  styleSpec: Record<string, any>;
  templateId: string;
  frameSec: number;
  signal?: AbortSignal;
}): Promise<Blob> {
  const r = await fetch(`/jobs/${input.jobId}/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      styleSpec: input.styleSpec,
      templateId: input.templateId,
      frameSec: input.frameSec,
    }),
    signal: input.signal,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: 'unknown' }));
    throw new Error(`preview ${r.status}: ${body.error ?? body.message ?? 'failed'}`);
  }
  return r.blob();
}

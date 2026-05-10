// Thin API client. The dev server proxies these paths to the Fastify server
// (vite.config.ts), so relative URLs work in both dev and production.
//
// All requests carry the session cookie (`credentials: 'include'`). The
// server returns 401 when the session is missing/expired; callers throw
// `UnauthenticatedError` and the AuthProvider catches it to bounce the
// user back to the login page.

export class UnauthenticatedError extends Error {
  constructor() {
    super('unauthenticated');
    this.name = 'UnauthenticatedError';
  }
}

async function api(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const r = await fetch(path, { ...init, credentials: 'include' });
  if (r.status === 401) throw new UnauthenticatedError();
  return r;
}

export type AuthUser = {
  id: string;
  email: string;
  role: 'user' | 'admin';
};

// 401 from /auth/me is the expected unauthenticated state, not an error;
// we resolve `null` so the AuthProvider can render the login page.
export async function fetchMe(): Promise<AuthUser | null> {
  const r = await fetch('/auth/me', { credentials: 'include' });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`GET /auth/me ${r.status}`);
  const body = (await r.json()) as { user: AuthUser };
  return body.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const r = await fetch('/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (r.status === 401) {
    throw new Error('Invalid email or password.');
  }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `login ${r.status}`);
  }
  const { user } = (await r.json()) as { user: AuthUser };
  return user;
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
}

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
  const r = await api('/jobs');
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
  const r = await api('/jobs', { method: 'POST', body: form });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`upload ${r.status}: ${body.error ?? 'failed'}`);
  }
  return r.json();
}

// Submit a hidden render derived from an existing job. Used by the editor's
// "Export render" button. We re-fetch the source input (still on disk
// thanks to keepInputMinutes when the job was created) and re-upload it
// alongside the edited styleSpec. The new job is flagged hidden=1 so it
// doesn't show up as a separate row in the sidebar.
export async function submitRender(input: {
  sourceJobId: string;
  templateId: string;
  styleSpec: Record<string, any>;
  keepInputMinutes?: number;
}): Promise<{ id: string }> {
  const inputRes = await api(`/jobs/${input.sourceJobId}/input`);
  if (!inputRes.ok) {
    const body = await inputRes.json().catch(() => ({}));
    throw new Error(
      `couldn't reuse source input (${inputRes.status}): ${body.error ?? 'fetch failed'}`,
    );
  }
  const blob = await inputRes.blob();
  const form = new FormData();
  form.set('video', blob, `source-${input.sourceJobId}.mp4`);
  form.set('templateId', input.templateId);
  form.set('styleSpec', JSON.stringify(input.styleSpec));
  form.set('keepInputMinutes', String(input.keepInputMinutes ?? 60));
  form.set('hidden', '1');
  const r = await api('/jobs', { method: 'POST', body: form });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`render ${r.status}: ${body.error ?? 'failed'}`);
  }
  return r.json();
}

export async function fetchJob(id: string): Promise<JobDetail> {
  const r = await api(`/jobs/${id}`);
  if (!r.ok) throw new Error(`GET /jobs/${id} ${r.status}`);
  return r.json();
}

export async function fetchPresets(): Promise<PresetView[]> {
  const r = await api('/presets');
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
  const r = await api('/presets', {
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
  const r = await api(`/presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
  const r = await api(`/jobs/${input.jobId}/preview`, {
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

// --- Themes & stock clips ------------------------------------------------

export type StockClipSummary = {
  id: string;
  name: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasTranscript: boolean;
};

export type StockClipDetail = {
  id: string;
  name: string;
  src: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: null;
};

export type Theme = {
  id: string;
  name: string;
  description: string;
  templateId: string;
  styleSpec: Record<string, any>;
  showcaseClipId: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
  authorEmail: string | null;
  isOwner: boolean;
};

export type ThemeWithShowcase = Theme & {
  showcaseClip: StockClipDetail | null;
};

export async function fetchStockClips(): Promise<StockClipSummary[]> {
  const r = await api('/clips/stock');
  if (!r.ok) throw new Error(`GET /clips/stock ${r.status}`);
  return r.json();
}

export async function fetchStockClip(id: string): Promise<StockClipDetail> {
  const r = await api(`/clips/stock/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`GET /clips/stock/${id} ${r.status}`);
  return r.json();
}

export async function fetchThemes(): Promise<Theme[]> {
  const r = await api('/themes');
  if (!r.ok) throw new Error(`GET /themes ${r.status}`);
  return r.json();
}

export async function fetchTheme(id: string): Promise<ThemeWithShowcase> {
  const r = await api(`/themes/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`GET /themes/${id} ${r.status}`);
  return r.json();
}

export async function createTheme(input: {
  name: string;
  description?: string;
  templateId: string;
  styleSpec: Record<string, any>;
  showcaseClipId?: string | null;
}): Promise<Theme> {
  const r = await api('/themes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`POST /themes ${r.status}: ${body.error ?? 'unknown'}`);
  }
  return r.json();
}

export async function patchTheme(
  id: string,
  input: Partial<{
    name: string;
    description: string;
    templateId: string;
    styleSpec: Record<string, any>;
    showcaseClipId: string;
  }>,
): Promise<Theme> {
  const r = await api(`/themes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`PATCH /themes/${id} ${r.status}: ${body.error ?? 'unknown'}`);
  }
  return r.json();
}

export async function publishTheme(id: string): Promise<Theme> {
  const r = await api(`/themes/${encodeURIComponent(id)}/publish`, { method: 'POST' });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`publish ${r.status}: ${body.error ?? 'unknown'}`);
  }
  return r.json();
}

export async function unpublishTheme(id: string): Promise<Theme> {
  const r = await api(`/themes/${encodeURIComponent(id)}/unpublish`, { method: 'POST' });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`unpublish ${r.status}: ${body.error ?? 'unknown'}`);
  }
  return r.json();
}

export async function deleteTheme(id: string): Promise<void> {
  const r = await api(`/themes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`DELETE /themes/${id} ${r.status}`);
}

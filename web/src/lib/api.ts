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

export type Transform = {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
};

export type CaptionGroup = {
  id: string;
  name: string;
  styleId: string;
  transform: Transform;
};

export type GroupStyle = {
  id: string;
  name: string;
  bg: string;
  text: string;
  activeBg: string;
  activeText: string;
  weight: number;
  scaleActive: number;
  rotateActive: number;
  baseFontSize: number;
  padX: number;
  padY: number;
  radius: number;
  glow: string | null;
  color: string;
};

export type CaptionPlan = {
  chunks: CaptionChunk[];
  groups?: CaptionGroup[];
  wordGroupAssignments?: Record<string, string>;
};

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
  // Source intrinsic dimensions, populated for jobs created from a
  // user_video (and forward-fill from upload metadata). NULL for legacy
  // jobs that predate the schema column — those fall back to the default
  // 1080×1920 vertical canvas.
  widthPx: number | null;
  heightPx: number | null;
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

// --- Designs (Caption Designer) -----------------------------------------

export type DesignSummary = {
  id: string;
  name: string;
  sourceKind: 'stock' | 'job';
  sourceId: string;
  templateId: string;
  thumbnailPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Design = DesignSummary & {
  userId: string;
  state: unknown;
};

export async function listDesigns(): Promise<DesignSummary[]> {
  const r = await api('/designs');
  if (!r.ok) throw new Error(`GET /designs ${r.status}`);
  return r.json();
}

export async function getDesign(id: string): Promise<Design> {
  const r = await api(`/designs/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`GET /designs/${id} ${r.status}`);
  return r.json();
}

export async function createDesign(input: {
  name: string;
  sourceKind: 'stock' | 'job';
  sourceId: string;
  state: unknown;
}): Promise<Design> {
  const r = await api('/designs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`POST /designs ${r.status}: ${body.error ?? 'unknown'}`);
  }
  return r.json();
}

export async function patchDesign(
  id: string,
  input: Partial<{ name: string; state: unknown }>,
): Promise<Design> {
  const r = await api(`/designs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`PATCH /designs/${id} ${r.status}: ${body.error ?? 'unknown'}`);
  }
  return r.json();
}

export async function deleteDesign(id: string): Promise<void> {
  const r = await api(`/designs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`DELETE /designs/${id} ${r.status}`);
}

// --- Designer sessions (/designer/:id) ----------------------------------
// Each row is the persisted state of one agent conversation: the chat
// transcript + the editor source ref + the latest styleSpec snapshot.
// Created on the user's first message; PATCHed after every agent reply.

export type DesignerSessionSummary = {
  id: string;
  title: string;
  templateId: string;
  sourceKind: 'stock' | 'job';
  sourceId: string;
  createdAt: string;
  updatedAt: string;
};

export type DesignerSession = DesignerSessionSummary & {
  userId: string;
  styleSpec: Record<string, unknown>;
  // Whole-video scene plan (DirectorScript) or null if the agent never
  // fired apply_director_script for this session.
  directorScript: unknown | null;
  // Server stores opaque UIMessage[]; the client casts at the use site.
  messages: unknown[];
};

export async function listDesignerSessions(): Promise<DesignerSessionSummary[]> {
  const r = await api('/designer/sessions');
  if (!r.ok) throw new Error(`GET /designer/sessions ${r.status}`);
  return r.json();
}

export async function getDesignerSession(id: string): Promise<DesignerSession> {
  const r = await api(`/designer/sessions/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`GET /designer/sessions/${id} ${r.status}`);
  return r.json();
}

export async function createDesignerSession(input: {
  templateId: string;
  sourceKind: 'stock' | 'job';
  sourceId: string;
  styleSpec: Record<string, unknown>;
  // Whole-video scene plan if the very first user turn already produced one.
  // Almost always null at create time (page state hasn't seen an agent
  // reply yet); the first PATCH on response brings it in.
  directorScript?: unknown | null;
  firstMessage: string;
  messages?: unknown[];
}): Promise<DesignerSession> {
  const r = await api('/designer/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`POST /designer/sessions ${r.status}: ${body.error ?? 'unknown'}`);
  }
  return r.json();
}

export async function patchDesignerSession(
  id: string,
  input: Partial<{
    title: string;
    messages: unknown[];
    styleSpec: Record<string, unknown>;
    // null = explicit clear (revert dropped the plan); undefined = don't touch.
    directorScript: unknown | null;
  }>,
): Promise<DesignerSession> {
  const r = await api(`/designer/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`PATCH /designer/sessions/${id} ${r.status}: ${body.error ?? 'unknown'}`);
  }
  return r.json();
}

export async function deleteDesignerSession(id: string): Promise<void> {
  const r = await api(`/designer/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`DELETE /designer/sessions/${id} ${r.status}`);
}

// --- Agent chat (/designer/*) -------------------------------------------

import type { DirectorScript } from './director';
export type { DirectorScript } from './director';

export type AgentPatch = {
  scope: 'global' | 'chunk';
  styleSpec?: Record<string, unknown>;
  chunkOverride?: { range: [number, number]; overrides: Record<string, unknown> };
  templateId?: string;
  /** Whole-video Director plan, written by the agent's apply_director_script tool. */
  directorScript?: DirectorScript;
};

export type AgentToolCall = { name: string; input: Record<string, unknown> };

export type DirectorPlanWord = { idx: number; t: number; w: string };

export type AgentChatRequest = {
  threadId: string;
  message: string;
  currentSpec: Record<string, unknown>;
  templateId: string;
  selectedWord?: { idx: number; text: string; t: number; d: number };
  transcriptSummary?: { totalWords: number; durationSec: number };
  /**
   * Full timed transcript ({ idx, t, w }). The chat agent doesn't use this
   * on its own turn (would blow the token budget), but its
   * apply_director_script tool needs it server-side to delegate to the
   * Director planner. Always send when known.
   */
  transcript?: DirectorPlanWord[];
  /**
   * Current director plan (if one has been applied this session). Required
   * server-side by set_caption_visibility(mode:"selective") so the tool can
   * map role names like hero-title-card to actual chunk ranges. Omit when
   * no plan exists yet.
   */
  directorScript?: DirectorScript | null;
  /** Optional OpenRouter model id override; falls back to AGENT_MODEL env / Haiku. */
  model?: string;
};

export type AgentChatResponse = {
  assistantMessage: string;
  patch: AgentPatch | null;
  toolTrace: AgentToolCall[];
  notes?: string;
};

export async function postAgentChat(body: AgentChatRequest): Promise<AgentChatResponse> {
  const r = await api('/agent/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 429) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.message ?? 'agent rate-limited');
  }
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.message ?? `POST /agent/chat ${r.status}`);
  }
  return r.json();
}

// --- Director plan (/director/plan) -------------------------------------

export type DirectorPlanRequest = {
  transcript: DirectorPlanWord[];
  message: string;
  currentScript?: DirectorScript;
  model?: string;
};

export type DirectorPlanResponse = {
  script: DirectorScript;
  attempts: number;
};

export async function postDirectorPlan(
  body: DirectorPlanRequest,
): Promise<DirectorPlanResponse> {
  const r = await api('/director/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.message ?? `POST /director/plan ${r.status}`);
  }
  return r.json();
}

export async function renderDesign(id: string): Promise<{ id: string }> {
  const r = await api(`/designs/${encodeURIComponent(id)}/render`, { method: 'POST' });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`POST /designs/${id}/render ${r.status}: ${body.error ?? 'unknown'}`);
  }
  return r.json();
}

// ─── User uploads (persistent S3-backed source videos) ────────────────────
//
// Three-step upload: init → PUT directly to S3 → finalize. The browser
// never streams bytes through our Fastify container; the API hands out
// presigned URLs and verifies the object landed on finalize. See
// src/api/server.ts → /uploads/* for the server side.

export type UserVideo = {
  id: string;
  displayName: string;
  originalFilename: string;
  sizeBytes: number | null;
  durationSec: number | null;
  widthPx: number | null;
  heightPx: number | null;
  mimeType: string | null;
  status: 'pending' | 'ready' | 'failed';
  createdAt: string;
};

export type UserVideoDetail = UserVideo & {
  videoUrl: string;
};

export type UploadInitResponse = {
  uploadId: string;
  putUrl: string;
  contentType: string;
  expiresInSec: number;
  upload: UserVideo;
};

export async function initUpload(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<UploadInitResponse> {
  const r = await api('/uploads/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `POST /uploads/init ${r.status}`);
  }
  return r.json();
}

export async function finalizeUpload(
  uploadId: string,
  body: { durationSec?: number; widthPx?: number; heightPx?: number } = {},
): Promise<UserVideo> {
  const r = await api(`/uploads/${encodeURIComponent(uploadId)}/finalize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.error ?? `POST /uploads/${uploadId}/finalize ${r.status}`);
  }
  return r.json();
}

export async function listUploads(): Promise<UserVideo[]> {
  const r = await api('/uploads');
  if (!r.ok) throw new Error(`GET /uploads ${r.status}`);
  return r.json();
}

export async function getUpload(uploadId: string): Promise<UserVideoDetail> {
  const r = await api(`/uploads/${encodeURIComponent(uploadId)}`);
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.error ?? `GET /uploads/${uploadId} ${r.status}`);
  }
  return r.json();
}

export async function renameUpload(
  uploadId: string,
  displayName: string,
): Promise<UserVideo> {
  const r = await api(`/uploads/${encodeURIComponent(uploadId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.error ?? `PATCH /uploads/${uploadId} ${r.status}`);
  }
  return r.json();
}

export async function deleteUpload(uploadId: string): Promise<void> {
  const r = await api(`/uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail.error ?? `DELETE /uploads/${uploadId} ${r.status}`);
  }
}

// Submit a new render job sourced from a persistent user_video. Mirrors
// `uploadForEditing` but uses the JSON branch of POST /jobs — the upload
// already lives on S3, so no multipart payload is needed.
export async function createJobFromUpload(input: {
  userVideoId: string;
  preset?: string;
  templateId?: string;
  styleSpec?: Record<string, any>;
  keepInputMinutes?: number;
  hidden?: boolean;
}): Promise<{ id: string }> {
  const r = await api('/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`POST /jobs ${r.status}: ${body.error ?? 'failed'}`);
  }
  return r.json();
}

// ─── MCP API keys ────────────────────────────────────────────────────────
export type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export async function listMcpKeys(): Promise<ApiKey[]> {
  const r = await api('/keys');
  if (!r.ok) throw new Error(`GET /keys ${r.status}`);
  const body = (await r.json()) as { keys: ApiKey[] };
  return body.keys;
}

export async function createMcpKey(name: string): Promise<{ key: ApiKey; plaintext: string }> {
  const r = await api('/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `POST /keys ${r.status}`);
  }
  return r.json();
}

export async function revokeMcpKey(id: string): Promise<void> {
  const r = await api(`/keys/${id}`, { method: 'DELETE' });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `DELETE /keys/${id} ${r.status}`);
  }
}

// MCP server — single `chat` tool that delegates to Atelier (runAgentChat).
//
// Mounted on the existing Fastify app at /mcp. We use the SDK's
// StreamableHTTPServerTransport in stateless mode (no sessionIdGenerator)
// because all conversation state already lives in the SqliteSaver
// checkpointer keyed by (userId, threadId). The MCP request shape carries
// the threadId in tool args, and authentication is handled by the
// requireApiKey Fastify preHandler before the transport ever sees the
// request — so the user is already resolved when the tool callback fires.
//
// Why a single tool: every external AI editor (Claude Desktop, Cursor,
// custom agents) is itself an LLM. Atelier's 450-line system prompt and
// archetype recipes live inside *our* model; surfacing them as MCP tool
// descriptions would force every caller to reload that knowledge into
// their context window. One thin `chat` tool keeps the caller's context
// clean and treats Atelier as a black-box expert collaborator.

import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { User } from '../auth/users.js';
import { requireApiKey } from '../auth/requireApiKey.js';
import { runAgentChat } from '../stages/agentChat.js';
import { getClipStatus, registerClipFromPath, registerClipFromUrl } from '../lib/clipIngest.js';
import { findRecentJobForClip, getRenderStatus } from '../lib/renderControl.js';
import { WABISABI_DESIGN_GUIDE } from './guide.js';
import { db } from '../db.js';

// Running-spec persistence. Without the web app's browser store to
// round-trip the accumulating styleSpec between turns, MCP threads would
// lose every styling tool's effect on the next chat call. Load before
// each chat (so Atelier sees the spec from prior turns) and save after
// (so the next turn picks up where this left off).
type ThreadState = {
  styleSpec: Record<string, unknown>;
  templateId: string;
};
function loadThreadState(threadId: string, userId: string): ThreadState {
  const row = db
    .prepare(
      `select styleSpec, templateId from agent_threads where id = ? and userId = ?`,
    )
    .get(threadId, userId) as
    | { styleSpec: string | null; templateId: string | null }
    | undefined;
  if (!row) return { styleSpec: {}, templateId: 'reel-clone' };
  let styleSpec: Record<string, unknown> = {};
  if (row.styleSpec) {
    try {
      styleSpec = JSON.parse(row.styleSpec) as Record<string, unknown>;
    } catch {
      styleSpec = {};
    }
  }
  return { styleSpec, templateId: row.templateId ?? 'reel-clone' };
}
function saveThreadState(
  threadId: string,
  userId: string,
  styleSpec: Record<string, unknown>,
  templateId: string,
): void {
  try {
    db.prepare(
      `update agent_threads
          set styleSpec = ?, templateId = ?, lastUsedAt = datetime('now')
        where id = ? and userId = ?`,
    ).run(JSON.stringify(styleSpec), templateId, threadId, userId);
  } catch (err) {
    console.warn('agent_threads styleSpec save failed:', (err as Error).message);
  }
}

// Merge a patch from one chat turn into the running spec. Top-level keys
// are replaced wholesale (matches the web editor's applyThemePatch).
function mergePatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!patch) return current;
  return { ...current, ...patch };
}

const CHAT_DESCRIPTION = `Talk to Wabisabi, a motion-caption design service. Wabisabi takes a video and turns it into a captioned reel: ingest the source clip, choose an aesthetic (Hormozi cascade, Netflix-doc, IMAX, MrBeast pop, editorial magazine, designer studio, …), and render an mp4.

# When the user has attached / referenced a video on this turn

You MUST pass the source via one of the dedicated params — do NOT just describe the file in 'message' text and hope Wabisabi figures it out:

  • **clipPath** — set this whenever you have access to the file on the local filesystem (the typical case: the user attached a file, or you have it on disk via your filesystem tool). Pass the ABSOLUTE path. Wabisabi reads the bytes itself; no upload step needed. This is the right choice for Claude Desktop's local-agent-mode attachments, Cursor's workspace files, any tool that runs on the same machine as Wabisabi.
  • **clipUrl** — set this when the user gives you a public http(s) URL.

Both are optional and only need to be set the FIRST time you give Wabisabi the clip. On follow-up turns ("ready yet?", "make it more cinematic"), omit them — Wabisabi remembers the clip via threadId.

If the user attached a file but its absolute path isn't surfaced in your context: use your filesystem tool to find it FIRST, then call chat with the path. Don't ask Wabisabi to do it without one — Wabisabi has no view of your attachments.

# threadId

Same UUID across one conversation; new UUID when the user starts a new task.

# Response shape

The reply field is Wabisabi's natural-language response. state hints at whether more work is pending (rendering, awaiting follow-up, etc.).

# Cheap status polling

For "ready yet?" / progress-check turns, prefer the **\`get_status\`** tool over \`chat\`. It's a direct DB lookup — no LLM call, zero token cost on Wabisabi's side. Only use \`chat\` when you want Wabisabi to actually do something new (apply a style, kick off a render, refine).

# Design vocabulary — CALL get_design_guide FIRST

**On the first turn of any new conversation about captions, call the \`get_design_guide\` tool BEFORE \`chat\`.** It returns a prompting playbook with archetypes, scene roles, motion effects, and recipe shapes. Without it, you'll write generic prompts and Wabisabi will deliver generic output. With it, you can write "Hormozi cascade with shockwave on the stat callouts, palette #0e0e0e/#ff5a1f/#f4b942" — and Wabisabi nails it on the first render.

The same content is also available as the MCP resource \`wabisabi://design-guide\` for clients that support resources.`;

const chatInputSchema = {
  threadId: z
    .string()
    .min(1)
    .describe('Stable per-conversation identifier (caller-generated UUID). Same id across one task, new id when the user moves on.'),
  message: z
    .string()
    .min(1)
    .describe('Your message to Wabisabi, in natural language. Describe what the user wants ("make captions Hormozi-style and render", "more cinematic", "ready yet?"). Do NOT paste filesystem paths or URLs here — use clipPath / clipUrl for those.'),
  clipPath: z
    .string()
    .optional()
    .describe('ABSOLUTE filesystem path of the video to ingest. Set this on the first turn whenever you have the file on disk — including any user-attached file (Claude Desktop local-agent-mode uploads, Cursor workspace files, etc.). Omit on follow-up turns; Wabisabi remembers the clip via threadId.'),
  clipUrl: z
    .string()
    .optional()
    .describe('Public http(s) URL of the video to ingest. Use this when the user gives you a URL instead of a file. Omit on follow-up turns.'),
};

type ChatArgs = {
  threadId: string;
  message: string;
  clipPath?: string;
  clipUrl?: string;
};

/**
 * Build a fresh McpServer wired to one user. We rebuild per-request rather
 * than caching by userId because the SDK's transport assumes ownership of
 * the underlying server, and the tool closure needs to capture the user
 * id so cross-key requests can't collide.
 */
function buildServerForUser(user: User): McpServer {
  const server = new McpServer({
    name: 'wabisabi',
    version: '0.1.0',
    description: 'Motion-caption design and render for video editors.',
  });

  server.registerTool(
    'chat',
    {
      title: 'Chat with Wabisabi',
      description: CHAT_DESCRIPTION,
      inputSchema: chatInputSchema,
    },
    async (args: ChatArgs) => {
      try {
        // Pre-ingest. The schema-driven clipPath / clipUrl params are the
        // load-bearing UX choice — upstream LLMs reliably populate
        // schema-required-looking fields, but unreliably paste paths into
        // free-form message text. Run ingest BEFORE Atelier so the conv
        // history records a clean "user provided clipId X" turn that the
        // model can lean on for the render call.
        const ingestNotes: string[] = [];
        if (args.clipPath) {
          try {
            const { clipId, sizeBytes, status } = registerClipFromPath({
              userId: user.id,
              path: args.clipPath,
            });
            ingestNotes.push(
              `[ingest] User provided clipPath=${args.clipPath}; registered as clipId=${clipId} (${(sizeBytes / 1e6).toFixed(1)} MB, status=${status}). Upload to S3 is happening in the background — render() will wait for it. Proceed to style work now; don't block.`,
            );
          } catch (err) {
            ingestNotes.push(
              `[ingest] clipPath=${args.clipPath} failed: ${(err as Error).message}. Ask the user to verify the path or share a public URL instead.`,
            );
          }
        }
        if (args.clipUrl) {
          try {
            const { clipId, sizeBytes } = await registerClipFromUrl({
              userId: user.id,
              url: args.clipUrl,
            });
            ingestNotes.push(
              `[ingest] User provided clipUrl=${args.clipUrl}; registered as clipId=${clipId} (${sizeBytes ?? 'unknown'} bytes, status=ready). Use this clipId for render().`,
            );
          } catch (err) {
            ingestNotes.push(
              `[ingest] clipUrl=${args.clipUrl} failed: ${(err as Error).message}. Ask the user for a different URL or a filesystem path.`,
            );
          }
        }
        const augmentedMessage = ingestNotes.length
          ? `${ingestNotes.join('\n')}\n\n${args.message}`
          : args.message;

        // Load the running spec from prior turns (the web editor has a
        // browser store for this; MCP doesn't, so we persist it on the
        // agent_threads row). On the first turn this comes back empty.
        const priorState = loadThreadState(args.threadId, user.id);

        const result = await runAgentChat({
          threadId: args.threadId,
          userId: user.id,
          message: augmentedMessage,
          currentSpec: priorState.styleSpec,
          templateId: priorState.templateId,
        });

        // Save the running spec back so the next turn picks up where this
        // left off. result.patch holds whatever the agent staged this turn
        // (apply_preset_pack, set_effect, etc); merge it into the prior
        // spec the same way the web editor's applyThemePatch does.
        const nextStyleSpec = mergePatch(
          priorState.styleSpec,
          result.patch?.styleSpec as Record<string, unknown> | null | undefined,
        );
        const nextTemplateId =
          (result.patch?.templateId as string | undefined) ?? priorState.templateId;
        saveThreadState(args.threadId, user.id, nextStyleSpec, nextTemplateId);

        return {
          content: [
            {
              type: 'text' as const,
              text: result.assistantMessage,
            },
          ],
          structuredContent: {
            reply: result.assistantMessage,
            patch: result.patch,
            toolCalls: result.toolTrace.map((t) => ({ name: t.name })),
          },
        };
      } catch (err) {
        const message = (err as Error).message;
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Wabisabi failed: ${message}`,
            },
          ],
        };
      }
    },
  );

  // ── get_status: cheap, no-LLM status poll ────────────────────────────
  //
  // Callers (especially upstream LLMs polling aggressively for render
  // completion) should prefer this over `chat` for "ready yet?" turns.
  // Pure DB lookups; zero token cost on Wabisabi's side. Returns clip
  // upload status + latest render job state + output URL when done.
  server.registerTool(
    'get_status',
    {
      title: 'Get clip / render status (no LLM)',
      description:
        'Fast DB-only status check — no LLM call, no token cost. Use this for "ready yet?" polling instead of chat. Pass clipId to look up the latest render for that clip, OR jobId for a direct render lookup. Returns {clip, render, outputUrl?}.',
      inputSchema: {
        clipId: z
          .string()
          .optional()
          .describe('Clip id — returns the latest render job for this clip.'),
        jobId: z
          .string()
          .optional()
          .describe('Specific render job id (overrides clipId lookup).'),
      },
    },
    async (args: { clipId?: string; jobId?: string }) => {
      if (!args.clipId && !args.jobId) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Provide clipId or jobId.' }],
        };
      }

      const clip = args.clipId
        ? await getClipStatus({ clipId: args.clipId, userId: user.id })
        : null;
      let jobId = args.jobId ?? null;
      if (!jobId && args.clipId) {
        const recent = findRecentJobForClip({ clipId: args.clipId, userId: user.id });
        jobId = recent?.jobId ?? null;
      }
      const render = jobId
        ? await getRenderStatus({ jobId, userId: user.id })
        : null;

      const summary = {
        clip: clip
          ? {
              clipId: clip.clipId,
              status: clip.status,
              filename: clip.filename,
              sizeBytes: clip.sizeBytes,
            }
          : null,
        render: render
          ? {
              jobId: render.jobId,
              status: render.status,
              stage: render.stage,
              progressPct: render.progressPct,
              error: render.error,
            }
          : null,
        outputUrl: render?.outputUrl,
        hint:
          render?.status === 'done'
            ? 'Render complete — outputUrl is valid for 1h.'
            : render?.status === 'failed'
              ? 'Render failed — see render.error.'
              : render?.status
                ? `Render is ${render.status}${render.stage ? ` (stage: ${render.stage})` : ''}. Poll again in 10-20s.`
                : clip?.status === 'pending'
                  ? 'Clip still uploading. Poll again in 10-20s.'
                  : clip?.status === 'ready'
                    ? 'Clip ready but no render started yet. Call chat to kick one off.'
                    : 'Nothing to report.',
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
        structuredContent: summary,
      };
    },
  );

  // ── get_design_guide tool (same content as the resource) ────────────
  //
  // MCP resources don't auto-surface in every client — Claude Desktop in
  // particular only exposes tools to the upstream model. Expose the same
  // markdown via a tool so the upstream agent can fetch it deterministically
  // on the first turn of any new conversation. Idempotent + cheap.
  server.registerTool(
    'get_design_guide',
    {
      title: 'Fetch Wabisabi prompting playbook',
      description:
        'Returns a prompting playbook (markdown) for talking to Wabisabi: archetypes (Hormozi cascade, Netflix-doc, IMAX, MrBeast pop, editorial, designer studio, …), scene roles, motion effects, layout strategies, recipe prompts, and anti-patterns. **Call this once at the start of any new conversation** before composing your design prompt — it lets you write much richer, more aesthetic direction in the chat call. Cheap (no LLM, just static text).',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text' as const, text: WABISABI_DESIGN_GUIDE }],
    }),
  );

  // ── design-guide resource (same content, for clients that support resources) ─
  //
  // The full vocabulary (scene roles, motion effects, layouts, motion
  // presets, preset packs, prompting strategies, anti-patterns). The
  // upstream AI client can fetch this once per conversation to internalize
  // the available design language — equivalent to a Claude Code "skill".
  server.registerResource(
    'design-guide',
    'wabisabi://design-guide',
    {
      title: 'Wabisabi design vocabulary',
      description:
        'Closed vocabulary Wabisabi speaks: 10 scene roles, 11 motion effects, 8 layout strategies, 7 motion presets, 2 preset packs, prompting strategies and anti-patterns. Fetch once per conversation and use the names verbatim in your messages for the most precise design changes.',
      mimeType: 'text/markdown',
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: 'text/markdown',
          text: WABISABI_DESIGN_GUIDE,
        },
      ],
    }),
  );

  return server;
}

/**
 * Register POST /mcp on the Fastify app. The transport runs in stateless
 * mode — each HTTP request gets its own transport + server, and all
 * conversation history is in the SqliteSaver. This avoids the per-process
 * session map that a stateful transport would need (problematic for
 * Railway, where rolling deploys would orphan in-flight sessions).
 */
export function mountMcp(app: FastifyInstance): void {
  // Body parsing: the SDK transport expects to either parse the body
  // itself or be handed an already-parsed body. Fastify parses JSON by
  // default — we just forward req.body via the parsedBody hook.
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      // requireApiKey should have populated this; defensive 401.
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const server = buildServerForUser(req.user);
    const transport = new StreamableHTTPServerTransport({
      // Stateless: don't emit Mcp-Session-Id, don't track sessions.
      sessionIdGenerator: undefined,
      // Respond as plain JSON (not SSE) for tools that complete
      // synchronously. The Atelier chat call already long-polls render
      // internally — there's no streaming benefit to keeping an SSE
      // channel open just to deliver the single final reply.
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } finally {
      // Best-effort close — the transport will also close on its own
      // when the underlying response ends, but explicit close releases
      // any handles the SDK might still be holding.
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    }
    // Mark the Fastify reply as hijacked since the transport wrote to
    // res.raw directly.
    reply.hijack();
  };

  app.post('/mcp', { preHandler: requireApiKey }, handler);
  app.get('/mcp', { preHandler: requireApiKey }, handler);
  app.delete('/mcp', { preHandler: requireApiKey }, handler);
}

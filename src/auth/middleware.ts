import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import '@fastify/cookie';
import { SESSION_COOKIE, getSessionUser } from './sessions.js';
import type { User } from './users.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

export function readSessionUser(req: FastifyRequest): User | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  return getSessionUser(token);
}

// Test-only auth bypass for the agentic experiment route. Enabled ONLY when
// process.env.TEST_AGENT_KEY is set AND the incoming request carries a
// matching x-admin-key header. Synthetic user is admin-flagged so route
// handlers that gate on req.user!.id (e.g. rate limits) work without
// touching the users table. The key is generated and stored in .env (which
// is .gitignore'd) — rotate or delete the env entry to disable.
const SYNTHETIC_TEST_USER: User = {
  id: 'system:agent-test',
  email: 'agent-test@local',
  role: 'admin',
  createdAt: new Date(0).toISOString(),
};

function constantTimeMatch(envKey: string, provided: string): boolean {
  if (!provided || provided.length !== envKey.length) return false;
  const a = Buffer.from(envKey);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function checkTestKey(req: FastifyRequest): User | null {
  const envKey = process.env.TEST_AGENT_KEY;
  if (!envKey || envKey.length < 16) return null;

  // Accept either the x-admin-key header OR a `test_agent_key` cookie. The
  // cookie path is what lets the browser-based SPA authenticate (you can't
  // easily inject custom headers on a top-level navigation, but cookies
  // ride along automatically via credentials: 'include').
  const headerVal = req.headers['x-admin-key'];
  const cookieVal = req.cookies?.['test_agent_key'];
  const provided =
    typeof headerVal === 'string'
      ? headerVal
      : typeof cookieVal === 'string'
        ? cookieVal
        : '';
  if (!constantTimeMatch(envKey, provided)) return null;

  // Loud warning per request so accidental left-on-in-prod is visible.
  req.log.warn({ path: req.url }, 'TEST_AGENT_KEY accepted — synthetic admin user attached');
  return SYNTHETIC_TEST_USER;
}

export const requireAuth: preHandlerHookHandler = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const user = readSessionUser(req) ?? checkTestKey(req);
  if (!user) {
    reply.code(401).send({ error: 'unauthenticated' });
    return reply;
  }
  req.user = user;
};

export function requireOwnership<T extends { userId?: string | null }>(
  req: FastifyRequest,
  reply: FastifyReply,
  row: T | undefined,
): T | null {
  if (!row) {
    reply.code(404).send({ error: 'not found' });
    return null;
  }
  // 404 (not 403) on mismatched ownership so we don't leak existence to
  // unrelated users. Legacy rows with NULL userId are visible to no one
  // until claimed via `npm run admin:claim`.
  if (!row.userId || row.userId !== req.user?.id) {
    reply.code(404).send({ error: 'not found' });
    return null;
  }
  return row;
}

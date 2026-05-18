import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { verifyApiKey } from './apiKeys.js';
import { findUserById, type User } from './users.js';
import { readSessionUser } from './middleware.js';

/**
 * Fastify preHandler that authenticates a request via either:
 *
 *   1. `Authorization: Bearer wsk_live_...` — for MCP clients
 *   2. The existing session cookie — so the same routes can be hit from
 *      the web app during development without a key.
 *
 * On success, attaches `req.user` (same shape as `requireAuth`). On
 * failure, 401s.
 */
export const requireApiKey: preHandlerHookHandler = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  // Cookie path first — cheaper than scrypt verify.
  const cookieUser = readSessionUser(req);
  if (cookieUser) {
    req.user = cookieUser;
    return;
  }

  const header = req.headers.authorization;
  const token = parseBearer(header);
  if (!token) {
    reply.code(401).send({ error: 'missing bearer token' });
    return reply;
  }

  const result = await verifyApiKey(token);
  if (!result) {
    reply.code(401).send({ error: 'invalid api key' });
    return reply;
  }

  const user: User | null = findUserById(result.userId);
  if (!user) {
    reply.code(401).send({ error: 'api key references unknown user' });
    return reply;
  }
  req.user = user;
};

function parseBearer(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^Bearer\s+(\S+)$/i);
  return m && m[1] ? m[1] : null;
}

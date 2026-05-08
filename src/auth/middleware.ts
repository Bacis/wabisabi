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

export const requireAuth: preHandlerHookHandler = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  const user = readSessionUser(req);
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

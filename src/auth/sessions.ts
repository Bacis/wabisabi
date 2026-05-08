import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { findUserById, type User } from './users.js';

export const SESSION_COOKIE = 'cap_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SLIDE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // refresh expiry once a day

const insertSession = db.prepare(
  `insert into sessions (id, userId, expiresAt) values (?, ?, ?)`,
);
const selectSession = db.prepare(`select * from sessions where id = ?`);
const slideSession = db.prepare(
  `update sessions set expiresAt = ?, lastSeenAt = datetime('now') where id = ?`,
);
const deleteSession = db.prepare(`delete from sessions where id = ?`);
const deleteExpired = db.prepare(`delete from sessions where expiresAt <= datetime('now')`);

type SessionRow = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseSqliteUtc(s: string): number {
  return Date.parse(s.replace(' ', 'T') + 'Z');
}

function toSqliteUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function createSession(userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  insertSession.run(id, userId, toSqliteUtc(expiresAt));
  return { token, expiresAt };
}

export function getSessionUser(token: string): User | null {
  const id = hashToken(token);
  const row = selectSession.get(id) as SessionRow | undefined;
  if (!row) return null;
  const expMs = parseSqliteUtc(row.expiresAt);
  if (!Number.isFinite(expMs) || expMs <= Date.now()) {
    deleteSession.run(id);
    return null;
  }
  // Sliding window: bump expiry once a day so an active user stays signed
  // in indefinitely without writing on every request.
  if (expMs - Date.now() < SESSION_TTL_MS - SLIDE_THRESHOLD_MS) {
    slideSession.run(toSqliteUtc(new Date(Date.now() + SESSION_TTL_MS)), id);
  }
  return findUserById(row.userId);
}

export function revokeSession(token: string): void {
  deleteSession.run(hashToken(token));
}

export function pruneExpiredSessions(): number {
  return deleteExpired.run().changes;
}

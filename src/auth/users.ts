import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { hashPassword, verifyPassword } from './passwords.js';

export type Role = 'user' | 'admin';

export type User = {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
};

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
};

const insertUser = db.prepare(
  `insert into users (id, email, passwordHash, role) values (?, ?, ?, ?)`,
);
const selectByEmail = db.prepare(`select * from users where email = ? collate nocase`);
const selectById = db.prepare(`select * from users where id = ?`);
const updatePasswordHash = db.prepare(
  `update users set passwordHash = ?, updatedAt = datetime('now') where id = ?`,
);
const listAll = db.prepare(`select * from users order by createdAt`);

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.createdAt };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createUser(input: {
  email: string;
  password: string;
  role?: Role;
}): Promise<User> {
  const email = normalizeEmail(input.email);
  if (!email.includes('@')) throw new Error('invalid email');
  if (input.password.length < 8) throw new Error('password must be at least 8 characters');
  const id = randomUUID();
  const hash = await hashPassword(input.password);
  try {
    insertUser.run(id, email, hash, input.role ?? 'user');
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new Error('email already in use');
    throw err;
  }
  const row = selectById.get(id) as UserRow;
  return toUser(row);
}

export function findUserByEmail(email: string): UserRow | null {
  const row = selectByEmail.get(normalizeEmail(email)) as UserRow | undefined;
  return row ?? null;
}

export function findUserById(id: string): User | null {
  const row = selectById.get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export async function setPassword(userId: string, newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error('password must be at least 8 characters');
  const hash = await hashPassword(newPassword);
  updatePasswordHash.run(hash, userId);
}

export function listUsers(): User[] {
  return (listAll.all() as UserRow[]).map(toUser);
}

export async function authenticate(
  email: string,
  password: string,
): Promise<User | null> {
  const row = findUserByEmail(email);
  if (!row) {
    // Run scrypt against a dummy hash so the response time doesn't reveal
    // whether the email exists. ~50–80 ms either way.
    await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    return null;
  }
  const ok = await verifyPassword(password, row.passwordHash);
  return ok ? toUser(row) : null;
}

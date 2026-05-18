import { randomUUID, randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { hashPassword, verifyPassword } from './passwords.js';

// MCP API keys. Format: `wsk_live_<prefix12>.<secret40>`.
//
//   wsk_live_   constant 9-char brand prefix; lets users grep for "wsk_"
//               and lets us reserve `wsk_test_` later if we want a test mode.
//   prefix12    11-char url-safe base64 (= 8 random bytes). Stored verbatim
//               in api_keys.keyPrefix as `wsk_live_<prefix12>` (20 chars).
//               Indexed unique — drives O(1) row lookup at verify time.
//   .           Single-dot separator. Picked because b64url uses [A-Za-z0-9_-]
//               so a `.` is unambiguously the boundary even when underscores
//               appear inside either half.
//   secret40    30-char url-safe base64 (= 22 random bytes). Never stored;
//               only its scrypt hash lives in api_keys.keyHash.
//
// Total length: 9 + 11 + 1 + 30 = 51 chars. Stable per-key, copy-pasteable.

const BRAND = 'wsk_live_';
const PREFIX_LEN = BRAND.length + 11; // 20
const SEP = '.';
const PREFIX_BYTES = 8; // → 11 chars b64url
const SECRET_BYTES = 22; // → 30 chars b64url (no padding)

function b64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

type Row = {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type ApiKeyPublic = {
  id: string;
  name: string;
  keyPrefix: string; // safe to show in UI
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const insertStmt = db.prepare(
  `insert into api_keys (id, userId, name, keyHash, keyPrefix) values (?, ?, ?, ?, ?)`,
);
const selectByPrefix = db.prepare(`select * from api_keys where keyPrefix = ?`);
const listByUser = db.prepare(
  `select id, name, keyPrefix, createdAt, lastUsedAt, revokedAt
     from api_keys
    where userId = ?
    order by case when revokedAt is null then 0 else 1 end, createdAt desc`,
);
const revokeStmt = db.prepare(
  `update api_keys set revokedAt = datetime('now') where id = ? and userId = ? and revokedAt is null`,
);
const touchStmt = db.prepare(
  `update api_keys set lastUsedAt = datetime('now') where id = ?`,
);

function publicView(row: Row | ApiKeyPublic): ApiKeyPublic {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

/**
 * Mint a new key for a user. Returns the plaintext exactly once —
 * the caller must surface it to the user immediately and never log it.
 */
export async function createApiKey(input: {
  userId: string;
  name: string;
}): Promise<{ plaintext: string; key: ApiKeyPublic }> {
  const name = input.name.trim();
  if (!name) throw new Error('name is required');
  if (name.length > 80) throw new Error('name must be ≤ 80 chars');

  const prefixSegment = b64url(randomBytes(PREFIX_BYTES));
  const secretSegment = b64url(randomBytes(SECRET_BYTES));
  const keyPrefix = `${BRAND}${prefixSegment}`;
  const plaintext = `${keyPrefix}${SEP}${secretSegment}`;
  const id = randomUUID();
  const keyHash = await hashPassword(secretSegment);

  insertStmt.run(id, input.userId, name, keyHash, keyPrefix);

  const row = (db
    .prepare(
      `select id, name, keyPrefix, createdAt, lastUsedAt, revokedAt from api_keys where id = ?`,
    )
    .get(id) as ApiKeyPublic) ?? null;
  if (!row) throw new Error('failed to read back created api_key row');

  return { plaintext, key: publicView(row) };
}

export function listApiKeys(userId: string): ApiKeyPublic[] {
  return (listByUser.all(userId) as ApiKeyPublic[]).map(publicView);
}

export function revokeApiKey(input: { id: string; userId: string }): boolean {
  return revokeStmt.run(input.id, input.userId).changes > 0;
}

/**
 * Verify a bearer token presented on an MCP request. Returns the owning
 * userId + keyId on success, null on any failure (unknown prefix, bad
 * secret, revoked key). Constant-ish time: we always run a scrypt verify,
 * even on unknown prefix, so request timing doesn't reveal prefix
 * existence.
 */
export async function verifyApiKey(
  token: string,
): Promise<{ userId: string; keyId: string } | null> {
  // Token shape: wsk_live_<prefix12>.<secret40>. Split on the dot — b64url
  // can contain `_` but never `.`, so there's exactly one separator in a
  // well-formed token.
  if (!token || !token.startsWith(BRAND) || token[PREFIX_LEN] !== SEP) {
    await runDummyVerify();
    return null;
  }
  const keyPrefix = token.slice(0, PREFIX_LEN);
  const secret = token.slice(PREFIX_LEN + 1);
  if (!secret) {
    await runDummyVerify();
    return null;
  }

  const row = selectByPrefix.get(keyPrefix) as Row | undefined;
  if (!row || row.revokedAt) {
    await runDummyVerify();
    return null;
  }
  const ok = await verifyPassword(secret, row.keyHash);
  if (!ok) return null;

  // Fire-and-forget last-used bump — never block the request on this.
  setImmediate(() => {
    try {
      touchStmt.run(row.id);
    } catch {
      // ignore — best-effort
    }
  });

  return { userId: row.userId, keyId: row.id };
}

const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function runDummyVerify(): Promise<void> {
  await verifyPassword('dummy', DUMMY_HASH);
}

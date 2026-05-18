import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  verifyApiKey,
} from './apiKeys.js';

const TEST_USER_ID = `system:apikey-spec-${randomUUID().slice(0, 8)}`;

beforeAll(() => {
  db.prepare(
    `insert into users (id, email, passwordHash) values (?, ?, ?)`,
  ).run(
    TEST_USER_ID,
    `${TEST_USER_ID}@local`,
    'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA',
  );
});

afterAll(() => {
  db.prepare(`delete from users where id = ?`).run(TEST_USER_ID);
});

describe('api keys', () => {
  it('mints a key with the expected shape and verifies it', async () => {
    const { plaintext, key } = await createApiKey({
      userId: TEST_USER_ID,
      name: 'spec key 1',
    });

    expect(plaintext).toMatch(/^wsk_live_[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{30}$/);
    expect(plaintext.length).toBe(51);
    expect(key.keyPrefix.length).toBe(20);
    expect(plaintext.startsWith(key.keyPrefix + '.')).toBe(true);

    const verified = await verifyApiKey(plaintext);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(TEST_USER_ID);
    expect(verified?.keyId).toBe(key.id);
  });

  it('rejects a tampered secret', async () => {
    const { plaintext } = await createApiKey({
      userId: TEST_USER_ID,
      name: 'spec key 2',
    });
    const tampered = plaintext.slice(0, -1) + (plaintext.endsWith('x') ? 'y' : 'x');
    const verified = await verifyApiKey(tampered);
    expect(verified).toBeNull();
  });

  it('rejects an unknown prefix', async () => {
    const verified = await verifyApiKey(
      'wsk_live_aaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
    expect(verified).toBeNull();
  });

  it('rejects malformed tokens (missing brand, wrong separator)', async () => {
    expect(await verifyApiKey('totally not a key')).toBeNull();
    expect(await verifyApiKey('wsk_test_abc_def')).toBeNull(); // wrong brand
    expect(await verifyApiKey('wsk_live_abcdefghijk_secret')).toBeNull(); // underscore separator
    expect(await verifyApiKey('')).toBeNull();
  });

  it('returns null after the key is revoked', async () => {
    const { plaintext, key } = await createApiKey({
      userId: TEST_USER_ID,
      name: 'spec key 3',
    });
    expect((await verifyApiKey(plaintext))?.keyId).toBe(key.id);

    const revoked = revokeApiKey({ id: key.id, userId: TEST_USER_ID });
    expect(revoked).toBe(true);

    const after = await verifyApiKey(plaintext);
    expect(after).toBeNull();

    // Revoking the same key twice is a no-op (changes === 0).
    const revokedTwice = revokeApiKey({ id: key.id, userId: TEST_USER_ID });
    expect(revokedTwice).toBe(false);
  });

  it('only lists keys for the owning user', async () => {
    const { key: own } = await createApiKey({
      userId: TEST_USER_ID,
      name: 'spec own',
    });

    const otherUser = `system:apikey-spec-other-${randomUUID().slice(0, 8)}`;
    try {
      db.prepare(`insert into users (id, email, passwordHash) values (?, ?, ?)`).run(
        otherUser,
        `${otherUser}@local`,
        'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA',
      );
      await createApiKey({ userId: otherUser, name: 'spec other' });

      const mine = listApiKeys(TEST_USER_ID);
      const theirs = listApiKeys(otherUser);
      expect(mine.some((k) => k.id === own.id)).toBe(true);
      expect(theirs.some((k) => k.id === own.id)).toBe(false);
    } finally {
      db.prepare(`delete from users where id = ?`).run(otherUser);
    }
  });

  it('rejects empty names', async () => {
    await expect(
      createApiKey({ userId: TEST_USER_ID, name: '   ' }),
    ).rejects.toThrow();
  });
});

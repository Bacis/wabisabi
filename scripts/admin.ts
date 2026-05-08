// Admin CLI for managing dashboard users.
//
// Subcommands:
//   create-user <email> [--admin]
//   list-users
//   reset-password <email>
//   claim-orphans <email>
//
// Run via:
//   npm run admin:create -- you@x.com --admin
//   npm run admin:list
//   npm run admin:reset -- you@x.com
//   npm run admin:claim -- you@x.com
import '../src/env.js';

import { createInterface } from 'node:readline/promises';
import { db } from '../src/db.js';
import {
  createUser,
  findUserByEmail,
  listUsers,
  setPassword,
} from '../src/auth/users.js';

async function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // In a pipeline (tests, CI), read one line normally.
    const rl = createInterface({ input: stdin, terminal: false });
    const line = (await rl[Symbol.asyncIterator]().next()).value as string | undefined;
    rl.close();
    process.stdout.write('\n');
    return line ?? '';
  }
  return new Promise<string>((resolve) => {
    let buf = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\n' || ch === '\r' || ch === '') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '') {
          // Ctrl-C
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '' || ch === '\b') {
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPasswordTwice(): Promise<string> {
  while (true) {
    const a = await promptHidden('Password: ');
    if (a.length < 8) {
      console.error('  → must be at least 8 characters');
      continue;
    }
    const b = await promptHidden('Confirm: ');
    if (a !== b) {
      console.error('  → passwords did not match, try again');
      continue;
    }
    return a;
  }
}

async function cmdCreateUser(args: string[]): Promise<void> {
  const email = args[0];
  if (!email) {
    console.error('usage: admin create-user <email> [--admin]');
    process.exit(2);
  }
  const role = args.includes('--admin') ? 'admin' : 'user';
  if (findUserByEmail(email)) {
    console.error(`user ${email} already exists`);
    process.exit(1);
  }
  const password = await readPasswordTwice();
  const user = await createUser({ email, password, role });
  console.log(`created ${role} ${user.email}  (id=${user.id})`);
}

async function cmdListUsers(): Promise<void> {
  const users = listUsers();
  if (users.length === 0) {
    console.log('(no users)');
    return;
  }
  for (const u of users) {
    console.log(`${u.role.padEnd(5)}  ${u.email.padEnd(40)}  ${u.createdAt}  ${u.id}`);
  }
}

async function cmdResetPassword(args: string[]): Promise<void> {
  const email = args[0];
  if (!email) {
    console.error('usage: admin reset-password <email>');
    process.exit(2);
  }
  const row = findUserByEmail(email);
  if (!row) {
    console.error(`no such user: ${email}`);
    process.exit(1);
  }
  const password = await readPasswordTwice();
  await setPassword(row.id, password);
  console.log(`password reset for ${row.email}`);
}

async function cmdClaimOrphans(args: string[]): Promise<void> {
  const email = args[0];
  if (!email) {
    console.error('usage: admin claim-orphans <email>');
    process.exit(2);
  }
  const row = findUserByEmail(email);
  if (!row) {
    console.error(`no such user: ${email}`);
    process.exit(1);
  }
  const claimJobs = db.prepare(`update jobs set userId = ? where userId is null`);
  const claimPresets = db.prepare(
    `update custom_presets set userId = ? where userId is null`,
  );
  const j = claimJobs.run(row.id).changes;
  const p = claimPresets.run(row.id).changes;
  console.log(`claimed ${j} job(s) and ${p} preset(s) for ${row.email}`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  switch (subcommand) {
    case 'create-user':
      await cmdCreateUser(rest);
      break;
    case 'list-users':
      await cmdListUsers();
      break;
    case 'reset-password':
      await cmdResetPassword(rest);
      break;
    case 'claim-orphans':
      await cmdClaimOrphans(rest);
      break;
    default:
      console.error(
        'usage: admin <create-user|list-users|reset-password|claim-orphans> [...]',
      );
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

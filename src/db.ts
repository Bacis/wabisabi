import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dbPath = resolve(process.env.SQLITE_PATH ?? './storage/captions.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Auto-apply schema. CREATE TABLE / INDEX IF NOT EXISTS makes this idempotent
// — every process start ensures the database matches the checked-in schema.
const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../db/schema.sql');
db.exec(readFileSync(schemaPath, 'utf8'));

// Idempotent column additions for databases created before a column existed.
// CREATE TABLE IF NOT EXISTS doesn't add new columns to existing tables, so
// we have to ALTER explicitly. Each migration is a one-line ADD COLUMN that's
// only run if the column is missing.
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

ensureColumn('jobs', 'captionPlan', 'TEXT');
ensureColumn('jobs', 'faces', 'TEXT');
ensureColumn('jobs', 'progress', 'TEXT');
// Editor opt-in retention: when set (datetime string), the per-job cleanup
// in pipeline.ts and the sweeper in worker/index.ts both skip deleting the
// input file until this deadline passes. Lets the new web editor reuse
// uploaded videos for live preview without fighting the default
// delete-on-render-complete policy.
ensureColumn('jobs', 'keepInputUntil', 'TEXT');

// Hidden render jobs: the editor's "Export render" button submits a fresh
// render with the user's edited styleSpec on top of an existing job's
// input. That render is a derivative of the job already in the editor —
// the user shouldn't see it as a separate row in the sidebar / history.
// 0 = normal job (default), 1 = export-only, hidden from listJobs.
ensureColumn('jobs', 'hidden', 'INTEGER DEFAULT 0');

// Auth ownership columns. Older rows were created before user accounts
// existed; they stay NULL and the admin runs `npm run admin:claim
// <email>` to assign them to a user post-migration.
ensureColumn('jobs', 'userId', 'TEXT REFERENCES users(id)');
ensureColumn('custom_presets', 'userId', 'TEXT REFERENCES users(id)');

db.exec(`create index if not exists jobs_userId_idx on jobs(userId)`);
db.exec(`create index if not exists custom_presets_userId_idx on custom_presets(userId)`);

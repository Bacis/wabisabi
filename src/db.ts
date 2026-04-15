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

// Producer columns added after the initial productions schema landed.
// ensureColumn is a no-op if the column already exists.
ensureColumn('productions', 'prompt', 'TEXT');
ensureColumn('productions', 'presetId', 'TEXT');
ensureColumn('productions', 'userId', 'TEXT');
ensureColumn('productions', 'username', 'TEXT');
ensureColumn('productions', 'hookFile', 'TEXT');

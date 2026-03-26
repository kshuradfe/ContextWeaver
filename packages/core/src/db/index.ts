import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env.CW_DB_PATH ?? join(process.cwd(), 'context-weaver.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  // Load schema
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  _db.exec(schema);

  // Initialize sqlite-vss
  const vss = require('sqlite-vss'); // eslint-disable-line @typescript-eslint/no-require-imports
  vss.init(_db);

  console.log(`[DB] Initialized at ${dbPath}`);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// Periodic cleanup of old context_stream entries (30-day TTL)
export function startContextStreamCleanup(db: Database.Database): NodeJS.Timeout {
  return setInterval(() => {
    try {
      const result = db.prepare(
        "DELETE FROM context_stream WHERE occurred_at < datetime('now', '-30 days')"
      ).run();
      if (result.changes > 0) {
        console.log(`[DB] Cleaned up ${result.changes} expired context_stream entries`);
      }
    } catch (err) {
      console.error('[DB] Cleanup error:', err);
    }
  }, 24 * 60 * 60 * 1000); // Run daily
}

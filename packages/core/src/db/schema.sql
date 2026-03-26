-- ContextWeaver SQLite Schema
-- Phase 1 MVP

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,          -- 'manual' | 'web' | 'file' | 'git'
  source_url TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,   -- SHA-256 for deduplication
  summary TEXT,                        -- LLM-generated, nullable on failure
  tags TEXT,                           -- JSON array string
  importance_score REAL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cards_source_type_created
  ON cards(source_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cards_content_hash
  ON cards(content_hash);

CREATE TABLE IF NOT EXISTS card_vectors (
  card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,             -- 1024-dim float32 vector from Jina
  dimension INTEGER NOT NULL DEFAULT 1024,
  model TEXT NOT NULL DEFAULT 'jina-embed-text-v3'
);

CREATE TABLE IF NOT EXISTS card_relations (
  from_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  to_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,         -- 'related' | 'derived' | 'cites'
  weight REAL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_card_id, to_card_id)
);

CREATE INDEX IF NOT EXISTS idx_relations_from
  ON card_relations(from_card_id);
CREATE INDEX IF NOT EXISTS idx_relations_to
  ON card_relations(to_card_id);

CREATE TABLE IF NOT EXISTS context_stream (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_type TEXT NOT NULL,           -- 'vscode' | 'chrome' | 'cli'
  client_id TEXT NOT NULL,
  event_type TEXT NOT NULL,            -- file_created | file_changed | git_commit | tab_created | url_visited | search_query | manual_capture
  payload TEXT NOT NULL,               -- JSON
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stream_client_occurred
  ON context_stream(client_id, occurred_at DESC);

-- TTL cleanup: DELETE FROM context_stream WHERE occurred_at < datetime('now', '-30 days')
-- Run this via a scheduled job or on each query

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | done
  linked_card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ws_sessions (
  id TEXT PRIMARY KEY,
  client_type TEXT NOT NULL,           -- 'vscode' | 'chrome'
  client_id TEXT NOT NULL,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_client
  ON ws_sessions(client_type, client_id);

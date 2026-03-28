# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0.1] - 2026-03-26

### Added
- Test fix: removed unused better-sqlite3 import from card.test.ts (native module not needed for hash-only tests)

## [0.1.0.0] - 2026-03-26

### Added
- Initial ContextWeaver MVP implementation
- Context Daemon (Node.js + TypeScript)
- SQLite schema (6 tables: cards, card_vectors, card_relations, context_stream, tasks, ws_sessions)
- MCP Server with 5 tools: search_knowledge, save_card, get_context, get_related_tasks, get_recent_context
- REST API (GET/POST /cards, GET /search, GET /context/recent)
- WebSocket server (127.0.0.1:7070 with fallback to 7071/7072)
- CLI tool (cw save, cw search, cw list, cw delete)
- Vector search via Jina AI (jina-embed-text-v3, 1024 dim)
- LLM summarization via MiniMax M2.7 (Anthropic SDK)
- context_stream TTL cleanup (30-day retention)
- Atomic importance_score increment (no race conditions)
- try/catch error handling with typed error codes

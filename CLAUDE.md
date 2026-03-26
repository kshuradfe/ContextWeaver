# ContextWeaver — Project Context

## What is this project?

ContextWeaver is a local-first personal knowledge operating system powered by AI. It captures your work context (files, web pages, git commits), organizes it into a searchable knowledge graph, and exposes everything via MCP (Model Context Protocol) so AI coding assistants can reason about YOUR context.

## Architecture

```
Context Daemon (Node.js + TypeScript)
├── REST API — CLI tool access (cw save, cw search, cw list)
├── WebSocket Server — VS Code + Chrome extension clients
├── MCP Server — Claude Desktop integration
└── SQLite + sqlite-vss — local vector search
```

## Key Files

| Path | Purpose |
|------|---------|
| `packages/core/src/index.ts` | Daemon entry — starts WS + MCP servers |
| `packages/core/src/db/schema.sql` | SQLite schema (6 tables) |
| `packages/core/src/models/card.ts` | Card CRUD + vector search |
| `packages/core/src/mcp/index.ts` | MCP server (5 tools) |
| `packages/core/src/routes/rest.ts` | REST API server |
| `packages/cli/src/index.ts` | CLI: cw save/search/list/delete |

## Tech Stack

- **Runtime:** Node.js 20+ (ESM)
- **Language:** TypeScript 5
- **Database:** SQLite + sqlite-vss (vector search)
- **LLM:** MiniMax M2.7 via Anthropic SDK
- **Embeddings:** Jina AI (jina-embed-text-v3, 1024 dim)
- **MCP:** @modelcontextprotocol/sdk
- **Package Manager:** pnpm (monorepo)

## Testing

Run tests with `pnpm test` (vitest).

## Environment Variables

See `.env.example`. Required:
- `MINIMAX_API_KEY` — MiniMax API key
- `JINA_API_KEY` — Jina AI API key for embeddings

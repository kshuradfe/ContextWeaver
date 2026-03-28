# ContextWeaver

**AI Context-Aware Personal Knowledge Operating System**

ContextWeaver is a local-first, MCP-powered personal knowledge OS that gives any AI Agent (Claude Desktop, Cursor, Cline) access to your personal context graph.

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys:
#   MINIMAX_API_KEY=your_key
#   JINA_API_KEY=your_key

# Start the Context Daemon
cd packages/core && pnpm dev

# In Claude Desktop, add to claude_desktop_config.json:
# {
#   "mcpServers": {
#     "context-weaver": {
#       "command": "node",
#       "args": ["/ABSOLUTE/PATH/to/packages/core/dist/index.js"]
#     }
#   }
# }
# Note: Run `pnpm build` in packages/core first to generate dist/index.js
```

## Architecture

```
Context Daemon (Node.js)
├── REST API (127.0.0.1:7070) — CLI tool
├── WebSocket Server (127.0.0.1:7070) — VS Code + Chrome extensions
├── MCP Server (@modelcontextprotocol/sdk) — Claude Desktop
└── SQLite (cards, card_vectors, card_relations, context_stream, tasks, ws_sessions)
```

## Packages

| Package | Description |
|---------|-------------|
| `packages/core` | Context Daemon — DB, MCP server, WebSocket, REST |
| `packages/cli` | CLI tool — `cw save`, `cw search`, `cw list`, `cw delete` |

## MCP Tools

| Tool | Description |
|------|-------------|
| `search_knowledge` | Semantic search your knowledge base |
| `save_card` | Save knowledge with auto-summary |
| `get_context` | Get context for a file/URL |
| `get_related_tasks` | Get tasks linked to a card |
| `get_recent_context` | Get recent context stream |

## Development

```bash
# Install
pnpm install

# Type check
pnpm typecheck

# Run tests
pnpm test

# Build
pnpm build
```

## License

MIT

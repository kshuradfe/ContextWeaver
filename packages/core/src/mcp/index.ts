import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { CardModel, CardCreateInput } from '../models/card.js';
import { VectorService } from '../services/vector-search.js';
import { LLMService } from '../services/llm.js';
import { randomUUID } from 'crypto';

const server = new Server(
  {
    name: 'context-weaver-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions (matching the 5 Phase 1-2 MCP tools)
const TOOLS = [
  {
    name: 'search_knowledge',
    description: 'Search your personal knowledge base semantically',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        top_k: { type: 'number', description: 'Max results to return (default 10, max 100)', minimum: 1, maximum: 100 },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_card',
    description: 'Save a piece of knowledge to your personal knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The knowledge content to save' },
        source: { type: 'string', description: 'Source type: manual, web, file, git' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
      },
      required: ['content', 'source'],
    },
  },
  {
    name: 'get_context',
    description: 'Get knowledge cards related to a file path or URL',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'File path to get context for' },
        url: { type: 'string', description: 'URL to get context for' },
      },
    },
  },
  {
    name: 'get_related_tasks',
    description: 'Get tasks linked to a knowledge card',
    inputSchema: {
      type: 'object',
      properties: {
        card_id: { type: 'string', description: 'Card ID' },
      },
      required: ['card_id'],
    },
  },
  {
    name: 'get_recent_context',
    description: 'Get recent context stream events',
    inputSchema: {
      type: 'object',
      properties: {
        minutes: { type: 'number', description: 'Past N minutes (default 60)', minimum: 1, maximum: 10080 },
      },
    },
  },
];

/**
 * Wrap top-level MCP handler in try/catch to prevent malformed JSON crashes
 */
export function wrapMCPHandler<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    console.error('[MCP] Unhandled error in MCP handler:', err);
    throw err;
  }
}

export async function startMCPServer(): Promise<void> {
  // List tools
  server.setRequestHandler(ListToolsRequestSchema, () => {
    return wrapMCPHandler(() => ({ tools: TOOLS }));
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return wrapMCPHandler(async () => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_knowledge': {
            const { query, top_k = 10 } = args as { query: string; top_k?: number };
            if (!query?.trim()) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'Query cannot be empty' } }) }] };
            }
            if (top_k < 1 || top_k > 100) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'top_k must be 1-100' } }) }] };
            }

            // Generate query embedding
            const queryEmbedding = await VectorService.embed(query);
            const results = CardModel.search(query, top_k, queryEmbedding);

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  results: results.map(r => ({
                    id: r.id,
                    sourceType: r.sourceType,
                    sourceUrl: r.sourceUrl,
                    content: r.content.slice(0, 500),
                    summary: r.summary,
                    tags: r.tags,
                    similarity: r.similarity,
                  })),
                  total: results.length,
                }),
              }],
            };
          }

          case 'save_card': {
            const { content, source, tags } = args as { content: string; source: string; tags?: string[] };
            if (!content?.trim()) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'Content cannot be empty' } }) }] };
            }

            // Generate embedding and summary in parallel
            const [embedding, summary] = await Promise.all([
              VectorService.embed(content).catch(() => null),
              LLMService.summarize(content).catch(() => null),
            ]);

            const input: CardCreateInput = {
              content,
              source: source ?? 'manual',
              tags,
              summary,
            };

            let card;
            try {
              const result = CardModel.create(input);
              card = result.card;
              if (embedding && result.isNew) {
                CardModel.saveVector(card.id, embedding);
              }
            } catch (err: unknown) {
              const errorObj = err as { code?: string; message?: string };
              if (errorObj.code === 'DB_ERROR') {
                return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'DB_ERROR', message: errorObj.message } }) }] };
              }
              throw err;
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  id: card.id,
                  summary: card.summary,
                  isNew: true,
                }),
              }],
            };
          }

          case 'get_context': {
            const { file_path, url } = args as { file_path?: string; url?: string };
            const lookupKey = file_path ?? url ?? '';

            if (!lookupKey) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'file_path or url required' } }) }] };
            }

            const card = CardModel.getById(lookupKey) ?? CardModel.getByIds([lookupKey])[0] ?? null;
            if (!card) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'CARD_NOT_FOUND', message: 'No card found for this path/URL' } }) }] };
            }

            // Increment importance on access
            CardModel.incrementImportance(card.id);

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ cards: [card] }),
              }],
            };
          }

          case 'get_related_tasks': {
            const { card_id } = args as { card_id: string };
            const db = (await import('../db/index.js')).getDb();
            const tasks = db.prepare('SELECT * FROM tasks WHERE linked_card_id = ?').all(card_id);
            return { content: [{ type: 'text', text: JSON.stringify({ tasks }) }] };
          }

          case 'get_recent_context': {
            const { minutes = 60 } = args as { minutes?: number };
            const db = (await import('../db/index.js')).getDb();
            const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
            const events = db.prepare(`
              SELECT * FROM context_stream
              WHERE occurred_at > ?
              ORDER BY occurred_at DESC
              LIMIT 100
            `).all(since);
            return { content: [{ type: 'text', text: JSON.stringify({ events }) }] };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'INVALID_INPUT', message: `Unknown tool: ${name}` } }) }] };
        }
      } catch (err) {
        console.error(`[MCP] Tool ${name} failed:`, err);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } }),
          }],
        };
      }
    });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('[MCP] Server connected via stdio');
}

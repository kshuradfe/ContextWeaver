/**
 * REST API routes for ContextWeaver Daemon
 * Serves on 127.0.0.1:7070 alongside WebSocket
 */

import http from 'http';
import { URL } from 'url';
import { CardModel, CardCreateInput } from '../models/card.js';
import { VectorService } from '../services/vector-search.js';
import { LLMService } from '../services/llm.js';

function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function errorResponse(res: http.ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}

export function startRESTServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // CORS — local only
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // GET /cards — list cards
      if (method === 'GET' && pathname === '/cards') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100);
        const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
        const sourceType = url.searchParams.get('source_type');

        let query = 'SELECT * FROM cards';
        const params: unknown[] = [];
        if (sourceType) {
          query += ' WHERE source_type = ?';
          params.push(sourceType);
        }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const db = (await import('../db/index.js')).getDb();
        const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
        const cards = rows.map(row => {
          let tags: string[] = [];
          try { tags = JSON.parse(row['tags'] as string); } catch { tags = []; }
          return {
            id: row['id'],
            sourceType: row['source_type'],
            sourceUrl: row['source_url'],
            content: row['content'],
            summary: row['summary'],
            tags,
            importanceScore: row['importance_score'],
            createdAt: row['created_at'],
          };
        });
        return jsonResponse(res, 200, { cards, total: cards.length });
      }

      // GET /cards/:id — get single card
      if (method === 'GET' && pathname.startsWith('/cards/')) {
        const id = pathname.slice('/cards/'.length);
        const card = CardModel.getById(id);
        if (!card) return errorResponse(res, 404, 'CARD_NOT_FOUND', `Card ${id} not found`);
        return jsonResponse(res, 200, { card });
      }

      // POST /cards — create card
      if (method === 'POST' && pathname === '/cards') {
        let body = '';
        for await (const chunk of req) { body += chunk; }
        const input = JSON.parse(body) as { content?: string; source?: string; sourceUrl?: string; tags?: string[] };

        if (!input.content?.trim()) {
          return errorResponse(res, 400, 'INVALID_INPUT', 'content is required');
        }

        const [embedding, summary] = await Promise.all([
          VectorService.embed(input.content).catch(() => null),
          LLMService.summarize(input.content).catch(() => null),
        ]);

        const cardInput: CardCreateInput = {
          content: input.content,
          source: input.source ?? 'manual',
          sourceUrl: input.sourceUrl,
          tags: input.tags,
          summary,
        };

        let card;
        try {
          const result = CardModel.create(cardInput);
          card = result.card;
          if (embedding && result.isNew) {
            CardModel.saveVector(card.id, embedding);
          }
        } catch (err: unknown) {
          const e = err as { code?: string; message?: string };
          if (e.code === 'DB_ERROR') return errorResponse(res, 500, 'DB_ERROR', e.message ?? 'Database error');
          throw err;
        }

        return jsonResponse(res, 201, { id: card.id, summary: card.summary });
      }

      // DELETE /cards/:id
      if (method === 'DELETE' && pathname.startsWith('/cards/')) {
        const id = pathname.slice('/cards/'.length);
        const db = (await import('../db/index.js')).getDb();
        const result = db.prepare('DELETE FROM cards WHERE id = ?').run(id);
        if (result.changes === 0) return errorResponse(res, 404, 'CARD_NOT_FOUND', `Card ${id} not found`);
        return jsonResponse(res, 200, { ok: true });
      }

      // GET /search
      if (method === 'GET' && pathname === '/search') {
        const q = url.searchParams.get('q') ?? '';
        const topK = Math.min(parseInt(url.searchParams.get('top_k') ?? '10', 10), 100);
        if (!q.trim()) return errorResponse(res, 400, 'INVALID_INPUT', 'q parameter required');

        const embedding = await VectorService.embed(q);
        const results = CardModel.search(q, topK, embedding);
        return jsonResponse(res, 200, { results, total: results.length });
      }

      // GET /context/recent
      if (method === 'GET' && pathname === '/context/recent') {
        const minutes = Math.min(parseInt(url.searchParams.get('minutes') ?? '60', 10), 10080);
        const db = (await import('../db/index.js')).getDb();
        const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
        const events = db.prepare(`
          SELECT * FROM context_stream
          WHERE occurred_at > ?
          ORDER BY occurred_at DESC LIMIT 100
        `).all(since);
        return jsonResponse(res, 200, { events });
      }

      // 404
      return errorResponse(res, 404, 'NOT_FOUND', `Route ${method} ${pathname} not found`);
    } catch (err) {
      console.error(`[REST] ${method} ${pathname} error:`, err);
      return errorResponse(res, 500, 'INTERNAL_ERROR', (err as Error).message);
    }
  });

  const port = parseInt(process.env.CW_REST_PORT ?? '7070', 10);
  server.listen(port, '127.0.0.1', () => {
    console.log(`[REST] API server listening on http://127.0.0.1:${port}`);
  });

  return server;
}

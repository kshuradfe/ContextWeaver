import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';

export interface Card {
  id: string;
  sourceType: 'manual' | 'web' | 'file' | 'git';
  sourceUrl: string | null;
  content: string;
  contentHash: string;
  summary: string | null;
  tags: string[];
  importanceScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface CardCreateInput {
  content: string;
  source: string;
  sourceUrl?: string;
  tags?: string[];
  summary?: string | null; // null = LLM failed, card still saved
}

export interface CardSearchResult {
  id: string;
  sourceType: string;
  sourceUrl: string | null;
  content: string;
  summary: string | null;
  tags: string[];
  importanceScore: number;
  createdAt: string;
  similarity?: number;
}

export class CardModel {
  /**
   * Compute SHA-256 hash of content for deduplication
   */
  static hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Create a new card. If content hash already exists, returns the existing card.
   * LLM summary failure is non-blocking — card is saved with summary=null.
   */
  static create(input: CardCreateInput): { card: Card; isNew: boolean } {
    const db = getDb();
    const contentHash = this.hashContent(input.content);

    // Check for duplicate
    const existing = db.prepare(
      'SELECT * FROM cards WHERE content_hash = ?'
    ).get(contentHash) as Record<string, unknown> | undefined;

    if (existing) {
      return { card: this.rowToCard(existing), isNew: false };
    }

    const id = randomUUID();
    const tags = JSON.stringify(input.tags ?? []);
    const now = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO cards (id, source_type, source_url, content, content_hash, summary, tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.source,
        input.sourceUrl ?? null,
        input.content,
        contentHash,
        input.summary ?? null,
        tags,
        now,
        now
      );
    } catch (err: unknown) {
      // DB_ERROR — wrap with explicit error code
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        const existing = db.prepare('SELECT * FROM cards WHERE content_hash = ?').get(contentHash) as Record<string, unknown>;
        return { card: this.rowToCard(existing), isNew: false };
      }
      throw { code: 'DB_ERROR', message: (err as Error).message, cause: err };
    }

    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Record<string, unknown>;
    return { card: this.rowToCard(card), isNew: true };
  }

  /**
   * Search cards by semantic similarity using sqlite-vss
   */
  static search(query: string, topK: number = 10, embedding: Float32Array): CardSearchResult[] {
    const db = getDb();

    // Clamp topK
    topK = Math.min(Math.max(1, topK), 100);

    const results = db.prepare(`
      SELECT
        c.*,
        vss_search(c.id, ?, ?) as similarity
      FROM cards c
      JOIN card_vectors cv ON c.id = cv.card_id
      WHERE vss_search(c.id, ?, ?) IS NOT NULL
      ORDER BY similarity DESC
      LIMIT ?
    `).all(
      embedding,
      0.3, // similarity threshold
      embedding,
      0.3
    ) as Record<string, unknown>[];

    return results.map(row => this.rowToCardSearchResult(row));
  }

  /**
   * Get a card by ID
   */
  static getById(id: string): Card | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToCard(row) : null;
  }

  /**
   * Get cards by IDs (used by get_context)
   */
  static getByIds(ids: string[]): Card[] {
    if (ids.length === 0) return [];
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT * FROM cards WHERE id IN (${placeholders})`
    ).all(...ids) as Record<string, unknown>[];
    return rows.map(row => this.rowToCard(row));
  }

  /**
   * Atomically increment importance_score using SQL — no read-modify-write race condition
   */
  static incrementImportance(cardId: string): void {
    const db = getDb();
    db.prepare(`
      UPDATE cards
      SET importance_score = MIN(1.0, importance_score + 0.05),
          updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), cardId);
  }

  /**
   * Get recent cards by client
   */
  static getRecentByClient(clientId: string, minutes: number, limit: number = 50): Card[] {
    const db = getDb();
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT c.* FROM cards c
      JOIN context_stream cs ON c.source_url = cs.payload
      WHERE cs.client_id = ? AND cs.occurred_at > ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(clientId, since, limit) as Record<string, unknown>[];
    return rows.map(row => this.rowToCard(row));
  }

  /**
   * Save vector for a card
   */
  static saveVector(cardId: string, embedding: Float32Array): void {
    const db = getDb();
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    db.prepare(`
      INSERT OR REPLACE INTO card_vectors (card_id, embedding, dimension)
      VALUES (?, ?, ?)
    `).run(cardId, buffer, embedding.length);
  }

  private static rowToCard(row: Record<string, unknown>): Card {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row['tags'] as string);
    } catch {
      tags = [];
    }
    return {
      id: row['id'] as string,
      sourceType: row['source_type'] as Card['sourceType'],
      sourceUrl: row['source_url'] as string | null,
      content: row['content'] as string,
      contentHash: row['content_hash'] as string,
      summary: row['summary'] as string | null,
      tags,
      importanceScore: row['importance_score'] as number,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  private static rowToCardSearchResult(row: Record<string, unknown>): CardSearchResult {
    let tags: string[] = [];
    try {
      tags = JSON.parse(row['tags'] as string);
    } catch {
      tags = [];
    }
    return {
      id: row['id'] as string,
      sourceType: row['source_type'] as string,
      sourceUrl: row['source_url'] as string | null,
      content: row['content'] as string,
      summary: row['summary'] as string | null,
      tags,
      importanceScore: row['importance_score'] as number,
      createdAt: row['created_at'] as string,
      similarity: row['similarity'] as number | undefined,
    };
  }
}

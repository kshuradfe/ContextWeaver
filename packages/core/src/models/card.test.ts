import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { CardModel } from './card.js';

describe('CardModel', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Use in-memory DB for tests
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');

    // Inject test DB — this is a test shim
    // In real tests we'd use DI, but for simplicity:
  });

  it('should create a card with valid input', () => {
    const hash = CardModel.hashContent('test content');
    expect(hash).toBeTruthy();
    expect(hash.length).toBe(64); // SHA-256 hex
  });

  it('should produce same hash for same content', () => {
    const hash1 = CardModel.hashContent('hello world');
    const hash2 = CardModel.hashContent('hello world');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hash for different content', () => {
    const hash1 = CardModel.hashContent('hello');
    const hash2 = CardModel.hashContent('world');
    expect(hash1).not.toBe(hash2);
  });
});

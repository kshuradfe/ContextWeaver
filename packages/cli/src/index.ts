#!/usr/bin/env node

/**
 * ContextWeaver CLI
 * Commands: cw save <content> [--source] [--tags]
 *           cw search <query> [--top-k]
 *           cw list [--limit]
 *           cw delete <id>
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';

const API_BASE = process.env.CW_API_BASE ?? 'http://127.0.0.1:7070';

const program = new Command();

program
  .name('cw')
  .description('ContextWeaver CLI — interact with your local knowledge base')
  .version('0.1.0');

program
  .command('save')
  .description('Save a knowledge card')
  .argument('<content>', 'Content to save')
  .option('-s, --source <type>', 'Source type (manual, web, file, git)', 'manual')
  .option('-t, --tags <tags...>', 'Tags for this card')
  .action(async (content, options) => {
    const res = await fetch(`${API_BASE}/cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, source: options.source, tags: options.tags ?? [] }),
    });
    const data = await res.json() as { id?: string; summary?: string; error?: string };
    if (data.error) {
      console.error(`Error: ${JSON.stringify(data.error)}`);
      process.exit(1);
    }
    console.log(`Saved card ${data.id}`);
    if (data.summary) console.log(`Summary: ${data.summary}`);
  });

program
  .command('search')
  .description('Search knowledge cards')
  .argument('<query>', 'Search query')
  .option('-k, --top-k <number>', 'Max results', '10')
  .action(async (query, options) => {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}&top_k=${options.topK}`);
    const data = await res.json() as { results?: unknown[]; error?: string };
    if (data.error) {
      console.error(`Error: ${JSON.stringify(data.error)}`);
      process.exit(1);
    }
    const results = data.results ?? [];
    console.log(`Found ${results.length} results:\n`);
    for (const r of results as { id: string; content: string; summary: string | null; tags: string[] }[]) {
      console.log(`[${r.id}]`);
      console.log(`  ${r.content.slice(0, 200)}${r.content.length > 200 ? '...' : ''}`);
      if (r.summary) console.log(`  → ${r.summary}`);
      if (r.tags?.length) console.log(`  Tags: ${r.tags.join(', ')}`);
      console.log();
    }
  });

program
  .command('list')
  .description('List recent cards')
  .option('-l, --limit <number>', 'Max results', '20')
  .action(async (options) => {
    const res = await fetch(`${API_BASE}/cards?limit=${options.limit}`);
    const data = await res.json() as { cards?: unknown[]; error?: string };
    if (data.error) {
      console.error(`Error: ${JSON.stringify(data.error)}`);
      process.exit(1);
    }
    const cards = data.cards ?? [];
    console.log(`${cards.length} cards:\n`);
    for (const c of cards as { id: string; content: string; createdAt: string }[]) {
      console.log(`[${c.id}] ${c.createdAt}`);
      console.log(`  ${c.content.slice(0, 150)}${c.content.length > 150 ? '...' : ''}\n`);
    }
  });

program
  .command('delete')
  .description('Delete a card')
  .argument('<id>', 'Card ID')
  .action(async (id) => {
    const res = await fetch(`${API_BASE}/cards/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      console.error(`Error: ${JSON.stringify(data.error ?? 'Unknown error')}`);
      process.exit(1);
    }
    console.log(`Deleted card ${id}`);
  });

program.parse();

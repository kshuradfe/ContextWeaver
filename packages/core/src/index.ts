#!/usr/bin/env node

/**
 * ContextWeaver Context Daemon
 * Entry point: starts WebSocket server + MCP server
 */

import { getDb, closeDb, startContextStreamCleanup } from './db/index.js';
import { startWebSocketServer, setMessageHandler } from './services/ws-handler.js';
import { startMCPServer } from './mcp/index.js';
import { randomUUID } from 'crypto';

async function main() {
  console.log('[Daemon] ContextWeaver starting...');
  console.log(`[Daemon] Version 0.1.0.0`);

  // Initialize database
  const db = getDb();
  console.log('[Daemon] Database initialized');

  // Start WebSocket server (for VS Code / Chrome extensions)
  const wsServer = startWebSocketServer();

  // Start REST API server (for CLI tool)
  const { startRESTServer } = await import('./routes/rest.js');
  const restServer = startRESTServer();

  // Set up WebSocket message handler
  setMessageHandler(async (msg, clientId) => {
    const { type, payload } = msg;

    switch (type) {
      case 'context_event': {
        const { event_type, event_payload } = payload as { event_type: string; event_payload: unknown };
        try {
          db.prepare(`
            INSERT INTO context_stream (client_type, client_id, event_type, payload, occurred_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            'vscode', // inferred from MCP context
            clientId,
            event_type,
            JSON.stringify(event_payload),
            new Date().toISOString()
          );
        } catch (err) {
          console.error('[WS] Failed to store context event:', err);
        }
        return { ok: true };
      }

      case 'ping':
        return { pong: true, clientId };

      default:
        console.warn(`[WS] Unknown message type: ${type}`);
        return { error: `Unknown message type: ${type}` };
    }
  });

  // Start periodic context_stream cleanup
  const cleanupInterval = startContextStreamCleanup(db);

  // Start MCP server (stdio) — this blocks
  console.log('[Daemon] Starting MCP server on stdio...');
  try {
    await startMCPServer();
  } catch (err) {
    console.error('[MCP] MCP server failed to start:', err);
    process.exit(1);
  }

  // Cleanup on exit
  process.on('SIGINT', () => {
    console.log('[Daemon] Shutting down...');
    clearInterval(cleanupInterval);
    wsServer.close();
    restServer.close();
    closeDb();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[Daemon] SIGTERM received');
    clearInterval(cleanupInterval);
    wsServer.close();
    restServer.close();
    closeDb();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Daemon] Fatal error:', err);
  process.exit(1);
});

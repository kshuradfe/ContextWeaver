import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { getDb } from '../db/index.js';

interface WSMessage {
  type: string;
  payload: unknown;
  requestId?: string;
}

interface WSClient {
  ws: WebSocket;
  clientId: string;
  clientType: string;
}

const clients = new Map<string, WSClient>();

export type MessageHandler = (msg: WSMessage, clientId: string) => Promise<unknown> | unknown;

let _messageHandler: MessageHandler | null = null;

export function setMessageHandler(handler: MessageHandler): void {
  _messageHandler = handler;
}

/**
 * Start WebSocket server on available port (7070 → 7071 → 7072 → fail)
 */
export function startWebSocketServer(): WebSocketServer {
  const db = getDb();
  let port = parseInt(process.env.CW_WS_PORT ?? '7070', 10);
  const maxPort = port + 2;
  let server: WebSocketServer;

  while (port <= maxPort) {
    try {
      server = new WebSocketServer({ host: '127.0.0.1', port });
      console.log(`[WS] Server started on 127.0.0.1:${port}`);
      break;
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'EADDRINUSE') {
        console.warn(`[WS] Port ${port} in use, trying ${port + 1}...`);
        port++;
        continue;
      }
      throw err;
    }
  }

  if (!server) {
    const error = `Failed to start WebSocket server: ports 7070-7072 all in use`;
    console.error(`[WS] ${error}`);
    throw new Error(error);
  }

  server.on('connection', (ws: WebSocket, req) => {
    const clientId = randomUUID();
    const clientType = extractClientType(req);
    clients.set(clientId, { ws, clientId, clientType });

    // Track session in DB
    try {
      db.prepare(`
        INSERT OR REPLACE INTO ws_sessions (id, client_type, client_id, connected_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(clientId, clientType, clientId, new Date().toISOString(), new Date().toISOString());
    } catch (err) {
      console.error('[WS] Failed to track session:', err);
    }

    ws.on('message', async (data: Buffer) => {
      try {
        const raw = data.toString();
        let msg: WSMessage;
        try {
          msg = JSON.parse(raw);
        } catch {
          // Invalid JSON — disconnect client
          console.warn(`[WS] Invalid JSON from client ${clientId}, disconnecting`);
          ws.close();
          return;
        }

        if (!msg.type) {
          console.warn(`[WS] Missing message type from ${clientId}`);
          return;
        }

        // Route to handler
        if (_messageHandler) {
          const response = await _messageHandler(msg, clientId);
          if (msg.requestId && response !== undefined) {
            ws.send(JSON.stringify({ type: `${msg.type}:response`, requestId: msg.requestId, payload: response }));
          }
        }
      } catch (err) {
        console.error(`[WS] Error handling message from ${clientId}:`, err);
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      try {
        db.prepare('DELETE FROM ws_sessions WHERE id = ?').run(clientId);
      } catch {
        // Ignore cleanup errors
      }
    });

    ws.on('error', (err) => {
      console.error(`[WS] Client ${clientId} error:`, err);
    });
  });

  // Heartbeat to detect stale connections
  setInterval(() => {
    for (const [id, client] of clients) {
      if (!client.ws.readyState) {
        clients.delete(id);
      } else {
        try {
          db.prepare('UPDATE ws_sessions SET last_seen_at = ? WHERE id = ?')
            .run(new Date().toISOString(), id);
        } catch {
          // Ignore
        }
      }
    }
  }, 30000);

  return server;
}

function extractClientType(req: { headers?: Record<string, string> }): string {
  const ua = req.headers?.['user-agent'] ?? '';
  if (ua.includes('vscode')) return 'vscode';
  if (ua.includes('chrome')) return 'chrome';
  return 'unknown';
}

export function broadcast(type: string, payload: unknown): void {
  const msg = JSON.stringify({ type, payload });
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  }
}

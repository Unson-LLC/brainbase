import { createServer as createHttpServer } from "http";
import { WebSocketServer } from "ws";

const HEARTBEAT_INTERVAL = 30_000;

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

/**
 * Create and return a relay server instance.
 * @param {{ port?: number }} [opts]
 * @returns {{ httpServer: import('http').Server, wss: WebSocketServer, peers: Map<string, import('ws').WebSocket>, close: () => Promise<void>, listen: (port?: number) => Promise<number> }}
 */
export function createRelayServer(opts = {}) {
  /** @type {Map<string, import('ws').WebSocket>} */
  const peers = new Map();

  function broadcast(obj, excludeNodeId) {
    for (const [nodeId, ws] of peers) {
      if (nodeId !== excludeNodeId) {
        send(ws, obj);
      }
    }
  }

  const httpServer = createHttpServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", peers: peers.size }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    let authenticated = false;
    let nodeId = null;

    ws._isAlive = true;

    ws.on("pong", () => {
      ws._isAlive = true;
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        send(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      if (msg.type === "auth") {
        if (!msg.nodeId || typeof msg.nodeId !== "string") {
          send(ws, { type: "error", message: "Missing or invalid nodeId" });
          return;
        }
        if (!msg.publicKey || typeof msg.publicKey !== "string") {
          send(ws, { type: "error", message: "Missing or invalid publicKey" });
          return;
        }
        if (peers.has(msg.nodeId)) {
          send(ws, { type: "error", message: "nodeId already connected" });
          ws.close();
          return;
        }

        nodeId = msg.nodeId;
        authenticated = true;
        peers.set(nodeId, ws);

        send(ws, { type: "auth_ok", nodeId });
        broadcast({ type: "peer_joined", nodeId }, nodeId);
        log(`Peer joined: ${nodeId} (total: ${peers.size})`);
        return;
      }

      if (!authenticated) {
        send(ws, { type: "error", message: "Not authenticated. Send auth first." });
        return;
      }

      if (msg.type === "envelope") {
        if (!msg.to || typeof msg.to !== "string") {
          send(ws, { type: "error", message: "Missing 'to' field" });
          return;
        }
        if (msg.payload === undefined) {
          send(ws, { type: "error", message: "Missing 'payload' field" });
          return;
        }

        const envelope = {
          type: "envelope",
          from: nodeId,
          to: msg.to,
          payload: msg.payload,
        };

        if (msg.to === "all") {
          broadcast(envelope, nodeId);
          log(`Broadcast from ${nodeId}`);
        } else {
          const target = peers.get(msg.to);
          if (target) {
            send(target, envelope);
            log(`Relay ${nodeId} -> ${msg.to}`);
          } else {
            send(ws, {
              type: "error",
              message: `Peer not found: ${msg.to}`,
            });
          }
        }
        return;
      }

      send(ws, { type: "error", message: `Unknown message type: ${msg.type}` });
    });

    ws.on("close", () => {
      if (nodeId) {
        peers.delete(nodeId);
        broadcast({ type: "peer_left", nodeId }, null);
        log(`Peer left: ${nodeId} (total: ${peers.size})`);
      }
    });

    ws.on("error", (err) => {
      log(`WebSocket error for ${nodeId || "(unauthenticated)"}:`, err.message);
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client._isAlive) {
        log(`Heartbeat timeout, terminating connection`);
        client.terminate();
        continue;
      }
      client._isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_INTERVAL);

  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  return {
    httpServer,
    wss,
    peers,

    /**
     * Start listening on the given port (0 = random).
     * @param {number} [port=0]
     * @returns {Promise<number>} The actual port the server is listening on.
     */
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        httpServer.listen(port, () => {
          const addr = httpServer.address();
          log(`Brainbase Relay Server listening on port ${addr.port}`);
          resolve(addr.port);
        });
        httpServer.on("error", reject);
      });
    },

    /**
     * Gracefully close the relay server.
     * @returns {Promise<void>}
     */
    close() {
      return new Promise((resolve) => {
        clearInterval(heartbeat);
        // Close all peer connections
        for (const ws of peers.values()) {
          ws.close();
        }
        peers.clear();
        wss.close(() => {
          httpServer.close(() => {
            resolve();
          });
        });
      });
    },
  };
}

// ---------- Start if run directly ----------

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/relay/server.js') ||
  process.argv[1].endsWith('\\relay\\server.js')
);

if (isDirectRun) {
  const PORT = process.env.PORT || 8787;
  const server = createRelayServer();
  server.listen(Number(PORT));
}

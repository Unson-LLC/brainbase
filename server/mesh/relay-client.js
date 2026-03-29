import WebSocket from 'ws';

const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 5_000;

/**
 * WebSocket client for connecting to the mesh relay server.
 */
export class RelayClient {
  /**
   * @param {{ relayUrl: string, nodeId: string, publicKey: string }} opts
   */
  constructor({ relayUrl, nodeId, publicKey }) {
    this.relayUrl = relayUrl;
    this.nodeId = nodeId;
    this.publicKey = publicKey;

    /** @type {WebSocket | null} */
    this.ws = null;
    this._messageHandler = null;
    this._retryCount = 0;
    this._closed = false;
  }

  /**
   * Connect to the relay server and send the auth message.
   * @returns {Promise<void>}
   */
  async connect() {
    this._closed = false;
    this._retryCount = 0;

    return this._connectInternal();
  }

  /**
   * Internal connection logic, also used for reconnects.
   * @returns {Promise<void>}
   */
  _connectInternal() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.relayUrl);

      ws.on('open', () => {
        this._retryCount = 0;

        // Send auth message on connect.
        ws.send(JSON.stringify({
          type: 'auth',
          nodeId: this.nodeId,
          publicKey: this.publicKey,
        }));

        resolve();
      });

      ws.on('message', (data) => {
        if (this._messageHandler) {
          try {
            const parsed = JSON.parse(data.toString());
            this._messageHandler(parsed);
          } catch {
            // Ignore non-JSON messages.
          }
        }
      });

      ws.on('ping', () => {
        ws.pong();
      });

      ws.on('close', () => {
        this.ws = null;
        if (!this._closed) {
          this._scheduleReconnect();
        }
      });

      ws.on('error', (err) => {
        // Only reject the initial connect promise; reconnect errors are handled silently.
        if (!this.ws) {
          reject(err);
        }
      });

      this.ws = ws;
    });
  }

  /**
   * Schedule an automatic reconnect with exponential backoff.
   */
  _scheduleReconnect() {
    if (this._retryCount >= MAX_RETRIES) {
      console.error(`[RelayClient] Max reconnect retries (${MAX_RETRIES}) reached. Giving up.`);
      return;
    }

    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this._retryCount, MAX_BACKOFF_MS);
    this._retryCount++;

    console.log(`[RelayClient] Reconnecting in ${delay}ms (attempt ${this._retryCount}/${MAX_RETRIES})...`);

    setTimeout(async () => {
      try {
        await this._connectInternal();
        console.log('[RelayClient] Reconnected successfully.');
      } catch {
        // connectInternal rejection triggers the close handler which re-schedules.
      }
    }, delay);
  }

  /**
   * Send a message through the WebSocket.
   * @param {object} message
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('[RelayClient] Cannot send: WebSocket is not open.');
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Register a handler for incoming messages.
   * @param {(message: object) => void} handler
   */
  onMessage(handler) {
    this._messageHandler = handler;
  }

  /**
   * Check whether the WebSocket is currently connected.
   * @returns {boolean}
   */
  isConnected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from the relay server.
   */
  disconnect() {
    this._closed = true;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

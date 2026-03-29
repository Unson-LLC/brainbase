import { EventEmitter } from 'events';
import { RelayClient } from './relay-client.js';
import { PeerRegistry } from './peer-registry.js';
import { MessageRouter } from './message-router.js';
import { exportPublicKeys } from './crypto/key-manager.js';
import { seal, unseal } from './crypto/envelope-crypto.js';
import { createEnvelope, parseEnvelope, ENVELOPE_TYPES } from './envelope.js';

/**
 * Main MeshService for Brainbase Mesh MVP.
 * Manages relay connectivity, peer registration, and message exchange.
 */
export class MeshService extends EventEmitter {
  /**
   * @param {{ keyManager: object, relayUrl: string, nodeId: string, role: string }} opts
   *   keyManager – keypair object from key-manager (signKeyPair + boxKeyPair)
   *   relayUrl   – WebSocket URL of the relay server
   *   nodeId     – unique identifier for this node
   *   role       – node role (e.g. 'worker', 'orchestrator')
   */
  constructor({ keyManager, relayUrl, nodeId, role }) {
    super();

    this.keyManager = keyManager;
    this.relayUrl = relayUrl;
    this.nodeId = nodeId;
    this.role = role;

    this.peerRegistry = new PeerRegistry();
    this.messageRouter = new MessageRouter();

    /** @type {RelayClient | null} */
    this.relay = null;
  }

  /**
   * Start the mesh service: connect to relay and register this peer.
   */
  async start() {
    const { signPub, boxPub } = await exportPublicKeys(this.keyManager);

    this.relay = new RelayClient({
      relayUrl: this.relayUrl,
      nodeId: this.nodeId,
      publicKey: signPub,
    });

    // Wire incoming relay messages through handleIncomingEnvelope.
    this.relay.onMessage((message) => {
      this.emit('message', message);
      this.handleIncomingEnvelope(message).catch((err) => {
        console.error('[MeshService] Error handling incoming envelope:', err);
      });
    });

    await this.relay.connect();

    // Register ourselves as a peer.
    this.peerRegistry.addPeer({
      nodeId: this.nodeId,
      publicKey: signPub,
      boxPublicKey: boxPub,
      role: this.role,
      online: true,
    });

    // Announce registration to the relay.
    this.relay.send({
      type: 'register',
      nodeId: this.nodeId,
      publicKey: signPub,
      boxPublicKey: boxPub,
      role: this.role,
    });

    console.log(`[MeshService] Started. nodeId=${this.nodeId} role=${this.role}`);
  }

  /**
   * Stop the mesh service and disconnect from the relay.
   */
  async stop() {
    if (this.relay) {
      this.relay.disconnect();
      this.relay = null;
    }

    console.log('[MeshService] Stopped.');
  }

  /**
   * Send a query to another peer.
   * The payload is encrypted with the recipient's box public key before sending.
   * @param {string} to       – target nodeId
   * @param {string} question – the query text
   * @param {string} [scope]  – optional scope context
   * @returns {Promise<string>} envelope id (serves as the query id)
   */
  async sendQuery(to, question, scope) {
    if (!this.relay || !this.relay.isConnected()) {
      throw new Error('[MeshService] Not connected to relay.');
    }

    const peer = this.peerRegistry.getPeer(to);
    if (!peer || !peer.boxPublicKey) {
      throw new Error(`[MeshService] Unknown peer or missing boxPublicKey for: ${to}`);
    }

    const queryPayload = { question, scope: scope ?? null };
    const payloadStr = JSON.stringify(queryPayload);
    const encryptedPayload = await seal(payloadStr, peer.boxPublicKey);

    const envelope = createEnvelope({
      from: this.nodeId,
      to,
      type: ENVELOPE_TYPES.QUERY,
      payload: encryptedPayload,
    });

    this.relay.send({ type: 'envelope', to, payload: JSON.stringify(envelope) });

    return envelope.id;
  }

  /**
   * Send a response to a previous query.
   * The payload is encrypted with the recipient's box public key before sending.
   * @param {string} to           – target nodeId
   * @param {string} queryId      – the original query id
   * @param {object} responseData – response payload
   */
  async sendResponse(to, queryId, responseData) {
    if (!this.relay || !this.relay.isConnected()) {
      throw new Error('[MeshService] Not connected to relay.');
    }

    const peer = this.peerRegistry.getPeer(to);
    if (!peer || !peer.boxPublicKey) {
      throw new Error(`[MeshService] Unknown peer or missing boxPublicKey for: ${to}`);
    }

    const responsePayload = { queryId, data: responseData };
    const payloadStr = JSON.stringify(responsePayload);
    const encryptedPayload = await seal(payloadStr, peer.boxPublicKey);

    const envelope = createEnvelope({
      from: this.nodeId,
      to,
      type: ENVELOPE_TYPES.RESPONSE,
      payload: encryptedPayload,
    });

    this.relay.send({ type: 'envelope', to, payload: JSON.stringify(envelope) });
  }

  /**
   * Handle an incoming message from the relay.
   * If the message is an envelope, parse it, decrypt the payload, and route
   * to the message router. Non-envelope messages are passed directly to the router.
   * @param {object} message – raw message from the relay
   */
  async handleIncomingEnvelope(message) {
    if (message.type !== 'envelope') {
      // Non-envelope messages (e.g. relay control messages) pass through directly.
      await this.messageRouter.route(message);
      return;
    }

    const envelope = parseEnvelope(message.payload);

    const decryptedStr = await unseal(envelope.payload, this.keyManager.boxKeyPair);
    const decryptedPayload = JSON.parse(decryptedStr);

    // Reconstruct a routable message with envelope metadata and decrypted payload.
    const routeMessage = {
      id: envelope.id,
      from: envelope.from,
      to: envelope.to,
      type: envelope.type,
      payload: decryptedPayload,
      ts: envelope.ts,
      nonce: envelope.nonce,
    };

    await this.messageRouter.route(routeMessage);
  }

  /**
   * Get peers from the registry.
   * @param {{ onlineOnly?: boolean }} [opts]
   * @returns {Array<object>}
   */
  getPeers({ onlineOnly = false } = {}) {
    return onlineOnly ? this.peerRegistry.getOnlinePeers() : this.peerRegistry.getAllPeers();
  }
}

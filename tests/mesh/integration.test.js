import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRelayServer } from '../../relay/server.js';
import { MeshService } from '../../server/mesh/mesh-service.js';
import { generateKeyPair } from '../../server/mesh/crypto/key-manager.js';
import { ENVELOPE_TYPES } from '../../server/mesh/envelope.js';

describe('integration: mesh end-to-end', () => {
  let relay;
  let relayPort;
  let nodeA; // CEO
  let nodeB; // Worker
  let keyPairA;
  let keyPairB;

  beforeAll(async () => {
    // Start relay on random port
    relay = createRelayServer();
    relayPort = await relay.listen(0);

    // Generate keypairs
    keyPairA = await generateKeyPair();
    keyPairB = await generateKeyPair();

    const relayUrl = `ws://127.0.0.1:${relayPort}`;

    // Create MeshService instances
    nodeA = new MeshService({
      keyManager: keyPairA,
      relayUrl,
      nodeId: 'node-a',
      role: 'ceo',
    });

    nodeB = new MeshService({
      keyManager: keyPairB,
      relayUrl,
      nodeId: 'node-b',
      role: 'worker',
    });
  }, 15000);

  afterAll(async () => {
    if (nodeA) await nodeA.stop();
    if (nodeB) await nodeB.stop();
    if (relay) await relay.close();
  }, 15000);

  it('both nodes connect, exchange query/response via relay', async () => {
    // Start both nodes
    await nodeA.start();
    await nodeB.start();

    // Wait for relay to register both peers
    await waitFor(() => relay.peers.size === 2, 5000, 'both peers to connect');

    // Register node-b in node-a's peer registry and vice versa
    // (In production the relay broadcasts peer_joined, but for testing we add manually)
    const { exportPublicKeys } = await import('../../server/mesh/crypto/key-manager.js');
    const pubA = exportPublicKeys(keyPairA);
    const pubB = exportPublicKeys(keyPairB);

    nodeA.peerRegistry.addPeer({
      nodeId: 'node-b',
      publicKey: pubB.signPub,
      boxPublicKey: pubB.boxPub,
      role: 'worker',
      online: true,
    });

    nodeB.peerRegistry.addPeer({
      nodeId: 'node-a',
      publicKey: pubA.signPub,
      boxPublicKey: pubA.boxPub,
      role: 'ceo',
      online: true,
    });

    // Verify both see each other as peers
    const peersA = nodeA.getPeers({ onlineOnly: true });
    const peersB = nodeB.getPeers({ onlineOnly: true });
    const peerIdsA = peersA.map((p) => p.nodeId);
    const peerIdsB = peersB.map((p) => p.nodeId);
    expect(peerIdsA).toContain('node-b');
    expect(peerIdsB).toContain('node-a');

    // Set up a response handler on node-b: when it receives a query, reply
    const responsePromise = new Promise((resolve) => {
      nodeB.messageRouter.registerHandler(ENVELOPE_TYPES.QUERY, async (msg) => {
        // node-b received the query, send a response back
        await nodeB.sendResponse(msg.from, msg.id, {
          answer: 'I am working on task #42',
        });
      });

      // node-a listens for the response
      nodeA.messageRouter.registerHandler(ENVELOPE_TYPES.RESPONSE, async (msg) => {
        resolve(msg);
      });
    });

    // node-a sends a query to node-b
    const queryId = await nodeA.sendQuery('node-b', 'What are you working on?', 'status');
    expect(typeof queryId).toBe('string');

    // Wait for node-a to receive the response
    const response = await withTimeout(responsePromise, 10000, 'response from node-b');

    expect(response.from).toBe('node-b');
    expect(response.type).toBe(ENVELOPE_TYPES.RESPONSE);
    expect(response.payload.data.answer).toBe('I am working on task #42');
    expect(response.payload.queryId).toBe(queryId);
  }, 20000);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait until a condition function returns true.
 */
function waitFor(conditionFn, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (conditionFn()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timed out waiting for ${label}`));
      }
      setTimeout(check, 50);
    };
    check();
  });
}

/**
 * Race a promise against a timeout.
 */
function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs)
    ),
  ]);
}

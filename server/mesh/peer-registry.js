/**
 * In-memory peer registry for tracking mesh peers.
 */

export class PeerRegistry {
  constructor() {
    this._peers = new Map();
  }

  /**
   * Add or update a peer in the registry.
   * @param {{ nodeId: string, publicKey: string, boxPublicKey?: string, role: string, online: boolean }} peer
   */
  addPeer({ nodeId, publicKey, boxPublicKey, role, online }) {
    this._peers.set(nodeId, { nodeId, publicKey, boxPublicKey: boxPublicKey ?? null, role, online });
  }

  /**
   * Remove a peer from the registry.
   * @param {string} nodeId
   */
  removePeer(nodeId) {
    this._peers.delete(nodeId);
  }

  /**
   * Get peer info by nodeId.
   * @param {string} nodeId
   * @returns {{ nodeId: string, publicKey: string, role: string, online: boolean } | null}
   */
  getPeer(nodeId) {
    return this._peers.get(nodeId) ?? null;
  }

  /**
   * Get all online peers.
   * @returns {Array<{ nodeId: string, publicKey: string, role: string, online: boolean }>}
   */
  getOnlinePeers() {
    return Array.from(this._peers.values()).filter((p) => p.online);
  }

  /**
   * Get all peers regardless of status.
   * @returns {Array<{ nodeId: string, publicKey: string, role: string, online: boolean }>}
   */
  getAllPeers() {
    return Array.from(this._peers.values());
  }

  /**
   * Update the online status of a peer.
   * @param {string} nodeId
   * @param {boolean} online
   */
  updateStatus(nodeId, online) {
    const peer = this._peers.get(nodeId);
    if (peer) {
      peer.online = online;
    }
  }

  /**
   * Clear all peers from the registry (useful for testing).
   */
  clear() {
    this._peers.clear();
  }
}

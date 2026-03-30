import { describe, it, expect, beforeEach } from 'vitest';
import { PeerRegistry } from '../../server/mesh/peer-registry.js';

describe('PeerRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new PeerRegistry();
  });

  describe('addPeer / getPeer', () => {
    it('adds and retrieves a peer', () => {
      registry.addPeer({ nodeId: 'node-1', publicKey: 'pk1', role: 'worker', online: true });

      const peer = registry.getPeer('node-1');
      expect(peer).not.toBeNull();
      expect(peer.nodeId).toBe('node-1');
      expect(peer.publicKey).toBe('pk1');
      expect(peer.role).toBe('worker');
      expect(peer.online).toBe(true);
    });

    it('returns null for unknown peer', () => {
      expect(registry.getPeer('nonexistent')).toBeNull();
    });
  });

  describe('removePeer', () => {
    it('removes a peer from the registry', () => {
      registry.addPeer({ nodeId: 'node-1', publicKey: 'pk1', role: 'worker', online: true });
      registry.removePeer('node-1');

      expect(registry.getPeer('node-1')).toBeNull();
    });
  });

  describe('getOnlinePeers', () => {
    it('filters correctly by online status', () => {
      registry.addPeer({ nodeId: 'a', publicKey: 'pk-a', role: 'worker', online: true });
      registry.addPeer({ nodeId: 'b', publicKey: 'pk-b', role: 'worker', online: false });
      registry.addPeer({ nodeId: 'c', publicKey: 'pk-c', role: 'ceo', online: true });

      const online = registry.getOnlinePeers();
      expect(online).toHaveLength(2);
      expect(online.map((p) => p.nodeId).sort()).toEqual(['a', 'c']);
    });
  });

  describe('updateStatus', () => {
    it('updates the online status of an existing peer', () => {
      registry.addPeer({ nodeId: 'node-1', publicKey: 'pk1', role: 'worker', online: true });
      registry.updateStatus('node-1', false);

      expect(registry.getPeer('node-1').online).toBe(false);
    });

    it('does nothing for a non-existent peer', () => {
      // Should not throw
      registry.updateStatus('nonexistent', true);
    });
  });

  describe('clear', () => {
    it('removes all peers', () => {
      registry.addPeer({ nodeId: 'a', publicKey: 'pk-a', role: 'worker', online: true });
      registry.addPeer({ nodeId: 'b', publicKey: 'pk-b', role: 'worker', online: true });
      registry.clear();

      expect(registry.getAllPeers()).toHaveLength(0);
    });
  });
});

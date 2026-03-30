import { describe, it, expect } from 'vitest';
import { PeerRegistry } from '../../server/mesh/peer-registry.js';

describe('PeerRegistry Spec compliance', () => {
  it('should store roleRank on addPeer', () => {
    const registry = new PeerRegistry();
    registry.addPeer({
      nodeId: 'node-1',
      publicKey: 'pk1',
      boxPublicKey: 'bpk1',
      role: 'member',
      roleRank: 1,
      projects: ['project-a'],
      online: true,
    });
    const peer = registry.getPeer('node-1');
    expect(peer.roleRank).toBe(1);
  });

  it('should store projects array on addPeer', () => {
    const registry = new PeerRegistry();
    registry.addPeer({
      nodeId: 'node-1',
      publicKey: 'pk1',
      boxPublicKey: 'bpk1',
      role: 'member',
      roleRank: 1,
      projects: ['project-a', 'project-b'],
      online: true,
    });
    const peer = registry.getPeer('node-1');
    expect(peer.projects).toEqual(['project-a', 'project-b']);
  });

  it('mesh_peers should return roleRank and projects in PeerInfo', () => {
    const registry = new PeerRegistry();
    registry.addPeer({
      nodeId: 'node-1',
      publicKey: 'pk1',
      roleRank: 3,
      projects: ['project-a'],
      online: true,
    });
    const peers = registry.getOnlinePeers();
    expect(peers[0]).toHaveProperty('roleRank', 3);
    expect(peers[0]).toHaveProperty('projects');
    expect(peers[0].projects).toContain('project-a');
  });
});

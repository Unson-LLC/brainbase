import { describe, it, expect } from 'vitest';
import { buildNodeProfile } from '../../server/mesh/node-profile.js';

const mockConfig = {
  mesh: {
    relay_url: 'wss://relay.example.com',
    agent_runtime: 'claude-code',
  },
  projects: [
    {
      id: 'project-a',
      local: { path: 'projects/project-a', glob_include: ['src/**/*'] },
      nocodb: { base_id: 'base-a' },
      assignees: [{ slack_user_id: 'U001' }, { slack_user_id: 'U002' }],
    },
    {
      id: 'project-b',
      local: { path: 'projects/project-b', glob_include: ['app/**/*'] },
      nocodb: { base_id: 'base-b' },
      assignees: [{ slack_user_id: 'U002' }],
    },
    {
      id: 'project-c',
      local: { path: 'projects/project-c' },
      nocodb: { base_id: 'base-c' },
      assignees: [{ slack_user_id: 'U003' }],
    },
  ],
};

describe('NodeProfile', () => {
  it('should filter projects by slackUserId', () => {
    const profile = buildNodeProfile({
      config: mockConfig,
      slackUserId: 'U002',
      roleRank: 1,
      brainbaseRoot: '/workspace/shared',
    });
    expect(profile.projects).toHaveLength(2);
    expect(profile.projects.map(p => p.projectId)).toEqual(['project-a', 'project-b']);
  });

  it('should resolve localPath relative to BRAINBASE_ROOT/../', () => {
    const profile = buildNodeProfile({
      config: mockConfig,
      slackUserId: 'U001',
      roleRank: 3,
      brainbaseRoot: '/workspace/shared',
    });
    expect(profile.projects[0].localPath).toBe('/workspace/projects/project-a');
  });

  it('should include roleRank and agentRuntime', () => {
    const profile = buildNodeProfile({
      config: mockConfig,
      slackUserId: 'U001',
      roleRank: 3,
      brainbaseRoot: '/workspace/shared',
    });
    expect(profile.roleRank).toBe(3);
    expect(profile.agentRuntime).toBe('claude-code');
  });

  it('should return empty projects if user not assigned anywhere', () => {
    const profile = buildNodeProfile({
      config: mockConfig,
      slackUserId: 'U999',
      roleRank: 1,
      brainbaseRoot: '/workspace/shared',
    });
    expect(profile.projects).toHaveLength(0);
  });

  it('should generate nodeId if not provided', () => {
    const profile = buildNodeProfile({
      config: mockConfig,
      slackUserId: 'U001',
      roleRank: 3,
      brainbaseRoot: '/workspace/shared',
    });
    expect(profile.nodeId).toBeDefined();
    expect(typeof profile.nodeId).toBe('string');
    expect(profile.nodeId.length).toBeGreaterThan(0);
  });

  it('should use provided nodeId', () => {
    const profile = buildNodeProfile({
      config: mockConfig,
      slackUserId: 'U001',
      roleRank: 3,
      brainbaseRoot: '/workspace/shared',
      nodeId: 'my-node',
    });
    expect(profile.nodeId).toBe('my-node');
  });

  it('should include glob_include from config', () => {
    const profile = buildNodeProfile({
      config: mockConfig,
      slackUserId: 'U001',
      roleRank: 3,
      brainbaseRoot: '/workspace/shared',
    });
    expect(profile.projects[0].globInclude).toEqual(['src/**/*']);
  });
});

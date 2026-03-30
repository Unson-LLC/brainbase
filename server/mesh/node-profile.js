import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * Build a NodeProfile from config, Slack user ID, and role.
 *
 * @param {object} opts
 * @param {object} opts.config - Parsed config.yml with mesh and projects sections
 * @param {string} opts.slackUserId - Authenticated Slack user ID
 * @param {number} opts.roleRank - Role level (1=Member, 2=GM, 3=CEO)
 * @param {string} opts.brainbaseRoot - BRAINBASE_ROOT path
 * @param {string} [opts.nodeId] - Optional explicit node ID
 * @returns {{ nodeId: string, slackUserId: string, roleRank: number, agentRuntime: string, projects: Array }}
 */
export function buildNodeProfile({ config, slackUserId, roleRank, brainbaseRoot, nodeId }) {
  const assignedProjects = (config.projects || [])
    .filter((project) => {
      const assignees = project.assignees || [];
      return assignees.some((a) => a.slack_user_id === slackUserId);
    })
    .map((project) => ({
      projectId: project.id,
      localPath: resolve(brainbaseRoot, '..', project.local.path),
      globInclude: project.local.glob_include || [],
      nocodbBaseId: project.nocodb?.base_id || null,
    }));

  return {
    nodeId: nodeId || randomUUID().slice(0, 8),
    slackUserId,
    roleRank,
    agentRuntime: config.mesh?.agent_runtime || 'claude-code',
    projects: assignedProjects,
  };
}

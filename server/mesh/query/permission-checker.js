/**
 * Permission checker for mesh query requests.
 * Pure function module - no external dependencies.
 */

/**
 * Check whether a query is permitted based on role and project membership.
 *
 * @param {Object} params
 * @param {number} params.fromRole - Role level of the requester (1=Worker, 2=GM, 3=CEO)
 * @param {string[]} params.fromProjects - Projects the requester belongs to
 * @param {string[]} params.toProjects - Projects the target node belongs to
 * @param {string} params.scope - Query scope requested
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkQueryPermission({ fromRole, fromProjects, toProjects, scope }) {
  // CEO (role >= 3) — always allowed
  if (fromRole >= 3) {
    return { allowed: true };
  }

  // GM (role >= 2) — always allowed
  if (fromRole >= 2) {
    return { allowed: true };
  }

  // Worker (role === 1) — allowed only if they share at least one project
  if (fromRole === 1) {
    const shared = (fromProjects || []).some((p) => (toProjects || []).includes(p));
    if (shared) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: 'Worker nodes can only query nodes that share at least one project',
    };
  }

  // Unknown / insufficient role
  return {
    allowed: false,
    reason: 'Insufficient role level to perform queries',
  };
}

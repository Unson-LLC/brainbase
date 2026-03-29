/**
 * Handles incoming queries from other mesh nodes.
 */
export class QueryHandler {
  /**
   * @param {Object} opts
   * @param {import('./local-context-collector.js').LocalContextCollector} opts.localContextCollector
   * @param {{ checkQueryPermission: Function }} opts.permissionChecker
   */
  constructor({ localContextCollector, permissionChecker }) {
    this.localContextCollector = localContextCollector;
    this.permissionChecker = permissionChecker;
  }

  /**
   * Handle an incoming query from another mesh node.
   *
   * @param {Object} params
   * @param {string} params.from - Identifier of the requesting node
   * @param {number} params.fromRole - Role level of the requester
   * @param {string[]} params.fromProjects - Projects the requester belongs to
   * @param {string} params.question - The query question text
   * @param {string} params.scope - One of 'status' | 'code' | 'project' | 'general'
   * @returns {Promise<string>} JSON string response
   */
  async handleQuery({ from, fromRole, fromProjects, question, scope }) {
    // 1. Permission check
    const permResult = this.permissionChecker.checkQueryPermission({
      fromRole,
      fromProjects,
      toProjects: this._getOwnProjects(),
      scope,
    });

    if (!permResult.allowed) {
      return JSON.stringify({ error: 'permission_denied', reason: permResult.reason });
    }

    // 2. Collect data based on scope
    let data;
    try {
      switch (scope) {
        case 'status':
          data = await this.localContextCollector.collectStatus();
          break;
        case 'code':
          data = await this.localContextCollector.collectCode();
          break;
        case 'project':
          data = await this.localContextCollector.collectProject();
          break;
        case 'general':
        default:
          data = await this.localContextCollector.collectGeneral();
          break;
      }
    } catch (err) {
      return JSON.stringify({ error: 'collection_failed', reason: err.message });
    }

    // 3. Return collected data as JSON string
    return JSON.stringify(data);
  }

  /**
   * Returns the projects this node belongs to.
   * Override or inject as needed; defaults to an empty array.
   */
  _getOwnProjects() {
    return this._ownProjects ?? [];
  }

  /**
   * Set the projects this node belongs to.
   * @param {string[]} projects
   */
  setOwnProjects(projects) {
    this._ownProjects = projects;
  }
}

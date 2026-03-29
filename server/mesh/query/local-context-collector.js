import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Collects local node information (tasks, git state, milestones) for query responses.
 */
export class LocalContextCollector {
  /**
   * @param {Object} opts
   * @param {string} opts.nocodbUrl - Base URL of the NocoDB instance
   * @param {string} opts.nocodbToken - Auth token for NocoDB
   * @param {string} opts.taskTableId - NocoDB table ID for tasks
   * @param {string} opts.milestoneTableId - NocoDB table ID for milestones
   * @param {string} opts.workDir - Git working directory
   * @param {'token' | 'jwt'} [opts.nocodbAuthMethod='token'] - Auth method: 'token' uses xc-token (API token), 'jwt' uses xc-auth (session JWT)
   */
  constructor({ nocodbUrl, nocodbToken, taskTableId, milestoneTableId, workDir, nocodbAuthMethod = 'token' }) {
    this.nocodbUrl = nocodbUrl;
    this.nocodbToken = nocodbToken;
    this.taskTableId = taskTableId;
    this.milestoneTableId = milestoneTableId;
    this.workDir = workDir;
    /** @type {'token' | 'jwt'} */
    this.nocodbAuthMethod = nocodbAuthMethod;
  }

  // ---------------------------------------------------------------------------
  // Public collectors
  // ---------------------------------------------------------------------------

  /**
   * Collect current status: own tasks, git status, recent commits, session state.
   */
  async collectStatus() {
    const [tasks, worktreeStatus, recentCommits] = await Promise.all([
      this._fetchRecords(this.taskTableId, 20),
      this._gitCommand('git status --porcelain'),
      this._gitCommand('git log --oneline -5'),
    ]);

    return {
      tasks,
      worktreeStatus,
      recentCommits,
      sessionState: 'running',
    };
  }

  /**
   * Collect code-level context: diff and changed file list.
   */
  async collectCode() {
    const [gitDiff, changedFiles] = await Promise.all([
      this._gitCommand('git diff'),
      this._gitCommand('git diff --name-only'),
    ]);

    return {
      gitDiff: typeof gitDiff === 'string' ? gitDiff.slice(0, 5000) : gitDiff,
      changedFiles:
        typeof changedFiles === 'string'
          ? changedFiles
              .split('\n')
              .map((f) => f.trim())
              .filter(Boolean)
          : changedFiles,
    };
  }

  /**
   * Collect project-wide context: all tasks and milestones.
   */
  async collectProject() {
    const [tasks, milestones] = await Promise.all([
      this._fetchRecords(this.taskTableId),
      this._fetchRecords(this.milestoneTableId),
    ]);

    return { tasks, milestones };
  }

  /**
   * Collect everything — a merge of status, code, and project data.
   */
  async collectGeneral() {
    const [status, code, project] = await Promise.all([
      this.collectStatus(),
      this.collectCode(),
      this.collectProject(),
    ]);

    return { ...status, ...code, ...project };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Run a git command in the configured workDir, returning stdout or an error string.
   */
  async _gitCommand(cmd) {
    try {
      const { stdout } = await execAsync(cmd, {
        cwd: this.workDir,
        encoding: 'utf-8',
        timeout: 10_000,
      });
      return stdout.trim();
    } catch (err) {
      return `error: ${err.message}`;
    }
  }

  /**
   * Build the NocoDB auth header based on the configured auth method.
   * @returns {Object} Header object with the appropriate auth key.
   */
  _nocodbAuthHeader() {
    if (this.nocodbAuthMethod === 'jwt') {
      return { 'xc-auth': this.nocodbToken };
    }
    return { 'xc-token': this.nocodbToken };
  }

  /**
   * Fetch records from a NocoDB table.
   * @param {string} tableId - NocoDB table ID
   * @param {number} [limit=100] - Max records to fetch
   */
  async _fetchRecords(tableId, limit = 100) {
    try {
      const url = `${this.nocodbUrl}/api/v2/tables/${tableId}/records?limit=${limit}`;
      const res = await fetch(url, { headers: this._nocodbAuthHeader() });
      if (!res.ok) return { error: `NocoDB returned ${res.status}` };
      const data = await res.json();
      return data.list ?? data;
    } catch (err) {
      return { error: err.message };
    }
  }
}

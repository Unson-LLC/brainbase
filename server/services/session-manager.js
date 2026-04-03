// @ts-check
/**
 * SessionManager
 * セッション管理の facade。詳細な責務は session-manager/ 配下の method modules に委譲する。
 */
import { TerminalOutputParser } from './terminal-output-parser.js';

import { activityTrackerMethods } from './session-manager/activity-tracker-methods.js';
import { runtimeStateRepositoryMethods } from './session-manager/runtime-state-repository-methods.js';
import { terminalOwnershipMethods } from './session-manager/terminal-ownership-methods.js';
import { terminalRuntimeMethods } from './session-manager/terminal-runtime-methods.js';
import { workspaceResolverMethods } from './session-manager/workspace-resolver-methods.js';

export class SessionManager {
    /**
     * @param {Object} options - 設定オプション
     * @param {string} options.serverDir - server.jsのディレクトリ（__dirname）
     * @param {Function} options.execPromise - util.promisify(exec)
     * @param {Object} options.stateStore - StateStoreインスタンス
     * @param {Object} options.worktreeService - WorktreeServiceインスタンス
     * @param {number|string} [options.uiPort] - UIサーバーのポート
     */
    constructor({ serverDir, execPromise, stateStore, worktreeService, uiPort } = {}) {
        this.serverDir = serverDir;
        this.execPromise = execPromise;
        this.stateStore = stateStore ?? {
            get: () => ({ sessions: [] }),
            update: async (next) => next
        };
        this.worktreeService = worktreeService;
        this.uiPort = uiPort;

        this.activeSessions = new Map();
        this.hookStatus = new Map();
        this.startLocks = new Map();
        this.terminalOwners = new Map();
        this.promptBuffers = new Map();
        this.nextPort = 40000;

        this._isReady = false;
        this._readyResolver = null;
        this._readyPromise = new Promise((resolve) => {
            this._readyResolver = resolve;
        });

        this.outputParser = new TerminalOutputParser();

        this.ALLOWED_KEYS = ['M-Enter', 'C-c', 'C-d', 'C-l', 'C-u', 'Enter', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Tab', 'S-Tab', 'BTab'];
        this.TERMINAL_OWNER_TTL_MS = 10 * 60 * 1000;
    }
}

Object.assign(
    SessionManager.prototype,
    terminalOwnershipMethods,
    activityTrackerMethods,
    runtimeStateRepositoryMethods,
    workspaceResolverMethods,
    terminalRuntimeMethods
);

// @ts-check
import path from 'path';

import { installActivityHandlers } from './session/activity-handlers.js';
import { installContextHandlers } from './session/context-handlers.js';
import { installRuntimeHandlers } from './session/runtime-handlers.js';
import { installSharedMethods } from './session/shared-methods.js';
import { installTerminalIoHandlers } from './session/terminal-io-handlers.js';
import { installWorktreeHandlers } from './session/worktree-handlers.js';

export class SessionController {
    /**
     * @param {{
     *   activity?: any,
     *   ownership?: any,
     *   workspace?: any,
     *   runtimeQuery?: any,
     *   runtimeLifecycle?: any,
     *   runtimeRegistry?: any,
     *   runtimeReconciler?: any,
     *   terminalIo?: any,
     *   terminalInputProbe?: any,
     *   snapshot?: any,
 *   worktreeService?: any,
 *   archiveFinalizer?: any,
 *   stateStore?: any,
     *   projectsRoot?: string | null,
     *   codeProjectsRoot?: string | null,
     *   captureCache?: any
     * }} deps
     */
    constructor(deps = {}) {
        this.activity = deps.activity || null;
        this.ownership = deps.ownership || null;
        this.workspace = deps.workspace || null;
        this.runtimeQuery = deps.runtimeQuery || null;
        this.runtimeLifecycle = deps.runtimeLifecycle || null;
        this.runtimeRegistry = deps.runtimeRegistry || null;
        this.runtimeReconciler = deps.runtimeReconciler || null;
        this.terminalIo = deps.terminalIo || null;
        this.terminalInputProbe = deps.terminalInputProbe || null;
        this.snapshot = deps.snapshot || null;
        this.worktreeService = deps.worktreeService;
        this.archiveFinalizer = deps.archiveFinalizer || null;
        this.stateStore = deps.stateStore;
        this.projectsRoot = typeof deps.projectsRoot === 'string' && deps.projectsRoot.trim()
            ? deps.projectsRoot
            : null;
        this.codeProjectsRoot = typeof deps.codeProjectsRoot === 'string' && deps.codeProjectsRoot.trim()
            ? deps.codeProjectsRoot
            : (this.projectsRoot ? path.join(path.dirname(this.projectsRoot), 'code') : null);
        this.captureCache = deps.captureCache || null;
        this._commitNotifyMap = new Map();
        this.progressMap = new Map();
        this._uiSummaryCache = new Map();
        this._recentSessionStarts = new Map();

        installSharedMethods(this);
        installActivityHandlers(this);
        installRuntimeHandlers(this);
        installTerminalIoHandlers(this);
        installWorktreeHandlers(this);
        installContextHandlers(this);
    }
}

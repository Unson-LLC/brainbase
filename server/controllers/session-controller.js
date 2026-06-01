// @ts-check
import path from 'path';

import { installActivityHandlers } from './session/activity-handlers.js';
import { installContextHandlers } from './session/context-handlers.js';
import { installRuntimeHandlers } from './session/runtime-handlers.js';
import { installSharedMethods } from './session/shared-methods.js';
import { installTerminalIoHandlers } from './session/terminal-io-handlers.js';
import { installWorktreeHandlers } from './session/worktree-handlers.js';

const DEFAULT_CODEX_APP_SERVER_METADATA_TIMEOUT_MS = 45_000;
const DEFAULT_CODEX_APP_SERVER_METADATA_INTERVAL_MS = 250;

function resolvePositiveIntegerEnv(name, fallback) {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

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
     *   codexAppServerTranscript?: any,
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
        this.codexAppServerTranscript = deps.codexAppServerTranscript || null;
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
        this.codexAppServerMetadataTimeoutMs = resolvePositiveIntegerEnv(
            'BRAINBASE_CODEX_APP_SERVER_METADATA_TIMEOUT_MS',
            DEFAULT_CODEX_APP_SERVER_METADATA_TIMEOUT_MS
        );
        this.codexAppServerMetadataIntervalMs = resolvePositiveIntegerEnv(
            'BRAINBASE_CODEX_APP_SERVER_METADATA_INTERVAL_MS',
            DEFAULT_CODEX_APP_SERVER_METADATA_INTERVAL_MS
        );

        installSharedMethods(this);
        installActivityHandlers(this);
        installRuntimeHandlers(this);
        installTerminalIoHandlers(this);
        installWorktreeHandlers(this);
        installContextHandlers(this);
    }
}

import { TerminalOutputParser } from './terminal-output-parser.js';
import { activityServiceMethods } from './session-core/activity-service-methods.js';
import { runtimeStateRepositoryMethods } from './session-core/runtime-state-repository-methods.js';
import { ownershipServiceMethods } from './session-core/ownership-service-methods.js';
import { workspaceServiceMethods } from './session-core/workspace-service-methods.js';
import { runtimeRegistryMethods } from './session-runtime/runtime-registry-methods.js';
import { runtimeQueryMethods } from './session-runtime/runtime-query-methods.js';
import { runtimeLifecycleMethods } from './session-runtime/runtime-lifecycle-methods.js';
import { runtimeMaintenanceMethods } from './session-runtime/runtime-maintenance-methods.js';
import { terminalIoMethods } from './session-runtime/terminal-io-methods.js';
import { terminalSnapshotMethods } from './session-runtime/terminal-snapshot-methods.js';

const DEFAULT_STATE_STORE = {
    get: () => ({ sessions: [] }),
    update: async (next) => next
};

const ALLOWED_KEYS = ['M-Enter', 'S-Enter', 'C-c', 'C-d', 'C-l', 'C-u', 'Enter', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Tab', 'S-Tab', 'BTab', 'BSpace'];

function bindMethods(target, methods) {
    for (const [name, value] of Object.entries(methods)) {
        if (typeof value === 'function') {
            target[name] = value.bind(target);
            continue;
        }
        target[name] = value;
    }
}

export function createSessionServices({ serverDir, execPromise, stateStore, worktreeService, uiPort } = {}) {
    const shared = {
        serverDir,
        execPromise,
        stateStore: stateStore ?? DEFAULT_STATE_STORE,
        worktreeService,
        uiPort,

        activeSessions: new Map(),
        hookStatus: new Map(),
        startLocks: new Map(),
        terminalMutationQueues: new Map(),
        terminalOwners: new Map(),
        promptBuffers: new Map(),
        paneTitleActivityCache: new Map(),
        paneTitleSuppressedSessionIds: new Set(),
        tmuxPaneTitleRowsCache: null,
        nextPort: 40000,

        _isReady: false,
        _readyResolver: null,
        _readyPromise: null,
        _ptyWatchdogTimer: null,
        _healthMonitor: null,

        outputParser: new TerminalOutputParser(),
        ALLOWED_KEYS,
        TERMINAL_OWNER_TTL_MS: 10 * 60 * 1000
    };

    shared._readyPromise = new Promise((resolve) => {
        shared._readyResolver = resolve;
    });

    bindMethods(shared, ownershipServiceMethods);
    bindMethods(shared, activityServiceMethods);
    bindMethods(shared, runtimeStateRepositoryMethods);
    bindMethods(shared, workspaceServiceMethods);
    bindMethods(shared, runtimeRegistryMethods);
    bindMethods(shared, runtimeQueryMethods);
    bindMethods(shared, runtimeLifecycleMethods);
    bindMethods(shared, runtimeMaintenanceMethods);
    bindMethods(shared, terminalIoMethods);
    bindMethods(shared, terminalSnapshotMethods);

    const runtimeRegistry = {
        activeSessions: shared.activeSessions,
        startLocks: shared.startLocks,
        isActive: shared.isActive,
        getActiveSessions: shared.getActiveSessions,
        markReady: shared.markReady,
        isReady: shared.isReady,
        waitUntilReady: shared.waitUntilReady
    };

    const runtimeQuery = {
        activeSessions: shared.activeSessions,
        findFreePort: shared.findFreePort,
        waitForTtydReady: shared.waitForTtydReady,
        _checkPortListening: shared._checkPortListening,
        getSession: shared.getSession,
        _resolveScriptPath: shared._resolveScriptPath,
        _isTmuxSessionRunningSync: shared._isTmuxSessionRunningSync,
        _isXtermOnlyMode: shared._isXtermOnlyMode,
        getRuntimeStatus: shared.getRuntimeStatus,
        getSessionById: shared.getSessionById,
        getRuntimeInventory: shared.getRuntimeInventory,
        getHibernationEligibility: shared.getHibernationEligibility,
        _isProcessRunning: shared._isProcessRunning,
        _isTmuxSessionRunning: shared._isTmuxSessionRunning,
        isTmuxSessionRunning: shared.isTmuxSessionRunning
    };

    const runtimeLifecycle = {
        ensureSessionRuntime: shared.ensureSessionRuntime,
        startTtyd: shared.startTtyd,
        _doStartTtyd: shared._doStartTtyd,
        _restartTtydForExistingTmux: shared._restartTtydForExistingTmux,
        ensureTtydForActiveSession: shared.ensureTtydForActiveSession,
        stopTtyd: shared.stopTtyd,
        stopSessionOwnedProcesses: shared.stopSessionOwnedProcesses,
        cleanupSessionResources: shared.cleanupSessionResources,
        cleanup: shared.cleanup
    };

    const runtimeMaintenance = {
        restoreActiveSessions: shared.restoreActiveSessions,
        cleanupOrphans: shared.cleanupOrphans,
        cleanupStalePausedSessions: shared.cleanupStalePausedSessions,
        cleanupArchivedSessions: shared.cleanupArchivedSessions,
        repairActiveTtydSessions: shared.repairActiveTtydSessions,
        startPtyWatchdog: shared.startPtyWatchdog,
        stopPtyWatchdog: shared.stopPtyWatchdog,
        startStaleSessionRecycler: shared.startStaleSessionRecycler,
        stopStaleSessionRecycler: shared.stopStaleSessionRecycler,
        _pauseStaleSessionsByUptime: shared._pauseStaleSessionsByUptime
    };

    shared.runtimeRegistry = runtimeRegistry;
    shared.runtimeQuery = runtimeQuery;

    return {
        shared,
        sessionApi: shared,
        activity: {
            hookStatus: shared.hookStatus,
            promptBuffers: shared.promptBuffers,
            restoreHookStatus: shared.restoreHookStatus,
            getSessionStatus: shared.getSessionStatus,
            reportActivity: shared.reportActivity,
            clearDoneStatus: shared.clearDoneStatus,
            clearWorking: shared.clearWorking
        },
        ownership: {
            terminalOwners: shared.terminalOwners,
            getTerminalAccessState: shared.getTerminalAccessState,
            getTerminalOwnerSnapshot: shared.getTerminalOwnerSnapshot,
            claimTerminalOwnership: shared.claimTerminalOwnership,
            touchTerminalOwnership: shared.touchTerminalOwnership,
            ensureTerminalOwnership: shared.ensureTerminalOwnership,
            forceTerminalOwnership: shared.forceTerminalOwnership,
            releaseTerminalOwnership: shared.releaseTerminalOwnership
        },
        workspace: {
            resolveSessionWorkspacePath: shared.resolveSessionWorkspacePath,
            reconcileSessionWorkspacePaths: shared.reconcileSessionWorkspacePaths,
            _getStoredWorkspacePath: shared._getStoredWorkspacePath
        },
        stateRepository: {
            _persistResolvedWorkspacePath: shared._persistResolvedWorkspacePath,
            _saveTtydProcessInfo: shared._saveTtydProcessInfo,
            _clearTtydProcessInfo: shared._clearTtydProcessInfo,
            _clearTtydProcessInfoIfMatches: shared._clearTtydProcessInfoIfMatches
        },
        runtime: {
            registry: runtimeRegistry,
            query: runtimeQuery,
            lifecycle: runtimeLifecycle,
            maintenance: runtimeMaintenance
        },
        terminal: {
            io: {
                getSessionPaneSize: shared.getSessionPaneSize,
                repairCollapsedSessionWindow: shared.repairCollapsedSessionWindow,
                resizeSessionWindow: shared.resizeSessionWindow,
                scrollSession: shared.scrollSession,
                selectPane: shared.selectPane,
                exitCopyMode: shared.exitCopyMode,
                sendInput: shared.sendInput,
                _runTmux: shared._runTmux,
                _sendNamedKey: shared._sendNamedKey,
                _pasteInputFromTempFile: shared._pasteInputFromTempFile
            },
            snapshot: {
                getPaneMode: shared.getPaneMode,
                getContent: shared.getContent,
                getVisibleContent: shared.getVisibleContent,
                getContentWithColors: shared.getContentWithColors,
                getVisibleContentWithColors: shared.getVisibleContentWithColors,
                getCursorPosition: shared.getCursorPosition,
                getOutput: shared.getOutput
            }
        }
    };
}

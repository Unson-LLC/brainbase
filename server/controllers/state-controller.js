// @ts-check
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../lib/async-handler.js';
import { pickAllowedFields } from '../lib/validation.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

/**
 * StateController
 * 状態管理のHTTPリクエスト処理
 */

/** @typedef {any} Request */
/** @typedef {any} Response */
/**
 * @typedef {{
 *   id: string,
 *   name?: string,
 *   path?: string,
 *   cwd?: string,
 *   worktree?: { path?: string, repo?: string, startCommit?: string } | null,
 *   conversationSummary?: {
 *     totalConversations?: number,
 *     lastConversation?: { lastActivity?: string | null } | null,
 *     tokenUsage?: {
 *       source?: string,
 *       contextWindow?: number,
 *       usedTokens?: number,
 *       remainingTokens?: number,
 *       usedPercent?: number,
 *       remainingPercent?: number,
 *       updatedAt?: string | null
 *     } | null
 *   } | null,
 *   [key: string]: any
 * }} SessionRecord
 */

// セッションオブジェクトの許可フィールド
const ALLOWED_SESSION_FIELDS = [
    // 基本情報
    'id', 'name', 'project', 'path', 'cwd', 'worktree', 'initialCommand',
    'engine', 'intendedState', 'favorite', 'createdAt', 'archivedAt', 'archive', 'merged', 'mergedAt', 'mergedPrUrl',
    'activeWorkspaceId', 'workspaceHistory', 'workspaceRotationStatus', 'workspaceRotationError',
    'startupStatus', 'startupPhase', 'startupMessage',
    'updatedAt', 'taskBrief', 'taskBriefUpdatedAt', 'lastAssistantSnippet', 'lastAssistantSnippetAt', 'activityHistory',
    // Schema v2 追加フィールド
    'lastAccessedAt', 'pausedAt', 'pausedReason', 'tmuxMissingAt', 'tmuxCleanedAt',
    'runtimeState', 'hibernatedAt', 'hibernateReason', 'lastRuntimeSnapshot',
    'runtimeInventorySummary', 'restoreStrategy', 'restoreCommand', 'resumedAt',
    'resumeFailureReason', 'resumeFailedAt',
    'hibernateFailureReason', 'hibernateFailedAt', 'hibernatePartialStop',
    // Schema v3 追加フィールド
    'ttydProcess',
    // Recovery / binding fields
    'claudeResumeId', 'codexThreadId', 'bindingSource', 'bindingUpdatedAt',
    'lastKnownGoodPath', 'recoveryState', 'recoveryReason', 'lastHealthyAt',
    // 状態管理フィールド
    'hookStatus',
    // スキャン生成フィールド
    'conversationSummary'
];

/**
 * セッションオブジェクトの検証
 * @param {SessionRecord} session - 検証対象セッション
 * @returns {SessionRecord|null} 検証済みセッション（不正フィールド除去）
 */
function validateSession(session) {
    if (!session?.id || typeof session.id !== 'string') {
        return null;
    }
    return pickAllowedFields(session, ALLOWED_SESSION_FIELDS);
}

export class StateController {
    /**
     * @param {any} stateStore
     * @param {any} readinessOrSessionManager
     * @param {any} [runtimeQueryOrTestMode]
     * @param {boolean} [testMode]
     */
    constructor(stateStore, readinessOrSessionManager, runtimeQueryOrTestMode = false, testMode = false) {
        this.stateStore = stateStore;
        const looksLikeLegacy = Boolean(
            readinessOrSessionManager
            && typeof readinessOrSessionManager.waitUntilReady === 'function'
            && (
                typeof runtimeQueryOrTestMode === 'boolean'
                || runtimeQueryOrTestMode == null
                || typeof runtimeQueryOrTestMode.getRuntimeStatus !== 'function'
            )
        );
        if (looksLikeLegacy) {
            this.readiness = readinessOrSessionManager;
            this.runtimeQuery = readinessOrSessionManager;
            this.testMode = Boolean(runtimeQueryOrTestMode);
            return;
        }

        this.readiness = readinessOrSessionManager;
        this.runtimeQuery = runtimeQueryOrTestMode;
        this.testMode = Boolean(testMode);
    }

    /** GET /api/state */
    /** @param {Request} req @param {Response} res */
    get = asyncHandler(async (req, res) => {
        const ready = await this.readiness.waitUntilReady();
        if (!ready) {
            return res.status(503).json({ error: 'Service not ready' });
        }

        const state = this.stateStore.get();

        const sessionsWithStatus = /** @type {SessionRecord[]} */ (state.sessions || []).map((session) => {
            const safeSession = validateSession(session) || { id: session.id };
            const runtimeStatus = this.runtimeQuery.getRuntimeStatus(session);

            const { conversationSummary, ...rest } = safeSession;
            const tokenUsage = conversationSummary?.tokenUsage ? {
                source: conversationSummary.tokenUsage.source || null,
                contextWindow: conversationSummary.tokenUsage.contextWindow || null,
                usedTokens: conversationSummary.tokenUsage.usedTokens || null,
                remainingTokens: conversationSummary.tokenUsage.remainingTokens ?? null,
                usedPercent: conversationSummary.tokenUsage.usedPercent ?? null,
                remainingPercent: conversationSummary.tokenUsage.remainingPercent ?? null,
                updatedAt: conversationSummary.tokenUsage.updatedAt || null
            } : null;
            const convLight = conversationSummary ? {
                totalConversations: conversationSummary.totalConversations || 0,
                lastActivity: conversationSummary.lastConversation?.lastActivity || null,
                ...(tokenUsage && { tokenUsage })
            } : undefined;

            return {
                ...rest,
                ...(convLight && { conversationSummary: convLight }),
                ttydRunning: runtimeStatus.ttydRunning,
                runtimeStatus
            };
        });

        res.json({
            ...state,
            sessions: sessionsWithStatus,
            testMode: this.testMode
        });
    });

    /** POST /api/state */
    /** @param {Request} req @param {Response} res */
    update = asyncHandler(async (req, res) => {
        if (!req.body || typeof req.body !== 'object') {
            throw AppError.validation('Invalid request body');
        }

        if (req.body.sessions !== undefined) {
            logger.warn('[StateController] Ignoring sessions payload on POST /api/state; use session CRUD endpoints instead');
        }

        const { sessions, replaceSessions, ...nonSessionState } = req.body;
        const currentState = this.stateStore.get();
        const newState = await this.stateStore.update({
            ...currentState,
            ...nonSessionState
        });
        res.json(newState);
    });

    /** POST /api/state/sessions */
    /** @param {Request} req @param {Response} res */
    createSession = asyncHandler(async (req, res) => {
        if (!req.body || typeof req.body !== 'object') {
            throw AppError.validation('Invalid request body');
        }

        const { ttydRunning, runtimeStatus, ...persistentFields } = req.body;
        const validated = validateSession(/** @type {SessionRecord} */ (persistentFields));
        if (!validated) {
            throw AppError.validation('Invalid session data');
        }

        const state = this.stateStore.get();
        const sessions = /** @type {SessionRecord[]} */ (state.sessions || []);
        const existingIndex = sessions.findIndex((session) => session.id === validated.id);
        if (existingIndex !== -1) {
            const newState = await this.stateStore.patchSession(validated.id, {
                ...validated,
                updatedAt: new Date().toISOString()
            });
            const updatedSession = /** @type {SessionRecord[]} */ (newState.sessions || []).find((session) => session.id === validated.id);
            return res.json(updatedSession);
        }

        const newSession = {
            ...validated,
            createdAt: validated.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const newState = await this.stateStore.upsertSession(newSession);
        const createdSession = /** @type {SessionRecord[]} */ (newState.sessions || []).find((session) => session.id === validated.id);
        res.status(201).json(createdSession);
    });

    /** PATCH /api/state/sessions/:sessionId */
    /** @param {Request} req @param {Response} res */
    patch = asyncHandler(async (req, res) => {
        const { sessionId } = req.params;
        if (!sessionId) {
            throw AppError.validation('Session ID required');
        }

        if (!req.body || typeof req.body !== 'object') {
            throw AppError.validation('Invalid request body');
        }

        const { ttydRunning, runtimeStatus, ...updateFields } = req.body;

        const validated = validateSession({ id: sessionId, ...updateFields });
        if (!validated) {
            throw AppError.validation('Invalid session data');
        }

        let state = this.stateStore.get();
        let sessionIndex = /** @type {SessionRecord[]} */ (state.sessions || []).findIndex((s) => s.id === sessionId);

        if (sessionIndex === -1 && typeof this.stateStore.reloadFromDisk === 'function') {
            state = await this.stateStore.reloadFromDisk();
            sessionIndex = /** @type {SessionRecord[]} */ (state.sessions || []).findIndex((s) => s.id === sessionId);
        }

        if (sessionIndex === -1) {
            throw new AppError('Session not found', ErrorCodes.SESSION_NOT_FOUND);
        }

        const newState = await this.stateStore.patchSession(sessionId, {
            ...validated,
            updatedAt: new Date().toISOString()
        });

        const updatedSession = /** @type {SessionRecord[]} */ (newState.sessions || []).find((s) => s.id === sessionId);
        res.json(updatedSession);
    });

    /** DELETE /api/state/sessions/:sessionId */
    /** @param {Request} req @param {Response} res */
    deleteSession = asyncHandler(async (req, res) => {
        const { sessionId } = req.params;
        if (!sessionId) {
            throw AppError.validation('Session ID required');
        }

        const state = this.stateStore.get();
        const sessions = /** @type {SessionRecord[]} */ (state.sessions || []);
        const sessionIndex = sessions.findIndex((session) => session.id === sessionId);
        if (sessionIndex === -1) {
            throw new AppError('Session not found', ErrorCodes.SESSION_NOT_FOUND);
        }

        await this.stateStore.deleteSession(sessionId);

        res.json({ success: true, sessionId });
    });

    /** POST /api/state/sessions/reorder */
    /** @param {Request} req @param {Response} res */
    reorderSessions = asyncHandler(async (req, res) => {
        const orderedIds = req.body?.orderedIds;
        if (!Array.isArray(orderedIds)) {
            throw AppError.validation('orderedIds must be an array');
        }

        const newState = await this.stateStore.reorderSessions(orderedIds.filter((id) => typeof id === 'string'));
        res.json({ success: true, sessions: newState.sessions || [] });
    });
}

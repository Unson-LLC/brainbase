import { logger } from '../utils/logger.js';
import { asyncHandler } from '../lib/async-handler.js';
import { pickAllowedFields } from '../lib/validation.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

/**
 * StateController
 * 状態管理のHTTPリクエスト処理
 */

// セッションオブジェクトの許可フィールド
const ALLOWED_SESSION_FIELDS = [
    // 基本情報
    'id', 'name', 'path', 'cwd', 'worktree', 'initialCommand',
    'engine', 'intendedState', 'createdAt', 'archivedAt', 'merged', 'mergedAt',
    'updatedAt', 'taskBrief', 'taskBriefUpdatedAt', 'lastAssistantSnippet', 'lastAssistantSnippetAt',
    // Schema v2 追加フィールド
    'lastAccessedAt', 'pausedAt', 'pausedReason', 'tmuxMissingAt', 'tmuxCleanedAt',
    // Schema v3 追加フィールド
    'ttydProcess',
    // 状態管理フィールド
    'hookStatus',
    // スキャン生成フィールド
    'conversationSummary'
];

/**
 * セッションオブジェクトの検証
 * @param {Object} session - 検証対象セッション
 * @returns {Object|null} 検証済みセッション（不正フィールド除去）
 */
function validateSession(session) {
    if (!session?.id || typeof session.id !== 'string') {
        return null;
    }
    return pickAllowedFields(session, ALLOWED_SESSION_FIELDS);
}

export class StateController {
    constructor(stateStore, sessionManager, testMode = false) {
        this.stateStore = stateStore;
        this.sessionManager = sessionManager;
        this.testMode = testMode;
    }

    /** GET /api/state */
    get = asyncHandler(async (req, res) => {
        const ready = await this.sessionManager.waitUntilReady();
        if (!ready) {
            return res.status(503).json({ error: 'Service not ready' });
        }

        const state = this.stateStore.get();

        const sessionsWithStatus = (state.sessions || []).map(session => {
            const runtimeStatus = this.sessionManager.getRuntimeStatus(session);

            const { conversationSummary, ...rest } = session;
            const convLight = conversationSummary ? {
                totalConversations: conversationSummary.totalConversations || 0,
                lastActivity: conversationSummary.lastConversation?.lastActivity || null
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
    update = asyncHandler(async (req, res) => {
        if (!req.body || typeof req.body !== 'object') {
            throw AppError.validation('Invalid request body');
        }

        const rawSessions = req.body.sessions || [];
        if (!Array.isArray(rawSessions)) {
            throw AppError.validation('Sessions must be an array');
        }

        const validatedSessions = [];
        for (const session of rawSessions) {
            const { ttydRunning, runtimeStatus, ...persistentFields } = session;
            const validated = validateSession(persistentFields);
            if (validated) {
                validatedSessions.push(validated);
            } else {
                logger.warn('Invalid session object skipped', { sessionId: session?.id });
            }
        }

        const newState = await this.stateStore.update({
            ...req.body,
            sessions: validatedSessions
        });
        res.json(newState);
    });

    /** PATCH /api/state/sessions/:sessionId */
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

        const state = this.stateStore.get();
        const sessionIndex = (state.sessions || []).findIndex(s => s.id === sessionId);

        if (sessionIndex === -1) {
            throw new AppError('Session not found', ErrorCodes.SESSION_NOT_FOUND);
        }

        const updatedSessions = [...state.sessions];
        updatedSessions[sessionIndex] = {
            ...updatedSessions[sessionIndex],
            ...validated,
            updatedAt: new Date().toISOString()
        };

        const newState = await this.stateStore.update({
            ...state,
            sessions: updatedSessions
        });

        const updatedSession = newState.sessions.find(s => s.id === sessionId);
        res.json(updatedSession);
    });
}

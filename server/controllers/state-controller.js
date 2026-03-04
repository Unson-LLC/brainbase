import { logger } from '../utils/logger.js';

/**
 * StateController
 * 状態管理のHTTPリクエスト処理
 */

// セッションオブジェクトの許可フィールド
const ALLOWED_SESSION_FIELDS = [
    // 基本情報
    'id', 'name', 'path', 'cwd', 'worktree', 'initialCommand',
    'engine', 'intendedState', 'createdAt', 'archivedAt', 'merged', 'mergedAt',
    'updatedAt',
    // Schema v2 追加フィールド
    'lastAccessedAt', 'pausedAt', 'tmuxCleanedAt',
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
 * @returns {Object} 検証済みセッション（不正フィールド除去）
 */
function validateSession(session) {
    if (!session || typeof session !== 'object') {
        return null;
    }

    // id は必須かつ文字列
    if (!session.id || typeof session.id !== 'string') {
        return null;
    }

    // 許可されたフィールドのみ残す
    const validated = {};
    for (const key of ALLOWED_SESSION_FIELDS) {
        if (key in session) {
            validated[key] = session[key];
        }
    }
    return validated;
}

export class StateController {
    constructor(stateStore, sessionManager, testMode = false) {
        this.stateStore = stateStore;
        this.sessionManager = sessionManager;
        this.testMode = testMode;
    }

    /**
     * GET /api/state
     * アプリケーション状態を取得（ランタイムステータス付き）
     */
    get = async (req, res) => {
        try {
            const ready = await this.sessionManager.waitUntilReady();
            if (!ready) {
                res.status(503).json({ error: 'Service not ready' });
                return;
            }

            const state = this.stateStore.get();

            // Add runtime status to each session
            const sessionsWithStatus = (state.sessions || []).map(session => {
                const runtimeStatus = this.sessionManager.getRuntimeStatus(session);

                // conversationSummaryを軽量化（claudeLogDir等の重いフィールドを除外）
                const { conversationSummary, ...rest } = session;
                const convLight = conversationSummary ? {
                    totalConversations: conversationSummary.totalConversations || 0,
                    lastActivity: conversationSummary.lastConversation?.lastActivity || null
                } : undefined;

                return {
                    ...rest,
                    ...(convLight && { conversationSummary: convLight }),
                    // 後方互換性のためttydRunningも残す（将来削除予定）
                    ttydRunning: runtimeStatus.ttydRunning,
                    // 新しいruntimeStatus
                    runtimeStatus
                };
            });

            res.json({
                ...state,
                sessions: sessionsWithStatus,
                // テストモードフラグを追加
                testMode: this.testMode
            });
        } catch (error) {
            logger.error('Failed to get state', { error });
            res.status(500).json({ error: 'Failed to get state' });
        }
    };

    /**
     * POST /api/state
     * アプリケーション状態を更新
     */
    update = async (req, res) => {
        try {
            // 入力検証: req.body がオブジェクトであることを確認
            if (!req.body || typeof req.body !== 'object') {
                return res.status(400).json({ error: 'Invalid request body' });
            }

            // セッション配列の検証とサニタイズ
            const rawSessions = req.body.sessions || [];
            if (!Array.isArray(rawSessions)) {
                return res.status(400).json({ error: 'Sessions must be an array' });
            }

            const validatedSessions = [];
            for (const session of rawSessions) {
                // Remove runtime-only fields
                const { ttydRunning, runtimeStatus, ...persistentFields } = session;
                // セッション構造を検証
                const validated = validateSession(persistentFields);
                if (validated) {
                    validatedSessions.push(validated);
                } else {
                    logger.warn('Invalid session object skipped', { sessionId: session?.id });
                }
            }

            const sanitizedState = {
                ...req.body,
                sessions: validatedSessions
            };

            const newState = await this.stateStore.update(sanitizedState);
            res.json(newState);
        } catch (error) {
            logger.error('Failed to update state', { error });
            res.status(500).json({ error: 'Failed to update state' });
        }
    };

    /**
     * PATCH /api/state/sessions/:sessionId
     * 単一セッションの部分更新
     */
    patch = async (req, res) => {
        try {
            const { sessionId } = req.params;
            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID required' });
            }

            // 入力検証
            if (!req.body || typeof req.body !== 'object') {
                return res.status(400).json({ error: 'Invalid request body' });
            }

            // Runtime-only fields を除去
            const { ttydRunning, runtimeStatus, ...updateFields } = req.body;

            // 更新フィールドの検証
            const validated = validateSession({ id: sessionId, ...updateFields });
            if (!validated) {
                return res.status(400).json({ error: 'Invalid session data' });
            }

            // 現在の状態を取得
            const state = this.stateStore.get();
            const sessionIndex = (state.sessions || []).findIndex(s => s.id === sessionId);

            if (sessionIndex === -1) {
                return res.status(404).json({ error: 'Session not found' });
            }

            // セッションを部分更新
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

            // 更新されたセッションのみ返す
            const updatedSession = newState.sessions.find(s => s.id === sessionId);
            res.json(updatedSession);
        } catch (error) {
            logger.error('Failed to patch session', { error, sessionId: req.params.sessionId });
            res.status(500).json({ error: 'Failed to patch session' });
        }
    };
}

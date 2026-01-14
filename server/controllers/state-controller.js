import { logger } from '../utils/logger.js';

/**
 * StateController
 * 状態管理のHTTPリクエスト処理
 */

// セッションオブジェクトの許可フィールド
const ALLOWED_SESSION_FIELDS = [
    'id', 'name', 'path', 'cwd', 'worktree', 'initialCommand',
    'engine', 'intendedState', 'createdAt', 'archivedAt', 'merged', 'mergedAt',
    'updatedAt'
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
    constructor(stateStore, activeSessions, testMode = false) {
        this.stateStore = stateStore;
        this.activeSessions = activeSessions;
        this.testMode = testMode;
    }

    /**
     * GET /api/state
     * アプリケーション状態を取得（ランタイムステータス付き）
     */
    get = (req, res) => {
        try {
            const state = this.stateStore.get();

            // Add runtime status to each session
            const sessionsWithStatus = (state.sessions || []).map(session => {
                const ttydRunning = this.activeSessions.has(session.id);
                // 本来アクティブであるべきなのに停止している場合は再起動が必要
                const needsRestart = session.intendedState === 'active' && !ttydRunning;

                return {
                    ...session,
                    // 後方互換性のためttydRunningも残す（将来削除予定）
                    ttydRunning,
                    // 新しいruntimeStatus
                    runtimeStatus: {
                        ttydRunning,
                        needsRestart
                    }
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
}

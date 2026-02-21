import { logger } from '../utils/logger.js';
import { createHash } from 'crypto';

/**
 * StateController
 * 状態管理のHTTPリクエスト処理
 */
function nowMs() {
    return Number(process.hrtime.bigint() / 1000000n);
}

function getTraceId(req) {
    const header = req.headers['x-bb-trace-id'] || req.headers['x-trace-id'];
    return Array.isArray(header) ? header[0] : header || null;
}

function buildEtag(payload) {
    const hash = createHash('sha1')
        .update(JSON.stringify(payload))
        .digest('base64url');
    return `W/"${hash}"`;
}

function isNotModified(ifNoneMatchHeader, currentEtag) {
    if (!ifNoneMatchHeader || !currentEtag) return false;
    const raw = Array.isArray(ifNoneMatchHeader) ? ifNoneMatchHeader.join(',') : String(ifNoneMatchHeader);
    const tags = raw.split(',').map((v) => v.trim()).filter(Boolean);
    if (tags.includes('*')) return true;
    return tags.includes(currentEtag);
}

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
    'hookStatus'
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
            const traceId = getTraceId(req);
            const startedAt = nowMs();
            const readyWaitStart = nowMs();
            const ready = await this.sessionManager.waitUntilReady();
            const readyWaitMs = Math.max(0, nowMs() - readyWaitStart);
            if (!ready) {
                res.status(503).json({
                    error: 'Service not ready',
                    traceId,
                    timing: {
                        readyWaitMs,
                        totalMs: Math.max(0, nowMs() - startedAt)
                    }
                });
                return;
            }

            const state = this.stateStore.get();

            // activeSessions Mapを使ってPIDチェックをスキップ（O(1) lookup）
            // watchdogが定期的にプロセスヘルスを監視しているため、
            // GETレスポンスでは近似値で十分
            const activeSessions = this.sessionManager.getActiveSessions();
            const sessionsWithStatus = (state.sessions || []).map(session => {
                if (session.intendedState === 'active') {
                    const ttydRunning = activeSessions.has(session.id);
                    return {
                        ...session,
                        ttydRunning,
                        runtimeStatus: { ttydRunning, needsRestart: !ttydRunning }
                    };
                }
                // archived/paused: プロセス動いてない
                return {
                    ...session,
                    ttydRunning: false,
                    runtimeStatus: { ttydRunning: false, needsRestart: false }
                };
            });

            const payload = {
                ...state,
                sessions: sessionsWithStatus,
                // テストモードフラグを追加
                testMode: this.testMode
            };
            const etag = buildEtag(payload);
            const ifNoneMatch = req.headers['if-none-match'];

            const timing = {
                readyWaitMs,
                totalMs: Math.max(0, nowMs() - startedAt)
            };

            res.set('Cache-Control', 'private, no-cache, must-revalidate');
            res.set('ETag', etag);

            if (isNotModified(ifNoneMatch, etag)) {
                return res.status(304).end();
            }

            if (timing.totalMs > 500) {
                logger.warn('Slow GET /api/state', { traceId, timing });
            }

            res.json({
                ...payload,
                traceId,
                timing,
                etag
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
            const updates = req.body;
            if (!sessionId || typeof sessionId !== 'string') {
                return res.status(400).json({ error: 'Invalid sessionId' });
            }
            const state = this.stateStore.get();
            const sessions = state.sessions || [];
            const index = sessions.findIndex(s => s.id === sessionId);
            if (index === -1) {
                return res.status(404).json({ error: 'Session not found' });
            }
            // 許可フィールドのみマージ
            const validated = validateSession({ ...sessions[index], ...updates });
            if (!validated) {
                return res.status(400).json({ error: 'Invalid session data' });
            }
            sessions[index] = validated;
            await this.stateStore.update({ ...state, sessions });
            res.json({ success: true, session: validated });
        } catch (error) {
            logger.error('Failed to patch session', { error });
            res.status(500).json({ error: 'Failed to patch session' });
        }
    };
}

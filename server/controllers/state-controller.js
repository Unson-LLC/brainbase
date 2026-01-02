/**
 * StateController
 * 状態管理のHTTPリクエスト処理
 */
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
            console.error('Failed to get state:', error);
            res.status(500).json({ error: 'Failed to get state' });
        }
    };

    /**
     * POST /api/state
     * アプリケーション状態を更新
     */
    update = async (req, res) => {
        try {
            // Remove computed fields from sessions before persisting
            const sanitizedState = {
                ...req.body,
                sessions: (req.body.sessions || []).map(session => {
                    // Remove runtime-only fields
                    const { ttydRunning, runtimeStatus, ...persistentFields } = session;
                    return persistentFields;
                })
            };

            const newState = await this.stateStore.update(sanitizedState);
            res.json(newState);
        } catch (error) {
            console.error('Failed to update state:', error);
            res.status(500).json({ error: 'Failed to update state' });
        }
    };
}

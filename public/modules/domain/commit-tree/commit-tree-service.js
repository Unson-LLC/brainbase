/**
 * CommitTreeService
 * コミットログの取得とStore更新を管理
 */
import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

export class CommitTreeService {
    /**
     * セッションのコミットログを取得
     * @param {string} sessionId - セッションID
     * @param {number} [limit=50] - 取得件数
     * @returns {Promise<void>}
     */
    async loadCommitLog(sessionId, limit = 50) {
        if (!sessionId) {
            appStore.setState({ commitLog: null });
            eventBus.emit(EVENTS.COMMIT_LOG_LOADED, { commits: [], repoType: null });
            return;
        }

        try {
            const result = await httpClient.get(`/api/sessions/${sessionId}/commit-log?limit=${limit}`);
            appStore.setState({ commitLog: result });
            eventBus.emit(EVENTS.COMMIT_LOG_LOADED, result);
        } catch (err) {
            // worktreeなしセッション等は400エラーが正常
            appStore.setState({ commitLog: null });
            eventBus.emit(EVENTS.COMMIT_LOG_LOADED, { commits: [], repoType: null, error: err.message });
        }
    }
}

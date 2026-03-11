/**
 * Session Routes
 * セッション管理のルーティング
 */
import express from 'express';
import { SessionController } from '../controllers/session-controller.js';
import { retroactiveRename } from '../utils/session-name-generator.js';

/**
 * Session router factory
 * @param {SessionManager} sessionManager - SessionManagerインスタンス
 * @param {WorktreeService} worktreeService - WorktreeServiceインスタンス
 * @param {StateStore} stateStore - StateStoreインスタンス
 * @param {boolean} [testMode=false] - テストモードフラグ
 * @param {ConversationLinker} [conversationLinker] - ConversationLinkerインスタンス
 * @returns {express.Router}
 */
export function createSessionRouter(sessionManager, worktreeService, stateStore, testMode = false, conversationLinker = null) {
    const router = express.Router();
    const controller = new SessionController(sessionManager, worktreeService, stateStore);

    // ========================================
    // Activity & Status
    // ========================================
    router.post('/report_activity', controller.reportActivity);
    router.get('/status', controller.getStatus);
    router.post('/:id/clear-done', controller.clearDone);
    router.get('/:id/runtime', controller.getRuntime);
    router.get('/:id', controller.get);

    // ========================================
    // Process Management
    // ========================================
    router.post('/start', controller.start);
    router.post('/:id/stop', controller.stop);
    router.post('/:id/archive', controller.archive);
    router.post('/:id/restore', controller.restore);
    router.post('/:id/ask-ai-integration', controller.askAiIntegration);

    // ========================================
    // Terminal I/O
    // ========================================
    router.post('/:id/input', controller.sendInput);
    router.post('/:id/scroll', controller.scroll);
    router.post('/:id/select_pane', controller.selectPane);
    router.post('/:id/exit_copy_mode', controller.exitCopyMode);
    router.get('/:id/content', controller.getContent);
    router.get('/:id/output', controller.getOutput);

    // ========================================
    // Session Name Management
    // ========================================

    /**
     * POST /api/sessions/retroactive-rename
     * 全セッションの遡及リネーム（名前が空 or session-{ts} 形式のものを自動命名）
     */
    router.post('/retroactive-rename', async (req, res) => {
        try {
            const state = stateStore.get();
            const sessions = state.sessions || [];

            const renamed = retroactiveRename(sessions);

            // 変更があったかチェック
            let changeCount = 0;
            for (let i = 0; i < sessions.length; i++) {
                if (sessions[i].name !== renamed[i].name) changeCount++;
            }

            if (changeCount > 0) {
                await stateStore.update({ ...state, sessions: renamed });
                console.log(`[Sessions] Retroactive rename: ${changeCount}/${sessions.length} session(s) renamed`);
            }

            res.json({ success: true, renamed: changeCount, total: sessions.length });
        } catch (err) {
            console.error('[Sessions] Retroactive rename failed:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ========================================
    // Conversation Log API
    // ========================================
    if (conversationLinker) {
        /**
         * GET /api/sessions/:id/conversations
         * セッションに紐付く会話ログ一覧を取得（オンデマンド詳細取得）
         */
        router.get('/:id/conversations', async (req, res) => {
            try {
                const result = await conversationLinker.getConversationsForSession(req.params.id);
                res.json(result);
            } catch (err) {
                console.error(`[Sessions] Failed to get conversations for ${req.params.id}:`, err.message);
                res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
            }
        });

        /**
         * POST /api/sessions/link-conversations
         * 全セッションの会話ログ紐付けを再実行
         */
        router.post('/link-conversations', async (req, res) => {
            try {
                const result = await conversationLinker.linkAll();
                res.json(result);
            } catch (err) {
                console.error('[Sessions] Failed to link conversations:', err.message);
                res.status(500).json({ error: err.message });
            }
        });
    }

    // ========================================
    // Worktree Operations
    // ========================================
    router.post('/create-with-worktree', controller.createWithWorktree);
    router.get('/:id/progress', controller.getProgress);
    router.get('/:id/worktree-status', controller.getWorktreeStatus);
    router.get('/:id/context', controller.getContext);
    router.get('/:id/folder-tree', controller.getFolderTree);
    router.get('/:id/commit-log', controller.getCommitLog);
    router.post('/:id/commit-notify', controller.commitNotify);
    router.get('/:id/commit-notify', controller.getCommitNotify);
    router.post('/:id/update-local-main', controller.updateLocalMain);
    router.post('/:id/merge', controller.merge);
    router.delete('/:id/worktree', controller.deleteWorktree);

    return router;
}

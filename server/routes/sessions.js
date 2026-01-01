/**
 * Session Routes
 * セッション管理のルーティング
 */
import express from 'express';
import { SessionController } from '../controllers/session-controller.js';

/**
 * Session router factory
 * @param {SessionManager} sessionManager - SessionManagerインスタンス
 * @param {WorktreeService} worktreeService - WorktreeServiceインスタンス
 * @param {StateStore} stateStore - StateStoreインスタンス
 * @param {boolean} testMode - テストモード（読み取り専用）
 * @returns {express.Router}
 */
export function createSessionRouter(sessionManager, worktreeService, stateStore, testMode = false) {
    const router = express.Router();
    const controller = new SessionController(sessionManager, worktreeService, stateStore);

    /**
     * Test Mode Middleware
     * 書き込み操作を禁止し、403エラーを返す
     */
    const testModeGuard = (req, res, next) => {
        if (testMode) {
            return res.status(403).json({
                error: 'Session management is disabled in test mode',
                message: 'This server is running in read-only mode for E2E testing and UI verification'
            });
        }
        next();
    };

    // ========================================
    // Activity & Status (読み取り専用 - 常に許可)
    // ========================================
    router.post('/report_activity', controller.reportActivity);
    router.get('/status', controller.getStatus);

    // ========================================
    // Process Management (書き込み操作 - テストモードで禁止)
    // ========================================
    router.post('/start', testModeGuard, controller.start);
    router.post('/:id/stop', testModeGuard, controller.stop);
    router.post('/:id/archive', testModeGuard, controller.archive);
    router.post('/:id/restore', testModeGuard, controller.restore);

    // ========================================
    // Terminal I/O (書き込み操作はテストモードで禁止、読み取りは許可)
    // ========================================
    router.post('/:id/input', testModeGuard, controller.sendInput);
    router.get('/:id/content', controller.getContent);
    router.get('/:id/output', controller.getOutput);

    // ========================================
    // Worktree Operations (書き込み操作 - テストモードで禁止)
    // ========================================
    router.post('/create-with-worktree', testModeGuard, controller.createWithWorktree);
    router.get('/:id/worktree-status', controller.getWorktreeStatus);
    router.post('/:id/fix-symlinks', testModeGuard, controller.fixSymlinks);
    router.post('/:id/merge', testModeGuard, controller.merge);
    router.delete('/:id/worktree', testModeGuard, controller.deleteWorktree);

    return router;
}

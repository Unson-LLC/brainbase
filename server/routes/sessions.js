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
 * @returns {express.Router}
 */
export function createSessionRouter(sessionManager, worktreeService, stateStore) {
    const router = express.Router();
    const controller = new SessionController(sessionManager, worktreeService, stateStore);

    // ========================================
    // Activity & Status
    // ========================================
    router.post('/report_activity', controller.reportActivity);
    router.get('/status', controller.getStatus);

    // ========================================
    // Process Management
    // ========================================
    router.post('/start', controller.start);
    router.post('/:id/stop', controller.stop);
    router.post('/:id/archive', controller.archive);
    router.post('/:id/restore', controller.restore);

    // ========================================
    // Terminal I/O
    // ========================================
    router.post('/:id/input', controller.sendInput);
    router.post('/:id/scroll', controller.scroll);
    router.post('/:id/exit_copy_mode', controller.exitCopyMode);
    router.get('/:id/content', controller.getContent);
    router.get('/:id/output', controller.getOutput);

    // ========================================
    // Worktree Operations
    // ========================================
    router.post('/create-with-worktree', controller.createWithWorktree);
    router.get('/:id/worktree-status', controller.getWorktreeStatus);
    router.post('/:id/merge', controller.merge);
    router.delete('/:id/worktree', controller.deleteWorktree);

    // ========================================
    // ZEP Integration
    // ========================================
    router.post('/save_to_zep', controller.saveToZep);
    router.get('/zep/list', controller.listZepSessions);
    router.get('/zep/:sessionId/memory', controller.getZepMemory);

    return router;
}

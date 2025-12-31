import express from 'express';
import { GitHubService } from '../services/github-service.js';
import { SystemService } from '../services/system-service.js';
import { StorageService } from '../services/storage-service.js';

/**
 * brainbaseダッシュボードAPIルーター
 * システム全体の監視情報を提供
 */
export function createBrainbaseRouter(options = {}) {
    const router = express.Router();
    const { taskParser, worktreeService } = options;

    const githubService = new GitHubService();
    const systemService = new SystemService();
    const storageService = new StorageService();

    /**
     * GET /api/brainbase
     * すべての監視情報を一括取得
     */
    router.get('/', async (req, res) => {
        try {
            const [github, system, storage, tasks, worktrees] = await Promise.all([
                getGitHubInfo(),
                systemService.getSystemStatus(),
                storageService.getStorageSummary(),
                getTasksInfo(),
                getWorktreesInfo(),
            ]);

            res.json({
                github,
                system,
                storage,
                tasks,
                worktrees,
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            console.error('[BrainbaseRouter] Error fetching dashboard data:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/brainbase/github/runners
     * GitHub Actionsセルフホストランナー情報
     */
    router.get('/github/runners', async (req, res) => {
        try {
            const runners = await githubService.getSelfHostedRunners();
            res.json(runners);
        } catch (error) {
            console.error('[BrainbaseRouter] Error fetching runners:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/brainbase/github/workflows
     * GitHub Actionsワークフロー実行履歴
     */
    router.get('/github/workflows', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 10;
            const workflows = await githubService.getWorkflowRuns(limit);
            res.json(workflows);
        } catch (error) {
            console.error('[BrainbaseRouter] Error fetching workflows:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/brainbase/system
     * システムリソース情報
     */
    router.get('/system', async (req, res) => {
        try {
            const system = await systemService.getSystemStatus();
            res.json(system);
        } catch (error) {
            console.error('[BrainbaseRouter] Error fetching system status:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/brainbase/storage
     * ストレージ情報
     */
    router.get('/storage', async (req, res) => {
        try {
            const storage = await storageService.getStorageSummary();
            res.json(storage);
        } catch (error) {
            console.error('[BrainbaseRouter] Error fetching storage info:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/brainbase/tasks
     * タスク管理ステータス
     */
    router.get('/tasks', async (req, res) => {
        try {
            const tasks = await getTasksInfo();
            res.json(tasks);
        } catch (error) {
            console.error('[BrainbaseRouter] Error fetching tasks:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/brainbase/worktrees
     * Worktree情報
     */
    router.get('/worktrees', async (req, res) => {
        try {
            const worktrees = await getWorktreesInfo();
            res.json(worktrees);
        } catch (error) {
            console.error('[BrainbaseRouter] Error fetching worktrees:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // ==================== Helper Functions ====================

    /**
     * GitHub情報取得（ランナー + ワークフロー）
     */
    async function getGitHubInfo() {
        const [runners, workflows] = await Promise.all([
            githubService.getSelfHostedRunners(),
            githubService.getWorkflowRuns(5),
        ]);

        return {
            runners,
            workflows,
        };
    }

    /**
     * タスク管理ステータス取得
     */
    async function getTasksInfo() {
        if (!taskParser) {
            return { error: 'TaskParser not initialized' };
        }

        try {
            const tasks = await taskParser.getTasks();
            const total = tasks.length;
            const completed = tasks.filter(t => t.status === 'completed').length;
            const inProgress = tasks.filter(t => t.status === 'in_progress').length;
            const pending = tasks.filter(t => t.status === 'pending').length;
            const blocked = tasks.filter(t => t.status === 'blocked').length;

            // 期限切れタスク
            const now = new Date();
            const overdue = tasks.filter(t => {
                if (t.status === 'completed') return false;
                if (!t.deadline) return false;
                return new Date(t.deadline) < now;
            });

            // 今日のフォーカスタスク
            const focus = tasks.find(t => t.focus) || null;

            return {
                total,
                completed,
                inProgress,
                pending,
                blocked,
                overdue: overdue.length,
                overdueList: overdue.slice(0, 5).map(t => ({
                    title: t.title,
                    deadline: t.deadline,
                    status: t.status,
                })),
                focus: focus ? {
                    title: focus.title,
                    status: focus.status,
                    deadline: focus.deadline,
                } : null,
            };
        } catch (error) {
            console.error('[BrainbaseRouter] Error parsing tasks:', error);
            return { error: error.message };
        }
    }

    /**
     * Worktree情報取得
     */
    async function getWorktreesInfo() {
        if (!worktreeService) {
            return { error: 'WorktreeService not initialized' };
        }

        try {
            const worktrees = await worktreeService.listWorktrees();
            const active = worktrees.filter(w => w.branch !== 'main' && w.branch !== 'master');

            // 未コミットの変更があるworktree
            const uncommitted = [];
            for (const wt of active) {
                // TODO: git statusコマンドで未コミット確認
                // 現時点では簡易実装
            }

            return {
                total: worktrees.length,
                active: active.length,
                uncommitted: uncommitted.length,
                list: active.slice(0, 5).map(wt => ({
                    branch: wt.branch,
                    path: wt.path,
                })),
            };
        } catch (error) {
            console.error('[BrainbaseRouter] Error getting worktrees:', error);
            return { error: error.message };
        }
    }

    return router;
}

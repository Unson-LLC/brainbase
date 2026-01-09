import express from 'express';
import { GitHubService } from '../services/github-service.js';
import { SystemService } from '../services/system-service.js';
import { StorageService } from '../services/storage-service.js';
import { NocoDBService } from '../services/nocodb-service.js';
import { logger } from '../utils/logger.js';

/**
 * brainbaseダッシュボードAPIルーター
 * システム全体の監視情報を提供
 */
export function createBrainbaseRouter(options = {}) {
    const router = express.Router();
    const { taskParser, worktreeService, configParser } = options;

    const githubService = new GitHubService();
    const systemService = new SystemService();
    const storageService = new StorageService();
    const nocodbService = new NocoDBService();

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
            logger.error('Error fetching dashboard data', { error });
            res.status(500).json({ error: 'Failed to fetch dashboard data' });
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
            logger.error('Error fetching runners', { error });
            res.status(500).json({ error: 'Failed to fetch runners' });
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
            logger.error('Error fetching workflows', { error });
            res.status(500).json({ error: 'Failed to fetch workflows' });
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
            logger.error('Error fetching system status', { error });
            res.status(500).json({ error: 'Failed to fetch system status' });
        }
    });

    /**
     * GET /api/brainbase/system-health
     * healthcheckワークフローの実行結果取得（mana + runners）
     */
    router.get('/system-health', async (req, res) => {
        try {
            const healthStatus = await githubService.getHealthcheckStatus();
            res.json({
                success: true,
                data: healthStatus,
            });
        } catch (error) {
            logger.error('Error fetching system health', { error });
            res.status(500).json({
                success: false,
                error: 'Failed to fetch system health',
            });
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
            logger.error('Error fetching storage info', { error });
            res.status(500).json({ error: 'Failed to fetch storage info' });
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
            logger.error('Error fetching tasks', { error });
            res.status(500).json({ error: 'Failed to fetch tasks' });
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
            logger.error('Error fetching worktrees', { error });
            res.status(500).json({ error: 'Failed to fetch worktrees' });
        }
    });

    /**
     * GET /api/brainbase/projects
     * 全プロジェクトの健全性スコアを返却（NocoDB実データ使用）
     */
    router.get('/projects', async (req, res) => {
        try {
            // 1. config.ymlからプロジェクト一覧（project_id必須）
            const config = await configParser.getAll();
            const projects = (config.projects?.projects || [])
                .filter(p => !p.archived && p.nocodb?.project_id)
                .map(p => ({ id: p.id, project_id: p.nocodb.project_id }));

            // 2. NocoDBから統計取得
            const stats = await Promise.all(
                projects.map(p => nocodbService.getProjectStats(p.project_id))
            );

            // 3. 健全性スコア計算
            const healthScores = stats.map((stat, i) => {
                const taskCompletion = stat.completionRate || 0;
                const overdueScore = Math.max(0, 100 - (stat.overdue * 10));
                const blockedScore = Math.max(0, 100 - (stat.blocked * 20));
                const milestoneProgress = stat.averageProgress || 0;

                const healthScore = Math.round(
                    (taskCompletion * 0.3) +
                    (overdueScore * 0.2) +
                    (blockedScore * 0.2) +
                    (milestoneProgress * 0.3)
                );

                return {
                    name: projects[i].id,
                    healthScore,
                    overdue: stat.overdue,
                    blocked: stat.blocked,
                    completionRate: taskCompletion,
                    manaScore: 92 // 固定値（Phase 3でmana統合）
                };
            });

            res.json(healthScores.sort((a, b) => b.healthScore - a.healthScore));
        } catch (error) {
            logger.error('Failed to fetch projects', { error });
            res.status(500).json({ error: 'Failed to fetch projects' });
        }
    });

    /**
     * GET /api/brainbase/critical-alerts
     * Critical Alerts取得（ブロッカー + 期限超過タスク）
     */
    router.get('/critical-alerts', async (req, res) => {
        try {
            // 1. config.ymlからプロジェクト一覧（project_id必須）
            const config = await configParser.getAll();
            const projects = (config.projects?.projects || [])
                .filter(p => !p.archived && p.nocodb?.project_id)
                .map(p => ({ id: p.id, project_id: p.nocodb.project_id }));

            // 2. NocoDBからCritical Alerts取得
            const alerts = await nocodbService.getCriticalAlerts(projects);

            res.json(alerts);
        } catch (error) {
            logger.error('Failed to fetch critical alerts', { error });
            res.status(500).json({ error: 'Failed to fetch critical alerts' });
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
            logger.error('Error parsing tasks', { error });
            return { error: 'Failed to parse tasks' };
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
            logger.error('Error getting worktrees', { error });
            return { error: 'Failed to get worktrees' };
        }
    }

    return router;
}

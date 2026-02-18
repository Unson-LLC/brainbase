/**
 * Goal Seek Routes
 * Goal Seek機能のAPIルーティング
 */
import express from 'express';

/**
 * Goal Seek router factory
 * @param {GoalSeekStore} store - GoalSeekStoreインスタンス
 * @returns {express.Router}
 */
export function createGoalSeekRouter(store) {
    const router = express.Router();

    /**
     * 共通の必須項目チェック
     * @param {express.Response} res
     * @param {object} source - リクエストbodyやquery
     * @param {string[]} fields - 必須キー
     * @returns {boolean} trueの場合レスポンス済み（以降処理中断）
     */
    const respondIfMissingFields = (res, source, fields) => {
        const data = source || {};
        const missing = fields.filter((field) => !data[field]);
        if (missing.length > 0) {
            res.status(400).json({
                error: `Missing required fields: ${missing.join(', ')}`
            });
            return true;
        }
        return false;
    };

    const handleServerError = (res, error, action) => {
        console.error(`Failed to ${action}:`, error);
        res.status(500).json({ error: error.message });
    };

    // ========================================
    // Goals API
    // ========================================

    /**
     * POST /api/goal-seek/goals
     * ゴール作成
     */
    router.post('/goals', async (req, res) => {
        try {
            const { sessionId, goalType, target } = req.body;

            // バリデーション
            if (respondIfMissingFields(res, req.body, ['sessionId', 'goalType', 'target'])) {
                return;
            }

            const goal = await store.createGoal(req.body);
            res.status(201).json(goal);
        } catch (error) {
            handleServerError(res, error, 'create goal');
        }
    });

    /**
     * GET /api/goal-seek/goals/:id
     * ゴール取得
     */
    router.get('/goals/:id', async (req, res) => {
        try {
            const goal = await store.getGoal(req.params.id);

            if (!goal) {
                return res.status(404).json({ error: 'Goal not found' });
            }

            res.json(goal);
        } catch (error) {
            handleServerError(res, error, 'get goal');
        }
    });

    /**
     * PUT /api/goal-seek/goals/:id
     * ゴール更新
     */
    router.put('/goals/:id', async (req, res) => {
        try {
            const goal = await store.updateGoal(req.params.id, req.body);

            if (!goal) {
                return res.status(404).json({ error: 'Goal not found' });
            }

            res.json(goal);
        } catch (error) {
            handleServerError(res, error, 'update goal');
        }
    });

    /**
     * DELETE /api/goal-seek/goals/:id
     * ゴール削除
     */
    router.delete('/goals/:id', async (req, res) => {
        try {
            const deleted = await store.deleteGoal(req.params.id);

            if (!deleted) {
                return res.status(404).json({ error: 'Goal not found' });
            }

            res.json({ success: true });
        } catch (error) {
            handleServerError(res, error, 'delete goal');
        }
    });

    /**
     * GET /api/goal-seek/goals
     * ゴール一覧取得（sessionIdでフィルタ可能）
     */
    router.get('/goals', async (req, res) => {
        try {
            const { sessionId } = req.query;

            const goals = sessionId
                ? await store.getGoalsBySession(sessionId)
                : await store.getAllGoals();

            res.json(goals);
        } catch (error) {
            handleServerError(res, error, 'get goals');
        }
    });

    // ========================================
    // Interventions API
    // ========================================

    /**
     * POST /api/goal-seek/interventions
     * 介入作成
     */
    router.post('/interventions', async (req, res) => {
        try {
            const { goalId, type } = req.body;

            if (respondIfMissingFields(res, req.body, ['goalId', 'type'])) {
                return;
            }

            const intervention = await store.createIntervention(req.body);
            res.status(201).json(intervention);
        } catch (error) {
            handleServerError(res, error, 'create intervention');
        }
    });

    /**
     * GET /api/goal-seek/interventions/:id
     * 介入取得
     */
    router.get('/interventions/:id', async (req, res) => {
        try {
            const intervention = await store.getIntervention(req.params.id);

            if (!intervention) {
                return res.status(404).json({ error: 'Intervention not found' });
            }

            res.json(intervention);
        } catch (error) {
            handleServerError(res, error, 'get intervention');
        }
    });

    /**
     * PUT /api/goal-seek/interventions/:id
     * 介入更新
     */
    router.put('/interventions/:id', async (req, res) => {
        try {
            const intervention = await store.updateIntervention(req.params.id, req.body);

            if (!intervention) {
                return res.status(404).json({ error: 'Intervention not found' });
            }

            res.json(intervention);
        } catch (error) {
            handleServerError(res, error, 'update intervention');
        }
    });

    /**
     * GET /api/goal-seek/interventions
     * 介入一覧取得
     */
    router.get('/interventions', async (req, res) => {
        try {
            const { status } = req.query;

            const interventions = status === 'pending'
                ? await store.getPendingInterventions()
                : Array.from((await store.getAllGoals()).values());

            res.json(interventions || []);
        } catch (error) {
            handleServerError(res, error, 'get interventions');
        }
    });

    // ========================================
    // Logs API
    // ========================================

    /**
     * POST /api/goal-seek/logs
     * ログ作成
     */
    router.post('/logs', async (req, res) => {
        try {
            const { goalId, phase, action } = req.body;

            if (respondIfMissingFields(res, req.body, ['goalId', 'phase', 'action'])) {
                return;
            }

            const log = await store.createLog(req.body);
            res.status(201).json(log);
        } catch (error) {
            handleServerError(res, error, 'create log');
        }
    });

    /**
     * GET /api/goal-seek/logs
     * ログ一覧取得
     */
    router.get('/logs', async (req, res) => {
        try {
            const { goalId } = req.query;

            const logs = goalId
                ? await store.getLogsByGoal(goalId)
                : [];

            res.json(logs);
        } catch (error) {
            handleServerError(res, error, 'get logs');
        }
    });

    return router;
}

export default createGoalSeekRouter;

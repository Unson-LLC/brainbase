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
            if (!sessionId || !goalType || !target) {
                return res.status(400).json({
                    error: 'Missing required fields: sessionId, goalType, target'
                });
            }

            const goal = await store.createGoal(req.body);
            res.status(201).json(goal);
        } catch (error) {
            console.error('Failed to create goal:', error);
            res.status(500).json({ error: error.message });
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
            console.error('Failed to get goal:', error);
            res.status(500).json({ error: error.message });
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
            console.error('Failed to update goal:', error);
            res.status(500).json({ error: error.message });
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
            console.error('Failed to delete goal:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/goal-seek/goals
     * ゴール一覧取得（sessionIdでフィルタ可能）
     */
    router.get('/goals', async (req, res) => {
        try {
            const { sessionId } = req.query;

            let goals;
            if (sessionId) {
                goals = await store.getGoalsBySession(sessionId);
            } else {
                goals = await store.getAllGoals();
            }

            res.json(goals);
        } catch (error) {
            console.error('Failed to get goals:', error);
            res.status(500).json({ error: error.message });
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
            const { goalId, type, reason, choices } = req.body;

            if (!goalId || !type) {
                return res.status(400).json({
                    error: 'Missing required fields: goalId, type'
                });
            }

            const intervention = await store.createIntervention(req.body);
            res.status(201).json(intervention);
        } catch (error) {
            console.error('Failed to create intervention:', error);
            res.status(500).json({ error: error.message });
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
            console.error('Failed to get intervention:', error);
            res.status(500).json({ error: error.message });
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
            console.error('Failed to update intervention:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/goal-seek/interventions
     * 介入一覧取得
     */
    router.get('/interventions', async (req, res) => {
        try {
            const { status } = req.query;

            let interventions;
            if (status === 'pending') {
                interventions = await store.getPendingInterventions();
            } else {
                interventions = Array.from((await store.getAllGoals()).values());
            }

            res.json(interventions || []);
        } catch (error) {
            console.error('Failed to get interventions:', error);
            res.status(500).json({ error: error.message });
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

            if (!goalId || !phase || !action) {
                return res.status(400).json({
                    error: 'Missing required fields: goalId, phase, action'
                });
            }

            const log = await store.createLog(req.body);
            res.status(201).json(log);
        } catch (error) {
            console.error('Failed to create log:', error);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * GET /api/goal-seek/logs
     * ログ一覧取得
     */
    router.get('/logs', async (req, res) => {
        try {
            const { goalId } = req.query;

            let logs;
            if (goalId) {
                logs = await store.getLogsByGoal(goalId);
            } else {
                logs = [];
            }

            res.json(logs);
        } catch (error) {
            console.error('Failed to get logs:', error);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

export default createGoalSeekRouter;

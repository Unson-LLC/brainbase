/**
 * Goal Seek V2 Routes
 *
 * セッション・オートパイロット API
 *
 * エンドポイント:
 * - POST   /api/goal-seek/goals              - ゴール作成
 * - GET    /api/goal-seek/goals              - ゴール一覧
 * - GET    /api/goal-seek/goals/:id          - ゴール詳細
 * - PUT    /api/goal-seek/goals/:id          - ゴール更新
 * - DELETE /api/goal-seek/goals/:id          - ゴール削除
 * - POST   /api/goal-seek/goals/:id/start-monitor - 監視開始
 * - POST   /api/goal-seek/goals/:id/stop-monitor  - 監視停止
 * - GET    /api/goal-seek/goals/:id/problems      - 問題一覧
 * - GET    /api/goal-seek/goals/:id/timeline      - タイムライン
 * - POST   /api/goal-seek/escalations/:id/respond - エスカレーション回答
 * - GET    /api/goal-seek/status                  - サービスステータス
 */
import express from 'express';

export function createGoalSeekRouter({ goalStore, sessionMonitor, managerAI }) {
    const router = express.Router();

    // ========== Status ==========

    router.get('/status', (req, res) => {
        const monitoredSessions = sessionMonitor?.getMonitoredSessions() || [];
        const goals = goalStore.getAllGoals();

        res.json({
            status: 'available',
            version: 'v2',
            activeGoals: goals.filter(g => g.status === 'active' || g.status === 'monitoring').length,
            monitoredSessions: monitoredSessions.length,
            totalGoals: goals.length,
            timestamp: new Date().toISOString()
        });
    });

    // ========== Goal CRUD ==========

    router.post('/goals', async (req, res) => {
        try {
            const { sessionId, title, description, criteria, managerConfig } = req.body;

            if (!sessionId) {
                return res.status(400).json({ error: 'sessionId is required' });
            }
            if (!title) {
                return res.status(400).json({ error: 'title is required' });
            }

            const goal = await goalStore.createGoal({ sessionId, title, description, criteria, managerConfig });
            res.status(201).json(goal);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get('/goals', (req, res) => {
        const { sessionId } = req.query;

        let goals = goalStore.getAllGoals();

        // セッションIDが指定されている場合、そのセッションのゴールのみを返す
        if (sessionId) {
            goals = goals.filter(g => g.sessionId === sessionId);
        }

        res.json(goals);
    });

    router.get('/goals/:id', (req, res) => {
        const goal = goalStore.getGoal(req.params.id);
        if (!goal) {
            return res.status(404).json({ error: 'Goal not found' });
        }
        res.json(goal);
    });

    router.put('/goals/:id', async (req, res) => {
        const goal = await goalStore.updateGoal(req.params.id, req.body);
        if (!goal) {
            return res.status(404).json({ error: 'Goal not found' });
        }
        res.json(goal);
    });

    router.delete('/goals/:id', async (req, res) => {
        // 監視中なら停止
        const goal = goalStore.getGoal(req.params.id);
        if (goal && sessionMonitor) {
            sessionMonitor.stopMonitoring(goal.sessionId);
        }

        const deleted = await goalStore.deleteGoal(req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'Goal not found' });
        }
        res.json({ deleted: true });
    });

    // ========== Monitoring ==========

    router.post('/goals/:id/start-monitor', async (req, res) => {
        const goal = goalStore.getGoal(req.params.id);
        if (!goal) {
            return res.status(404).json({ error: 'Goal not found' });
        }

        if (!sessionMonitor) {
            return res.status(503).json({ error: 'SessionMonitor not available' });
        }

        await goalStore.updateGoal(goal.id, { status: 'monitoring' });
        sessionMonitor.startMonitoring(goal.sessionId, goal);

        res.json({ monitoring: true, goalId: goal.id, sessionId: goal.sessionId });
    });

    router.post('/goals/:id/stop-monitor', async (req, res) => {
        const goal = goalStore.getGoal(req.params.id);
        if (!goal) {
            return res.status(404).json({ error: 'Goal not found' });
        }

        if (sessionMonitor) {
            sessionMonitor.stopMonitoring(goal.sessionId);
        }
        await goalStore.updateGoal(goal.id, { status: 'active' });

        res.json({ monitoring: false, goalId: goal.id });
    });

    // ========== Problems ==========

    router.get('/goals/:id/problems', (req, res) => {
        const goal = goalStore.getGoal(req.params.id);
        if (!goal) {
            return res.status(404).json({ error: 'Goal not found' });
        }
        const problems = goalStore.getProblems(goal.id);
        res.json(problems);
    });

    // ========== Timeline ==========

    router.get('/goals/:id/timeline', (req, res) => {
        const goal = goalStore.getGoal(req.params.id);
        if (!goal) {
            return res.status(404).json({ error: 'Goal not found' });
        }
        const timeline = goalStore.getTimeline(goal.id);
        res.json(timeline);
    });

    // ========== Escalation ==========

    router.post('/escalations/:id/respond', async (req, res) => {
        try {
            const { choice, reason } = req.body;
            if (!choice) {
                return res.status(400).json({ error: 'choice is required' });
            }

            const escalation = await goalStore.respondToEscalation(req.params.id, {
                choice,
                reason: reason || '',
                respondedAt: new Date().toISOString()
            });

            if (!escalation) {
                return res.status(404).json({ error: 'Escalation not found' });
            }

            // ゴールステータスをactiveまたはmonitoringに戻す
            const goal = goalStore.getGoal(escalation.goalId);
            if (goal && goal.status === 'problem') {
                const isMonitoring = sessionMonitor?.getMonitoredSessions().includes(goal.sessionId);
                await goalStore.updateGoal(goal.id, { status: isMonitoring ? 'monitoring' : 'active' });
            }

            // タイムラインに記録
            await goalStore.addTimelineEntry({
                goalId: escalation.goalId,
                type: 'intervention',
                summary: `CEO回答: ${choice}`,
                details: reason || ''
            });

            res.json(escalation);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    return router;
}

export default createGoalSeekRouter;

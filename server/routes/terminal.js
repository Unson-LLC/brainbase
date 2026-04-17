import express from 'express';

export function createTerminalRouter({ terminalRuntimeReconciler }) {
    const router = express.Router();

    router.post('/reconcile', async (req, res) => {
        if (!terminalRuntimeReconciler?.reconcile) {
            return res.status(503).json({ error: 'terminal runtime reconciler is not available' });
        }
        try {
            const dryRun = req.body?.dryRun !== false;
            const recover = req.body?.recover === true;
            const sessionId = typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
                ? req.body.sessionId.trim()
                : null;
            const result = await terminalRuntimeReconciler.reconcile({ dryRun, recover, sessionId });
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : 'terminal reconcile failed' });
        }
    });

    return router;
}

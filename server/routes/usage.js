import express from 'express';

export function createUsageRouter(tokenUsageService) {
    const router = express.Router();

    router.get('/tokens/weekly', async (req, res, next) => {
        try {
            const force = req.query.force === '1' || req.query.force === 'true';
            const usage = await tokenUsageService.getWeeklyUsage({ force });
            res.json(usage);
        } catch (error) {
            next(error);
        }
    });

    return router;
}

import express from 'express';

export function createRetiredCapabilityRouter({
    capability,
    owner,
    replacement
}) {
    const router = express.Router();

    router.use((req, res) => {
        res.status(410).json({
            error: 'capability_retired',
            capability,
            owner,
            replacement
        });
    });

    return router;
}

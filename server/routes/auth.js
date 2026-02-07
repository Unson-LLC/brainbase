import express from 'express';
import { AuthController } from '../controllers/auth-controller.js';
import { requireAuth } from '../middleware/auth.js';

export function createAuthRouter(authService) {
    const router = express.Router();
    const controller = new AuthController(authService);

    router.get('/slack/start', controller.slackStart);
    router.get('/slack/callback', controller.slackCallback);
    router.post('/refresh', controller.refresh);
    router.post('/logout', requireAuth(authService), controller.logout);
    router.get('/verify', requireAuth(authService), controller.verify);

    return router;
}

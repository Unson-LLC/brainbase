import express from 'express';
import { AuthController } from '../controllers/auth-controller.js';
import { requireAuth } from '../middleware/auth.js';

export function createAuthRouter(authService, { googleMeetConnectionService = null } = {}) {
    const router = express.Router();
    const controller = new AuthController(authService, { googleMeetConnectionService });

    router.get('/slack/start', controller.slackStart);
    router.get('/login/start', controller.slackStart);
    router.get('/google/start', controller.slackStart);
    router.get('/slack/callback', controller.slackCallback);
    router.get('/google/callback', controller.slackCallback);
    router.get('/google/meet/start', requireAuth(authService), controller.googleMeetStart);
    router.get('/google/meet/callback', requireAuth(authService), controller.googleMeetCallback);
    router.post('/token/exchange', controller.tokenExchange);
    router.post('/refresh', controller.refresh);
    router.get('/organizations', requireAuth(authService), controller.organizations);
    router.post('/organizations/switch', requireAuth(authService), controller.switchOrganization);
    router.post('/logout', requireAuth(authService), controller.logout);
    router.get('/verify', requireAuth(authService), controller.verify);
    router.post('/service-tokens', requireAuth(authService), controller.createServiceToken);
    router.post('/routine-service-tokens', requireAuth(authService), controller.createRoutineServiceToken);

    // Device Code Flow endpoints
    router.post('/device/code', controller.deviceCodeRequest);
    router.post('/device/verify-user-code', controller.verifyUserCodeEndpoint);
    router.post('/device/approve', requireAuth(authService), controller.approveDevice);
    router.post('/device/deny', controller.denyDevice);
    router.post('/device/token', controller.deviceTokenRequest);

    return router;
}

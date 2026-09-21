import express from 'express';
import { AuthController } from '../controllers/auth-controller.js';
import { requireAuth } from '../middleware/auth.js';

export function createAuthRouter(authService, {
    googleMeetConnectionService = null,
    googleServiceConnectionService = null
} = {}) {
    const router = express.Router();
    const controller = new AuthController(authService, {
        googleMeetConnectionService,
        googleServiceConnectionService
    });

    router.get('/slack/start', controller.slackStart);
    router.get('/login/start', controller.slackStart);
    router.get('/google/start', (req, res, next) => {
        // Keep the historical Google login alias for requests without a
        // service. A service query selects authenticated incremental OAuth.
        if (!String(req.query.service || '').trim()) return controller.slackStart(req, res);
        return requireAuth(authService)(req, res, next);
    }, controller.googleMeetStart);
    router.get('/slack/callback', controller.slackCallback);
    router.get('/google/callback', controller.slackCallback);
    router.get('/google/meet/start', requireAuth(authService), controller.googleMeetStart);
    router.get('/google/meet/callback', requireAuth(authService), controller.googleMeetCallback);
    router.get('/google/meet/status', requireAuth(authService), controller.googleMeetStatus);
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

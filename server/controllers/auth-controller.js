import { logger } from '../utils/logger.js';

export class AuthController {
    constructor(authService) {
        this.authService = authService;
    }

    slackStart = async (req, res) => {
        try {
            this.authService.assertReady();
            const state = this.authService.createState();
            const url = this.authService.buildAuthorizeUrl(state);
            if (String(req.query.json || '').toLowerCase() === 'true') {
                return res.json({ url, state });
            }
            return res.redirect(url);
        } catch (error) {
            logger.error('Failed to start Slack auth', { error });
            return res.status(500).json({ error: error.message || 'Failed to start Slack auth' });
        }
    };

    slackCallback = async (req, res) => {
        try {
            this.authService.assertReady();
            const { code, state } = req.query;
            if (!code || !state) {
                return res.status(400).json({ error: 'code and state are required' });
            }
            const stateOk = this.authService.consumeState(String(state));
            if (!stateOk) {
                return res.status(400).json({ error: 'Invalid state' });
            }

            const tokenPayload = await this.authService.exchangeCode(String(code));
            let userInfo = null;
            if (this.authService.slackMode !== 'oauth') {
                const accessToken = tokenPayload.access_token;
                if (!accessToken) {
                    return res.status(401).json({ error: 'Slack access token missing' });
                }
                userInfo = await this.authService.fetchUserInfo(accessToken);
            }

            const { slackUserId, slackWorkspaceId } = this.authService.resolveSlackIdentity(tokenPayload, userInfo);
            if (!slackUserId || !slackWorkspaceId) {
                return res.status(401).json({ error: 'Slack identity could not be resolved' });
            }

            const grant = await this.authService.findGrant({ slackUserId, slackWorkspaceId });
            if (!grant) {
                await this.authService.createAuditLog({
                    slackUserId,
                    slackWorkspaceId,
                    eventType: 'AUTH_DENY',
                    metadata: { reason: 'grant_not_found' }
                });
                return res.status(403).json({ error: 'Access is not granted' });
            }

            const personId = await this.authService.ensurePerson({
                personId: grant.person_id,
                personName: grant.person_name
            });

            const access = this.authService.buildAccessFromGrant({ ...grant, person_id: personId });
            const token = this.authService.issueToken({
                role: access.role,
                projectCodes: access.projectCodes,
                clearance: access.clearance,
                personId,
                slackUserId,
                slackWorkspaceId
            });

            await this.authService.createAuditLog({
                personId,
                slackUserId,
                slackWorkspaceId,
                eventType: 'AUTH_LOGIN',
                metadata: { role: access.role, project_codes: access.projectCodes }
            });

            return res.json({
                token,
                access: {
                    role: access.role,
                    projectCodes: access.projectCodes,
                    clearance: access.clearance,
                    personId
                }
            });
        } catch (error) {
            logger.error('Slack auth callback failed', { error });
            return res.status(500).json({ error: error.message || 'Slack auth failed' });
        }
    };

    logout = async (req, res) => {
        try {
            const access = req.access || {};
            await this.authService.createAuditLog({
                personId: access.personId || null,
                slackUserId: access.slackUserId || null,
                slackWorkspaceId: access.slackWorkspaceId || null,
                eventType: 'AUTH_LOGOUT',
                metadata: {}
            });
            return res.json({ ok: true });
        } catch (error) {
            logger.error('Logout failed', { error });
            return res.status(500).json({ error: error.message || 'Logout failed' });
        }
    };
}

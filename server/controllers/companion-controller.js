import { logger } from '../utils/logger.js';
import { ReplyDraftServiceError } from '../services/companion/reply-draft-service.js';

function serializeError(error) {
    if (error instanceof ReplyDraftServiceError) {
        return {
            status: error.status || 500,
            body: {
                error: error.message,
                code: error.code || 'reply_draft_error',
                details: error.details || {}
            }
        };
    }
    return {
        status: 500,
        body: {
            error: 'Failed to create reply draft',
            code: 'reply_draft_error'
        }
    };
}

export class CompanionController {
    constructor(replyDraftService, { workflowService = null } = {}) {
        this.replyDraftService = replyDraftService;
        this.workflowService = workflowService;
    }

    createReplyDraft = async (req, res) => {
        try {
            const result = await this.replyDraftService.createDraft(req.body || {}, {
                access: req.access || null,
                auth: req.auth || null,
                authSource: req.authSource || null
            });
            res.json(result);
        } catch (error) {
            logger.error('Failed to create companion reply draft', { error });
            const serialized = serializeError(error);
            res.status(serialized.status).json(serialized.body);
        }
    };

    createReplyContext = async (req, res) => {
        try {
            const result = await this.replyDraftService.createContext(req.body || {}, {
                access: req.access || null,
                auth: req.auth || null,
                authSource: req.authSource || null
            });
            res.json(result);
        } catch (error) {
            logger.error('Failed to create companion reply context', { error });
            const serialized = serializeError(error);
            res.status(serialized.status).json(serialized.body);
        }
    };

    listApprovalInbox = async (req, res) => {
        if (!this.workflowService?.listCompanionApprovalInbox) {
            res.status(503).json({
                error: 'Workflow service is not configured',
                code: 'workflow_service_unconfigured'
            });
            return;
        }
        const actor = {
            ...(req.auth || {}),
            person_id: req.access?.personId || req.auth?.person_id || req.auth?.sub || null,
            projectCodes: Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [],
            role: req.access?.role || req.auth?.role || null,
            authSource: req.authSource || null
        };
        const projectId = req.query.project_id || req.query.projectId || null;
        const limit = Number.parseInt(String(req.query.limit || '100'), 10);
        try {
            const result = await this.workflowService.listCompanionApprovalInbox({
                projectId,
                limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100
            }, actor);
            res.json(result);
        } catch (error) {
            logger.error('Failed to list companion approval inbox', { error });
            res.status(error.statusCode || 500).json({
                error: error.message || 'Failed to list companion approval inbox',
                code: error.code || 'approval_inbox_error',
                details: error.details || {}
            });
        }
    };
}

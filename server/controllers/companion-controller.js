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
    constructor(replyDraftService) {
        this.replyDraftService = replyDraftService;
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
}

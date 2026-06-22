export class ReplyDraftServiceError extends Error {
    constructor(message, { code = 'reply_draft_error', status = 500, details = {} } = {}) {
        super(message);
        this.name = 'ReplyDraftServiceError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

export class UnconfiguredDraftGenerator {
    async generate() {
        throw new ReplyDraftServiceError('Draft generator is not configured', {
            code: 'generator_unconfigured',
            status: 503
        });
    }
}

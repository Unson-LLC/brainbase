import { ulid } from 'ulid';
import { ReplyDraftContextResolver } from './reply-draft-context-resolver.js';
import { ReplyDraftServiceError, UnconfiguredDraftGenerator } from './draft-generator.js';

function requiredString(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ReplyDraftServiceError(`${fieldName} is required`, {
            code: 'invalid_request',
            status: 400,
            details: { field: fieldName }
        });
    }
    return value.trim();
}

function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeRequest(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ReplyDraftServiceError('Request body must be an object', {
            code: 'invalid_request',
            status: 400
        });
    }

    const provider = requiredString(payload.provider, 'provider');
    const contextPolicy = requiredString(payload.contextPolicy, 'contextPolicy');
    const workflowName = requiredString(payload.workflowName, 'workflowName');
    if (contextPolicy !== 'brainbase_workflow') {
        throw new ReplyDraftServiceError('contextPolicy must be brainbase_workflow', {
            code: 'invalid_request',
            status: 400,
            details: { field: 'contextPolicy' }
        });
    }
    if (workflowName !== 'brainbase.reply_draft') {
        throw new ReplyDraftServiceError('workflowName must be brainbase.reply_draft', {
            code: 'invalid_request',
            status: 400,
            details: { field: 'workflowName' }
        });
    }

    return {
        ...payload,
        provider,
        contextPolicy,
        workflowName,
        threadMessages: Array.isArray(payload.threadMessages) ? payload.threadMessages : [],
        classificationEvidence: Array.isArray(payload.classificationEvidence) ? payload.classificationEvidence : []
    };
}

function buildWritebackIntent(request) {
    const itemID = optionalString(request.providerMessageID)
        || optionalString(request.providerThreadID)
        || optionalString(request.sourceDedupeKey);
    const targetDedupeKey = optionalString(request.sourceDedupeKey)
        || [request.provider, itemID].filter(Boolean).join(':');

    return {
        provider: request.provider,
        itemID,
        targetDedupeKey,
        sourceURL: optionalString(request.sourceURL),
        requiresHumanApproval: true,
        sendAllowed: false
    };
}

function normalizeGeneratorResult(result) {
    if (!result || typeof result !== 'object') {
        throw new ReplyDraftServiceError('Draft generator returned an invalid result', {
            code: 'generator_invalid_result',
            status: 502
        });
    }
    const body = requiredString(result.body, 'body');
    return {
        body,
        rationale: Array.isArray(result.rationale) ? result.rationale.filter(Boolean).map(String) : [],
        openQuestions: Array.isArray(result.openQuestions) ? result.openQuestions.filter(Boolean).map(String) : []
    };
}

export class ReplyDraftService {
    constructor({
        contextResolver = null,
        draftGenerator = null,
        infoSSOTService = null,
        learningService = null
    } = {}) {
        this.contextResolver = contextResolver || new ReplyDraftContextResolver({ infoSSOTService, learningService });
        this.draftGenerator = draftGenerator || new UnconfiguredDraftGenerator();
    }

    async createDraft(payload, { access } = {}) {
        const request = normalizeRequest(payload);
        const context = await this.contextResolver.resolve(request, access || {});
        const generated = normalizeGeneratorResult(await this.draftGenerator.generate({
            request,
            context,
            userInstruction: optionalString(request.userInstruction),
            threadMessages: request.threadMessages
        }));
        const auditID = `aud_${ulid()}`;

        return {
            body: generated.body,
            rationale: [
                ...context.rationale,
                ...generated.rationale
            ],
            openQuestions: generated.openQuestions,
            sourceURL: optionalString(request.sourceURL),
            auditID,
            writebackIntent: buildWritebackIntent(request)
        };
    }
}

export { ReplyDraftServiceError };

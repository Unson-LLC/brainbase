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
    if (!['brainbase.reply_draft', 'brainbase.reply_context'].includes(workflowName)) {
        throw new ReplyDraftServiceError('workflowName must be brainbase.reply_draft or brainbase.reply_context', {
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

function compactText(value, max = 400) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function contextSnippet(source, title, text, extra = {}) {
    const compacted = compactText(text);
    if (!compacted) return null;
    return {
        source,
        title,
        text: compacted,
        ...extra
    };
}

function buildReplyContextResult(request, context) {
    const personalKg = Array.isArray(context.personalKg) ? context.personalKg : [];
    const graphSummary = context.rationale?.find((item) => String(item).includes('Graph SSOT')) || '';
    const personalKgSummary = context.rationale?.find((item) => String(item).includes('Personal KG')) || '';
    const personalKgSnippets = personalKg
        .map((record) => contextSnippet(
            'personal_kg',
            record.cognitive_type || 'memory',
            record.body,
            {
                id: record.id || null,
                confidence: record.confidence ?? null,
                sourceSystem: record.source_system || null,
                createdAt: record.created_at || null
            }
        ))
        .filter(Boolean);
    const snippets = [
        contextSnippet('graph_ssot', 'Graph SSOT', graphSummary),
        contextSnippet('personal_kg_summary', 'Personal KG', personalKgSummary),
        ...personalKgSnippets
    ].filter(Boolean);

    return {
        contextPolicy: request.contextPolicy,
        workflowName: 'brainbase.reply_context',
        sourceURL: optionalString(request.sourceURL),
        auditID: `ctx_${ulid()}`,
        rationale: Array.isArray(context.rationale) ? context.rationale : [],
        guidance: {
            replyPrinciples: personalKgSnippets.map((snippet) => snippet.text).slice(0, 5),
            cautions: [
                'Slack/Gmailへの送信や投稿はMac Companion側の人間承認まで実行しない',
                'Brainbase文脈は返信判断の材料であり、本文は現在のスレッド内容を優先して作る'
            ],
            openQuestions: []
        },
        contextSnippets: snippets
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

    async createContext(payload, { access } = {}) {
        if (payload?.workflowName && payload.workflowName !== 'brainbase.reply_context') {
            throw new ReplyDraftServiceError('workflowName must be brainbase.reply_context for reply-context', {
                code: 'invalid_request',
                status: 400,
                details: { field: 'workflowName' }
            });
        }
        const request = normalizeRequest({
            ...payload,
            workflowName: 'brainbase.reply_context'
        });
        const context = await this.contextResolver.resolve(request, access || {});
        return buildReplyContextResult(request, context);
    }
}

export { ReplyDraftServiceError };

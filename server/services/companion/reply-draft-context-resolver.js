import { ReplyDraftServiceError } from './draft-generator.js';

const DEFAULT_PROJECT_CODE = 'brainbase';
const GRAPH_ENTITY_TYPES = 'person,org,project,customer,raci_assignment,decision';

function compactText(value, max = 240) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function senderText(sender) {
    if (!sender) return '';
    if (typeof sender === 'string') return sender;
    return [sender.name, sender.email].filter(Boolean).join(' ');
}

function threadText(threadMessages = []) {
    if (!Array.isArray(threadMessages)) return '';
    return threadMessages
        .map((message) => {
            if (typeof message === 'string') return message;
            if (!message || typeof message !== 'object') return '';
            return [
                message.sender,
                message.from,
                message.subject,
                message.snippet,
                message.body,
                message.text
            ].filter(Boolean).join(' ');
        })
        .filter(Boolean)
        .join(' ');
}

function buildPersonalKgQueries(request) {
    const candidates = [
        request.userInstruction,
        request.subject,
        senderText(request.sender),
        request.classificationReason,
        request.snippet,
        threadText(request.threadMessages)
    ]
        .map((value) => compactText(value, 120))
        .filter(Boolean);

    return Array.from(new Set(candidates)).slice(0, 4);
}

function summarizeGraphContext(graphContext) {
    const meta = graphContext?.meta || {};
    const report = graphContext?.report || null;
    if (report?.meta) {
        return `Graph SSOT context loaded: ${report.meta.node_count || 0} nodes / ${report.meta.edge_count || 0} edges`;
    }
    return `Graph SSOT context loaded: ${meta.entity_count || 0} entities`;
}

function summarizePersonalKg(records) {
    if (!records.length) return 'Personal KG search completed: 0 matching owner-visible memories';
    const preview = records
        .slice(0, 3)
        .map((record) => compactText(record.body, 100))
        .filter(Boolean);
    return `Personal KG search completed: ${records.length} owner-visible memories${preview.length ? ` (${preview.join(' / ')})` : ''}`;
}

export class ReplyDraftContextResolver {
    constructor({ infoSSOTService, learningService, projectCode = DEFAULT_PROJECT_CODE } = {}) {
        this.infoSSOTService = infoSSOTService;
        this.learningService = learningService;
        this.projectCode = projectCode;
    }

    async resolve(request, access) {
        const graphContext = await this.resolveGraphContext(access);
        const personalKg = await this.resolvePersonalKg(request, access);
        return {
            graph: graphContext,
            personalKg,
            threadMessages: Array.isArray(request.threadMessages) ? request.threadMessages : [],
            rationale: [
                summarizeGraphContext(graphContext),
                summarizePersonalKg(personalKg)
            ]
        };
    }

    async resolveGraphContext(access) {
        if (!this.infoSSOTService?.getContext) {
            throw new ReplyDraftServiceError('Graph context resolver is not configured', {
                code: 'context_unavailable',
                status: 503,
                details: { source: 'graph' }
            });
        }

        try {
            return await this.infoSSOTService.getContext(access, {
                projectCode: this.projectCode,
                entityTypes: GRAPH_ENTITY_TYPES,
                limit: 50,
                humanReadable: true,
                includeEdges: true,
                includePhilosophy: true,
                scope: 'automation',
                objectType: 'reply_draft',
                operation: 'read',
                maxRecommended: 8,
                includeMemory: false
            });
        } catch (error) {
            throw new ReplyDraftServiceError('Graph context unavailable', {
                code: 'context_unavailable',
                status: 503,
                details: {
                    source: 'graph',
                    message: error instanceof Error ? error.message : String(error || '')
                }
            });
        }
    }

    async resolvePersonalKg(request, access) {
        if (!this.learningService?.searchPersonalKgCandidates) {
            throw new ReplyDraftServiceError('Personal KG resolver is not configured', {
                code: 'context_unavailable',
                status: 503,
                details: { source: 'personal_kg' }
            });
        }
        if (!access?.personId || !access?.organizationId) {
            throw new ReplyDraftServiceError('Personal KG identity is required', {
                code: 'context_unavailable',
                status: 503,
                details: { source: 'personal_kg', reason: 'personal_knowledge_identity_required' }
            });
        }

        const queries = buildPersonalKgQueries(request);
        if (!queries.length) return [];

        try {
            const results = [];
            for (const query of queries) {
                results.push(await this.learningService.searchPersonalKgCandidates({
                    query,
                    ownerPersonId: access.personId,
                    organizationId: access.organizationId,
                    cognitiveTypes: ['observation', 'insight', 'claim', 'preference', 'hypothesis', 'result'],
                    limit: 5
                }, { access }));
            }
            const seen = new Set();
            return results.flat().filter((record) => {
                if (!record?.id || seen.has(record.id)) return false;
                seen.add(record.id);
                return true;
            });
        } catch (error) {
            throw new ReplyDraftServiceError('Personal KG context unavailable', {
                code: 'context_unavailable',
                status: 503,
                details: {
                    source: 'personal_kg',
                    message: error instanceof Error ? error.message : String(error || '')
                }
            });
        }
    }
}
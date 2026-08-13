import { createHash } from 'node:crypto';

export class KnowledgeFeedbackValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'KnowledgeFeedbackValidationError';
        this.code = 'knowledge_feedback_invalid';
    }
}

export class KnowledgeFeedbackNotFoundError extends Error {
    constructor(eventId) {
        super(`knowledge event not found: ${eventId}`);
        this.name = 'KnowledgeFeedbackNotFoundError';
        this.code = 'knowledge_event_not_found';
    }
}

const ACTIONS = new Set(['adopt', 'correct', 'reject', 'not_useful']);

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
    }
    return value;
}

function feedbackIdentity(feedback) {
    return JSON.stringify(canonicalize({
        event_id: feedback.event_id,
        action: feedback.action,
        reason: feedback.reason || null,
        correction_event: feedback.correction_event || null
    }));
}

function feedbackIdFor(feedback) {
    if (feedback.feedback_id) return feedback.feedback_id;
    return `kfb_${createHash('sha256').update(feedbackIdentity(feedback)).digest('hex').slice(0, 24)}`;
}

function feedbackIdentityConflict(feedbackId) {
    const error = new Error(`knowledge feedback identity conflict: ${feedbackId}`);
    error.code = 'knowledge_feedback_identity_conflict';
    return error;
}

function assertSameFeedbackIdentity(persisted, incoming) {
    if (feedbackIdentity(persisted) !== feedbackIdentity(incoming)) {
        throw feedbackIdentityConflict(incoming.feedback_id);
    }
}

function isFeedbackUniqueConflict(error) {
    return error?.code === '23505'
        && (!error.constraint || error.constraint === 'knowledge_feedback_feedback_id_key');
}

function graphUpdateMissing(action, id) {
    const error = new Error(`knowledge Graph ${action} target not found: ${id}`);
    error.code = 'knowledge_graph_update_missing';
    return error;
}

export class KnowledgeFeedbackService {
    constructor({ repository, knowledgeEventService = null, candidateRepository = null, graphRepository = null }) {
        this.repository = repository;
        this.knowledgeEventService = knowledgeEventService;
        this.candidateRepository = candidateRepository;
        this.graphRepository = graphRepository;
        this.feedbackResults = new Map();
    }

    async recordFeedback(feedback, { access } = {}) {
        if (!ACTIONS.has(feedback?.action) || !feedback?.event_id) {
            throw new KnowledgeFeedbackValidationError('action and event_id are required');
        }
        if (feedback.action === 'correct' && !feedback.correction_event) {
            throw new KnowledgeFeedbackValidationError('correction_event is required for correct');
        }
        feedback = { ...feedback, feedback_id: feedbackIdFor(feedback) };

        await this.repository.ensureSchema?.();
        const result = await this.repository.transaction(async (tx) => {
            if (feedback.feedback_id) {
                const persisted = await tx.findFeedbackById?.(feedback.feedback_id);
                const local = this.feedbackResults.get(feedback.feedback_id);
                if (persisted) {
                    assertSameFeedbackIdentity(persisted, feedback);
                    return { ...(persisted.result || local?.result), idempotent: true };
                }
                if (local) {
                    if (local.identity !== feedbackIdentity(feedback)) {
                        throw feedbackIdentityConflict(feedback.feedback_id);
                    }
                    return { ...local.result, idempotent: true };
                }
            }
            const current = await tx.getEvent(feedback.event_id);
            if (!current) throw new KnowledgeFeedbackNotFoundError(feedback.event_id);
            const projectCode = current.project_code || current.applicability_scope?.project_code || null;
            if (access && projectCode && !access.projectCodes?.includes(projectCode)) {
                const error = new Error(`knowledge event access denied: ${feedback.event_id}`);
                error.code = 'knowledge_project_access_denied';
                throw error;
            }

            if (feedback.action === 'correct') {
                const replacement = feedback.correction_event;
                if (replacement.corrects_event_id !== feedback.event_id) {
                    throw new KnowledgeFeedbackValidationError('correction_event.corrects_event_id must match event_id');
                }
                if (current.graph_entity_id && replacement.subject?.id !== current.graph_entity_id) {
                    throw new KnowledgeFeedbackValidationError('correction_event.subject.id must match current Graph entity id');
                }
                const replacementResult = this.knowledgeEventService
                    ? await this.knowledgeEventService.ingest(replacement, { access, transaction: tx })
                    : await tx.insertEvent(replacement);
                await tx.updateSemanticState(feedback.event_id, 'superseded');
                if (current.candidate_id && this.candidateRepository) {
                    await this.candidateRepository.updateSemanticState(
                        current.candidate_id,
                        'superseded',
                        tx.client ? { client: tx.client } : {}
                    );
                }
                if (current.graph_entity_id && this.graphRepository?.supersedeDecision) {
                    const graphUpdate = await this.graphRepository.supersedeDecision({
                        id: current.graph_entity_id,
                        event_id: feedback.event_id,
                        replacement_event_id: replacement.event_id,
                        replacement_candidate_id: replacementResult?.candidate_id || null,
                        source_pointer: replacement.source_pointer || null
                    }, { ...(tx.client ? { client: tx.client } : {}), access });
                    if (graphUpdate === null) throw graphUpdateMissing('supersede', current.graph_entity_id);
                } else {
                    await tx.replaceSearchDocument(feedback.event_id, replacement.event_id);
                }
                const feedbackResult = {
                    action: 'correct',
                    event_id: feedback.event_id,
                    semantic_state: 'superseded',
                    replacement_event_id: replacement.event_id
                };
                return this._appendFeedback(tx, {
                    ...feedback,
                    source_pointer: current.source_pointer || null
                }, feedbackResult);
            }

            if (feedback.action === 'reject') {
                await tx.updateSemanticState(feedback.event_id, 'retracted');
                if (current.candidate_id && this.candidateRepository) {
                    await this.candidateRepository.updateSemanticState(
                        current.candidate_id,
                        'retracted',
                        tx.client ? { client: tx.client } : {}
                    );
                }
                if (current.graph_entity_id && this.graphRepository?.retractDecision) {
                    const graphUpdate = await this.graphRepository.retractDecision({
                        id: current.graph_entity_id,
                        event_id: feedback.event_id,
                        source_pointer: current.source_pointer || null
                    }, { ...(tx.client ? { client: tx.client } : {}), access });
                    if (graphUpdate === null) throw graphUpdateMissing('retract', current.graph_entity_id);
                } else {
                    await tx.removeSearchDocument(feedback.event_id);
                }
                const feedbackResult = { action: 'reject', event_id: feedback.event_id, semantic_state: 'retracted' };
                return this._appendFeedback(tx, {
                    ...feedback,
                    source_pointer: current.source_pointer || null
                }, feedbackResult);
            }

            const feedbackResult = {
                action: feedback.action,
                event_id: feedback.event_id,
                semantic_state: current.semantic_state || 'active'
            };
            return this._appendFeedback(tx, feedback, feedbackResult);
        }, { access });
        if (feedback.feedback_id && !result.idempotent) {
            this.feedbackResults.set(feedback.feedback_id, {
                identity: feedbackIdentity(feedback),
                result
            });
        }
        return result;
    }

    async _appendFeedback(tx, feedback, result) {
        const record = { ...feedback, result };
        try {
            const inserted = await tx.appendFeedback(record);
            if (inserted !== null) return result;
        } catch (error) {
            if (!isFeedbackUniqueConflict(error)) throw error;
        }
        const persisted = await tx.findFeedbackById?.(feedback.feedback_id);
        if (!persisted) throw feedbackIdentityConflict(feedback.feedback_id);
        assertSameFeedbackIdentity(persisted, feedback);
        return { ...(persisted.result || result), idempotent: true };
    }
}

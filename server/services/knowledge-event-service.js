const REQUIRED_FIELDS = [
    'schema_version',
    'event_id',
    'occurred_at',
    'captured_at',
    'source',
    'subject',
    'decision_authority',
    'applicability_scope',
    'permission_snapshot',
    'source_pointer',
    'body_hash',
    'parent_episode_id'
];

export class KnowledgeEventValidationError extends Error {
    constructor(field, message = `knowledge_event.v1 field is required: ${field}`) {
        super(message);
        this.name = 'KnowledgeEventValidationError';
        this.code = 'knowledge_event_invalid';
        this.field = field;
    }
}

export class KnowledgeEventConflictError extends Error {
    constructor(eventId) {
        super(`event_id already exists with different content: ${eventId}`);
        this.name = 'KnowledgeEventConflictError';
        this.code = 'knowledge_event_conflict';
        this.event_id = eventId;
    }
}

export class InMemoryKnowledgeEventRepository {
    constructor() {
        this.events = new Map();
        this.searchDocuments = new Map();
        this.feedback = [];
    }

    async findById(eventId) {
        const event = this.events.get(eventId);
        return event ? structuredClone(event) : null;
    }

    async create(event) {
        if (this.events.has(event.event_id)) {
            throw new KnowledgeEventConflictError(event.event_id);
        }
        const record = {
            ...structuredClone(event),
            project_code: event.applicability_scope?.project_code || null,
            stage_history: []
        };
        this.events.set(event.event_id, record);
        return structuredClone(record);
    }

    async appendStage(eventId, stageEntry) {
        const event = this.events.get(eventId);
        if (!event) throw new Error(`knowledge event not found: ${eventId}`);
        event.stage_history.push(structuredClone(stageEntry));
    }

    async saveResult(eventId, result) {
        const event = this.events.get(eventId);
        if (!event) throw new Error(`knowledge event not found: ${eventId}`);
        event.result = structuredClone(result);
        event.candidate_id = result.candidate_id || null;
    }

    async transaction(work) {
        const snapshot = {
            events: structuredClone(this.events),
            searchDocuments: structuredClone(this.searchDocuments),
            feedback: structuredClone(this.feedback)
        };
        const tx = {
            getEvent: async (id) => this.events.get(id) || null,
            insertEvent: async (event) => {
                if (this.events.has(event.event_id)) throw new KnowledgeEventConflictError(event.event_id);
                const record = { ...structuredClone(event), semantic_state: event.semantic_state || 'active' };
                this.events.set(event.event_id, record);
                return record;
            },
            updateSemanticState: async (id, semanticState) => {
                const event = this.events.get(id);
                if (!event) {
                    const error = new Error(`knowledge event not found: ${id}`);
                    error.code = 'knowledge_event_not_found';
                    throw error;
                }
                event.semantic_state = semanticState;
            },
            replaceSearchDocument: async (oldId, newId) => {
                this.searchDocuments.delete(oldId);
                this.searchDocuments.set(newId, { current: true });
            },
            removeSearchDocument: async (id) => this.searchDocuments.delete(id),
            appendFeedback: async (feedback) => this.feedback.push(structuredClone(feedback))
        };
        try {
            return await work(tx);
        } catch (error) {
            this.events = snapshot.events;
            this.searchDocuments = snapshot.searchDocuments;
            this.feedback = snapshot.feedback;
            throw error;
        }
    }
}

function requireKnowledgeEvent(event) {
    for (const field of REQUIRED_FIELDS) {
        if (event?.[field] === undefined || event?.[field] === null || event?.[field] === '') {
            throw new KnowledgeEventValidationError(field);
        }
    }
    if (event.schema_version !== 'knowledge_event.v1') {
        throw new KnowledgeEventValidationError('schema_version', 'schema_version must be knowledge_event.v1');
    }
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sameEventIdentity(existing, incoming) {
    const identityFields = [
        'body_hash',
        'source_pointer',
        'subject',
        'decision_authority',
        'applicability_scope',
        'permission_snapshot',
        'parent_episode_id',
        'organization_id',
        'sensitivity',
        'role_min',
        'venue'
    ];
    return identityFields.every((field) => existing[field] === undefined
        || canonicalJson(existing[field]) === canonicalJson(incoming[field]));
}

function decisionQuarantineReason(event) {
    if (event.subject?.type !== 'decision') return null;
    if (!event.decision?.statement) return 'decision_statement_missing';
    if (!event.subject?.id) return 'stable_subject_id_missing';
    if (!event.decision_authority?.authorized
        || !event.decision_authority?.decider_id
        || !event.decision_authority?.domain) return 'decision_authority_missing';
    if (!event.applicability_scope?.project_code || !event.applicability_scope?.scope) {
        return 'applicability_scope_missing';
    }
    if (!event.source_pointer?.uri || !event.body_hash) return 'source_evidence_missing';
    if (event.unresolved_conflict) return 'unresolved_conflict';
    if (event.permission_snapshot?.contains_pii) return 'personal_data_detected';
    return null;
}

function candidateInput(event, quarantineReason, authenticatedOwnerPersonId = null) {
    const isDecision = event.subject?.type === 'decision';
    const autoPromote = isDecision && !quarantineReason;
    return {
        cognitive_type: isDecision ? 'claim' : 'observation',
        owner_person_id: authenticatedOwnerPersonId
            || event.decision_authority?.decider_id
            || event.subject?.id
            || 'brainbase',
        actor_person_id: event.decision_authority?.decider_id || event.subject?.id || 'brainbase',
        source_system: event.source?.type || 'knowledge_event',
        source_event_ids: [event.event_id],
        organization_id: event.organization_id,
        project_code: event.applicability_scope?.project_code || null,
        org_ids: event.applicability_scope?.org_ids || [],
        project_ids: event.applicability_scope?.project_code ? [event.applicability_scope.project_code] : [],
        visibility: event.permission_snapshot?.visibility || 'owner',
        sensitivity: event.permission_snapshot?.sensitivity || 'internal',
        role_min: event.role_min || 'member',
        permission_snapshot: event.permission_snapshot,
        evidence_ids: [event.event_id],
        body: event.decision?.statement || event.payload?.summary || event.body || event.body_hash,
        recommended_subject_type: event.subject?.type || null,
        recommended_subject_id: event.subject?.id || null,
        processing_stage: 'received',
        semantic_state: 'active',
        target_tier: autoPromote ? 'graph' : 'episode',
        promotion_status: autoPromote ? 'auto_promoted' : 'candidate',
        requires_approval: !autoPromote
    };
}

function graphPayload(event, candidateId) {
    return {
        statement: event.decision.statement,
        applicability_scope: event.applicability_scope,
        decision_authority: event.decision_authority,
        occurred_at: event.occurred_at,
        derived_from_event_id: event.event_id,
        derived_from_candidate_id: candidateId,
        source_pointer: event.source_pointer,
        semantic_state: 'active',
        searchable: true
    };
}

export class KnowledgeEventService {
    constructor({ eventRepository, candidateRepository, graphRepository, externalActions, now = () => new Date().toISOString() }) {
        this.eventRepository = eventRepository;
        this.candidateRepository = candidateRepository;
        this.graphRepository = graphRepository;
        this.externalActions = externalActions;
        this.now = now;
        this.inFlight = new Map();
    }

    async _appendStage(eventRepository, eventId, candidateId, stage, client) {
        if (client) {
            await this.candidateRepository.transitionProcessingStage(candidateId, stage, { client });
            await eventRepository.appendStage(eventId, { stage, occurred_at: this.now() }, { client });
            return;
        }
        await this.candidateRepository.transitionProcessingStage(candidateId, stage);
        await eventRepository.appendStage(eventId, { stage, occurred_at: this.now() });
    }

    async _ingest(event, {
        eventRepository = this.eventRepository,
        client = null,
        access = null,
        skipGraphProjection = false
    } = {}) {
        requireKnowledgeEvent(event);
        const existing = client
            ? await eventRepository.findById(event.event_id, { client })
            : await eventRepository.findById(event.event_id);
        if (existing) {
            if (!sameEventIdentity(existing, event)) throw new KnowledgeEventConflictError(event.event_id);
            return { ...(existing.result || { event_id: event.event_id }), idempotent: true };
        }

        let quarantineReason = decisionQuarantineReason(event);
        if (!quarantineReason && event.subject?.type === 'decision') {
            try {
                const authorityVerification = await this.graphRepository.verifyDecisionAuthority({
                    project_code: event.applicability_scope.project_code,
                    decider_id: event.decision_authority.decider_id,
                    decision_domain: event.decision_authority.domain
                }, { client, access });
                if (authorityVerification === false) quarantineReason = 'decision_authority_unverified';
                if (authorityVerification?.verified === false) {
                    quarantineReason = authorityVerification.reason || 'decision_authority_unverified';
                }
            } catch {
                quarantineReason = 'decision_authority_unverified';
            }
        }
        if (!quarantineReason && event.subject?.type === 'decision'
            && typeof this.graphRepository.findDecisionById === 'function') {
            await eventRepository.lockDecisionSubject?.(event.subject.id, { client });
            const existingDecision = await this.graphRepository.findDecisionById(event.subject.id, { client, access });
            if (existingDecision
                && existingDecision.semantic_state !== 'retracted'
                && existingDecision.payload?.statement !== event.decision.statement
                && !event.corrects_event_id) {
                quarantineReason = 'unresolved_conflict';
            }
        }
        let createdEvent;
        if (client) {
            createdEvent = await eventRepository.create(event, { client });
            if (createdEvent?.idempotent) {
                if (!sameEventIdentity(createdEvent, event)) throw new KnowledgeEventConflictError(event.event_id);
                return { ...(createdEvent.result || { event_id: event.event_id }), idempotent: true };
            }
            await eventRepository.appendStage(
                event.event_id,
                { stage: 'received', occurred_at: this.now() },
                { client }
            );
        } else {
            createdEvent = await eventRepository.create(event);
            if (createdEvent?.idempotent) {
                if (!sameEventIdentity(createdEvent, event)) throw new KnowledgeEventConflictError(event.event_id);
                return { ...(createdEvent.result || { event_id: event.event_id }), idempotent: true };
            }
            await eventRepository.appendStage(event.event_id, { stage: 'received', occurred_at: this.now() });
        }
        const candidate = client
            ? await this.candidateRepository.create(candidateInput(event, quarantineReason, access?.personId), { client })
            : await this.candidateRepository.create(candidateInput(event, quarantineReason, access?.personId));
        await this._appendStage(eventRepository, event.event_id, candidate.id, 'queued', client);
        await this._appendStage(eventRepository, event.event_id, candidate.id, 'extracted', client);
        await this._appendStage(eventRepository, event.event_id, candidate.id, 'resolved', client);

        if (quarantineReason) {
            await this.candidateRepository.updateSemanticState(
                candidate.id,
                'quarantined',
                client ? { client, reason: quarantineReason } : { reason: quarantineReason }
            );
            const result = {
                event_id: event.event_id,
                candidate_id: candidate.id,
                processing_stage: 'resolved',
                semantic_state: 'quarantined',
                quarantine_reason: quarantineReason
            };
            if (client) await eventRepository.saveResult?.(event.event_id, result, { client });
            else await eventRepository.saveResult?.(event.event_id, result);
            return result;
        }

        let graphEntityId = null;
        if (!skipGraphProjection && event.subject.type === 'decision') {
            const graphInput = {
                id: event.subject.id,
                payload: graphPayload(event, candidate.id)
            };
            let graphEntity;
            try {
                graphEntity = client
                    ? await this.graphRepository.upsertDecision(graphInput, { client, access })
                    : await this.graphRepository.upsertDecision(graphInput);
            } catch (error) {
                if (error?.code !== 'knowledge_graph_subject_conflict') throw error;
                const conflictReason = 'unresolved_conflict';
                await this.candidateRepository.updateSemanticState(
                    candidate.id,
                    'quarantined',
                    client ? { client, reason: conflictReason } : { reason: conflictReason }
                );
                const result = {
                    event_id: event.event_id,
                    candidate_id: candidate.id,
                    processing_stage: 'resolved',
                    semantic_state: 'quarantined',
                    quarantine_reason: conflictReason
                };
                if (client) await eventRepository.saveResult?.(event.event_id, result, { client });
                else await eventRepository.saveResult?.(event.event_id, result);
                return result;
            }
            graphEntityId = graphEntity.id;
            await this.candidateRepository.transitionWithAudit(
                candidate.id,
                'promoted_to_graph',
                {
                    actor_person_id: event.decision_authority.decider_id,
                    decision_owner_person_id: event.decision_authority.decider_id,
                    decision_reason: 'knowledge_event_graph_promotion',
                    evidence_ids: [event.event_id]
                },
                {
                    ...(client ? { client } : {}),
                    requires_approval: false,
                    promoted_graph_entity_id: graphEntityId
                }
            );
        }
        await this._appendStage(eventRepository, event.event_id, candidate.id, 'indexed', client);
        await this._appendStage(eventRepository, event.event_id, candidate.id, 'retrievable', client);
        const result = {
            event_id: event.event_id,
            candidate_id: candidate.id,
            graph_entity_id: graphEntityId,
            processing_stage: 'retrievable',
            semantic_state: 'active'
        };
        if (client) await eventRepository.saveResult?.(event.event_id, result, { client });
        else await eventRepository.saveResult?.(event.event_id, result);
        return result;
    }

    async ingest(event, context = {}) {
        const organizationId = context.access?.organizationId
            || context.access?.tenantId
            || event.organization_id
            || event.applicability_scope?.organization_id
            || null;
        const scopedEvent = {
            ...event,
            ...(organizationId ? { organization_id: organizationId } : {}),
            ...(event.applicability_scope ? {
                applicability_scope: {
                    ...event.applicability_scope,
                    ...(organizationId ? { organization_id: organizationId } : {})
                }
            } : {})
        };
        const scopedContext = organizationId
            ? {
                ...context,
                access: { ...(context.access || {}), organizationId }
            }
            : context;
        requireKnowledgeEvent(scopedEvent);
        const active = this.inFlight.get(scopedEvent.event_id);
        if (active) {
            if (!sameEventIdentity(active.event, scopedEvent)) throw new KnowledgeEventConflictError(scopedEvent.event_id);
            const result = await active.promise;
            return { ...result, idempotent: true };
        }
        const operation = this._ingestWithContext(scopedEvent, scopedContext);
        this.inFlight.set(scopedEvent.event_id, { event: structuredClone(scopedEvent), promise: operation });
        try {
            return await operation;
        } finally {
            this.inFlight.delete(scopedEvent.event_id);
        }
    }

    /**
     * Persist an event inside a caller-owned transaction without opening a
     * second transaction. Promotion flows use this to record the
     * organization review event before their explicit normalized Graph write;
     * the event service must not project the same decision implicitly.
     */
    async ingestInTransaction(event, {
        client,
        access = null,
        skipGraphProjection = false
    } = {}) {
        if (!client) {
            const error = new Error('knowledge_event_transaction_required');
            error.code = 'knowledge_event_transaction_required';
            throw error;
        }
        await this.eventRepository.ensureSchema?.();
        return this._ingest(event, {
            eventRepository: this.eventRepository,
            client,
            access,
            skipGraphProjection
        });
    }

    async _ingestWithContext(event, context = {}) {
        await this.eventRepository.ensureSchema?.();
        if (context.transaction) {
            return this._ingest(event, {
                eventRepository: context.transaction,
                client: context.transaction.client || null,
                access: context.access || null
            });
        }
        if (typeof this.eventRepository.withTransaction === 'function') {
            return this.eventRepository.withTransaction((transactionRepository) => this._ingest(event, {
                eventRepository: transactionRepository,
                client: transactionRepository.client,
                access: context.access || null
            }), { access: context.access || null });
        }
        return this._ingest(event, context);
    }
}

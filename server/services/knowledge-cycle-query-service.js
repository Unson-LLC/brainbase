export class KnowledgeCycleNotFoundError extends Error {
    constructor(eventId) {
        super(`knowledge cycle not found: ${eventId}`);
        this.name = 'KnowledgeCycleNotFoundError';
        this.code = 'knowledge_cycle_not_found';
    }
}

export class KnowledgeCycleAccessDeniedError extends Error {
    constructor(eventId) {
        super(`knowledge cycle access denied: ${eventId}`);
        this.name = 'KnowledgeCycleAccessDeniedError';
        this.code = 'knowledge_project_access_denied';
    }
}

export class KnowledgeCycleQueryService {
    constructor({ eventRepository, candidateRepository }) {
        this.eventRepository = eventRepository;
        this.candidateRepository = candidateRepository;
    }

    async _readCycle(eventId, { access, requestedProjectCode, eventRepository, client = null }) {
        const event = await eventRepository.findById(eventId, requestedProjectCode
            ? { projectCode: requestedProjectCode, ...(client ? { client } : {}) }
            : (client ? { client } : undefined));
        if (!event) throw new KnowledgeCycleNotFoundError(eventId);
        const projectCode = event.project_code || event.applicability_scope?.project_code || null;
        if (requestedProjectCode && projectCode !== requestedProjectCode) {
            throw new KnowledgeCycleAccessDeniedError(eventId);
        }
        if (access && projectCode && !access.projectCodes?.includes(projectCode)) {
            throw new KnowledgeCycleAccessDeniedError(eventId);
        }
        let candidate = null;
        if (typeof this.candidateRepository.findByEventId === 'function') {
            candidate = await this.candidateRepository.findByEventId(eventId, {
                ...(requestedProjectCode ? { projectCode: requestedProjectCode } : {}),
                ...(client ? { client } : {})
            });
        } else if (typeof this.candidateRepository.list === 'function') {
            const candidates = await this.candidateRepository.list({ source_event_prefix: eventId });
            candidate = candidates.find((item) => item.source_event_ids?.includes(eventId)) || null;
        }
        const stageHistory = event.stage_history || [];
        const retrievable = stageHistory.find((entry) => entry.stage === 'retrievable');
        return {
            schema_version: 'knowledge_cycle_receipt.v1',
            event_id: eventId,
            candidate_id: candidate?.id || event.candidate_id || null,
            processing_stage: candidate?.processing_stage || stageHistory.at(-1)?.stage || 'received',
            semantic_state: candidate?.semantic_state || event.semantic_state || 'active',
            failure_reason: candidate?.quarantine_reason || event.failure_reason || null,
            retrievable_at: retrievable?.occurred_at || null,
            stage_history: stageHistory
        };
    }

    async getCycle(eventId, { access, projectCode: requestedProjectCode } = {}) {
        await this.eventRepository.ensureSchema?.();
        if (access && typeof this.eventRepository.withTransaction === 'function') {
            return this.eventRepository.withTransaction((transactionRepository) => this._readCycle(eventId, {
                access,
                requestedProjectCode,
                eventRepository: transactionRepository,
                client: transactionRepository.client || null
            }), { access });
        }
        return this._readCycle(eventId, {
            access,
            requestedProjectCode,
            eventRepository: this.eventRepository
        });
    }
}

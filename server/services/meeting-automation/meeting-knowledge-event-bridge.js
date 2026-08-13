import { createHash } from 'node:crypto';

function stableId(prefix, ...parts) {
    const digest = createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 24);
    return `${prefix}_${digest}`;
}

function candidateBase(input, sourceEventId, subjectType, subjectId, body) {
    return {
        id: stableId('cand', sourceEventId),
        cognitive_type: 'observation',
        owner_person_id: input.access?.actor_person_id || 'brainbase',
        actor_person_id: input.access?.actor_person_id || 'brainbase',
        source_system: 'meeting_review_package',
        source_event_ids: [sourceEventId],
        project_code: input.projectCode,
        org_ids: [],
        project_ids: [input.projectCode],
        visibility: 'org',
        sensitivity: 'internal',
        permission_snapshot: { visibility: 'org', contains_pii: false },
        evidence_ids: [input.sourceEvent.event_id],
        body,
        recommended_subject_type: subjectType,
        recommended_subject_id: subjectId,
        processing_stage: 'resolved',
        semantic_state: 'active',
        target_tier: 'episode',
        requires_approval: true
    };
}

function candidateIds(value) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return [...new Set(values
        .map((entry) => typeof entry === 'string' ? entry : entry?.id)
        .filter((id) => typeof id === 'string' && id.length > 0))].sort();
}

function sameCandidateIds(left, right) {
    return JSON.stringify(candidateIds(left)) === JSON.stringify(candidateIds(right));
}

function rawCandidateIds(value) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return values.map((entry) => typeof entry === 'string' ? entry : entry?.id);
}

function hasInvalidCandidateIds(...collections) {
    return collections.some((collection) => {
        const ids = rawCandidateIds(collection);
        return ids.some((id) => typeof id !== 'string' || id.length === 0)
            || new Set(ids).size !== ids.length;
    });
}

function sameCandidateIdentity(existing, incoming) {
    const fields = [
        'id', 'source_event_ids', 'project_code', 'recommended_subject_type',
        'recommended_subject_id', 'body', 'target_tier', 'requires_approval'
    ];
    return fields.every((field) => JSON.stringify(existing?.[field]) === JSON.stringify(incoming?.[field]));
}

function candidateIdentityConflict(sourceEventId) {
    const error = new Error(`meeting candidate identity conflict: ${sourceEventId}`);
    error.code = 'meeting_candidate_identity_conflict';
    return error;
}

export class MeetingKnowledgeEventBridge {
    constructor({ knowledgeEventService, candidateRepository, now = () => new Date().toISOString() }) {
        this.knowledgeEventService = knowledgeEventService;
        this.candidateRepository = candidateRepository;
        this.now = now;
        this.ingestedCandidates = new Map();
    }

    async _createCandidateOnce(input) {
        const sourceEventId = input.source_event_ids[0];
        const ingested = this.ingestedCandidates.get(sourceEventId);
        if (ingested) {
            if (!sameCandidateIdentity(ingested, input)) throw candidateIdentityConflict(sourceEventId);
            return null;
        }
        if (typeof this.candidateRepository.findByEventId === 'function'
        ) {
            const existing = await this.candidateRepository.findByEventId(sourceEventId);
            if (existing) {
                if (!sameCandidateIdentity(existing, input)) throw candidateIdentityConflict(sourceEventId);
                this.ingestedCandidates.set(sourceEventId, structuredClone(input));
                return null;
            }
        }
        try {
            const created = await this.candidateRepository.create(input);
            this.ingestedCandidates.set(sourceEventId, structuredClone(input));
            return created;
        } catch (error) {
            if (error?.name !== 'DuplicateCandidateError') throw error;
            const existing = await this.candidateRepository.findByEventId?.(sourceEventId);
            if (!existing || !sameCandidateIdentity(existing, input)) {
                throw candidateIdentityConflict(sourceEventId);
            }
            this.ingestedCandidates.set(sourceEventId, structuredClone(input));
            return null;
        }
    }

    preflight(input) {
        const decisions = input.reviewPackage?.decision_candidates;
        if (!Array.isArray(decisions) || !Array.isArray(input.runnerResult?.decision_candidates)) {
            return { status: 'partial', failure_reason: 'decision_candidates_missing' };
        }
        if (hasInvalidCandidateIds(
            decisions,
            input.runnerResult.decision_candidates,
            input.reviewPackage?.task_candidates,
            input.runnerResult?.task_candidates,
            input.reviewPackage?.follow_up_draft?.body ? input.reviewPackage.follow_up_draft : [],
            input.runnerResult?.follow_up_draft?.body ? input.runnerResult.follow_up_draft : []
        )) {
            return { status: 'partial', failure_reason: 'candidate_id_invalid' };
        }
        if (!sameCandidateIds(decisions, input.runnerResult.decision_candidates)
            || !sameCandidateIds(input.reviewPackage?.task_candidates, input.runnerResult?.task_candidates)
            || !sameCandidateIds(input.reviewPackage?.follow_up_draft, input.runnerResult?.follow_up_draft)) {
            return { status: 'partial', failure_reason: 'candidate_id_set_mismatch' };
        }
        if (input.runnerResult.status && input.runnerResult.status !== 'completed') {
            return { status: 'partial', failure_reason: 'runner_incomplete' };
        }
        return null;
    }

    async ingest(input) {
        const preflightResult = this.preflight(input);
        if (preflightResult) return preflightResult;
        const decisions = input.reviewPackage.decision_candidates;

        const parentEpisodeId = stableId('episode', input.packageId, input.runId);
        const decisionResults = [];
        for (const decision of decisions) {
            const event = {
                schema_version: 'knowledge_event.v1',
                event_id: stableId('kev', input.packageId, input.runId, decision.id),
                occurred_at: input.sourceEvent.occurred_at,
                captured_at: this.now(),
                source: { type: 'meeting_review_package', id: input.packageId, run_id: input.runId },
                subject: { type: 'decision', id: decision.id },
                decision_authority: decision.decision_authority,
                applicability_scope: decision.applicability_scope,
                permission_snapshot: { visibility: 'org', contains_pii: false },
                source_pointer: input.sourceEvent.source_pointer,
                body_hash: `sha256:${createHash('sha256').update(decision.statement).digest('hex')}`,
                parent_episode_id: parentEpisodeId,
                decision: { statement: decision.statement }
            };
            decisionResults.push(await this.knowledgeEventService.ingest(event, { access: input.access }));
        }

        const taskCandidates = [];
        for (const task of input.reviewPackage.task_candidates || []) {
            const taskSourceEventId = stableId('meeting_task', input.packageId, input.runId, task.id);
            await this._createCandidateOnce(candidateBase(input, taskSourceEventId, 'task', task.id, task.title));
            taskCandidates.push({ ...task, status: 'approval_required' });
        }

        let followUpDraft = null;
        const draft = input.reviewPackage.follow_up_draft;
        if (draft?.body) {
            const followUpId = draft.id || stableId('followup', input.packageId, input.runId);
            const followUpSourceEventId = stableId('meeting_followup', input.packageId, input.runId, followUpId);
            await this._createCandidateOnce(candidateBase(
                input,
                followUpSourceEventId,
                'follow_up',
                followUpId,
                draft.body
            ));
            followUpDraft = {
                ...draft,
                status: 'draft_only',
                external_send_required_approval: true
            };
        }

        return {
            status: 'completed',
            parent_episode_id: parentEpisodeId,
            decision_count: decisionResults.length,
            decision_results: decisionResults,
            task_candidates: taskCandidates,
            follow_up_draft: followUpDraft
        };
    }
}

import { createHash } from 'node:crypto';

function required(value, field) {
    if (value === undefined || value === null || value === '') throw new Error(`personal_knowledge_invalid:${field}`);
    return value;
}

function eventId(input, access) {
    if (input.event_id) return input.event_id;
    const identity = access ? [access.organizationId, access.personId, input] : input;
    // The namespaced ID must be stable across equivalent JSON key orderings.
    // Keep the access-less form byte-compatible for legacy retry lookup below.
    const serialized = access ? canonicalJson(identity) : JSON.stringify(identity);
    return `pke_${createHash('sha256').update(serialized).digest('hex').slice(0, 24)}`;
}

async function findExistingEvent(repository, input, event, options) {
    const existing = await repository.findById(event.event_id, options);
    // Preserve retries of pre-namespace generated IDs, still inside owner RLS.
    return existing || (!input.event_id ? await repository.findById(eventId(input), options) : null);
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sameEventIdentity(existing, incoming) {
    const identityFields = ['body_hash', 'source', 'source_pointer', 'parent_episode_id'];
    return identityFields.every((field) => existing[field] === undefined
        || canonicalJson(existing[field]) === canonicalJson(incoming[field]));
}

const FEEDBACK_ACTIONS = new Set(['adopt', 'correct', 'reject', 'not_useful']);

export class PersonalKnowledgeService {
    constructor({ repository, now = () => new Date() }) {
        if (!repository) throw new Error('PersonalKnowledgeService requires repository');
        this.repository = repository;
        this.now = now;
    }

    async ingest(input, { access } = {}) {
        required(access?.personId, 'person_id');
        required(access?.organizationId, 'organization_id');
        const event = {
            ...input,
            event_id: eventId(input, access),
            source: input.source || {},
            source_pointer: input.source_pointer || {},
            parent_episode_id: input.parent_episode_id || null,
            owner_person_id: access.personId,
            organization_id: access.organizationId,
            occurred_at: input.occurred_at || this.now().toISOString(),
            captured_at: input.captured_at || this.now().toISOString(),
            body_hash: required(input.body_hash, 'body_hash')
        };
        const run = async ({ client } = {}) => {
            const options = { client, access };
            const existing = await findExistingEvent(this.repository, input, event, options);
            if (existing) {
                if (!sameEventIdentity(existing, event)) throw new Error('personal_knowledge_event_identity_conflict');
                return { ...existing, idempotent: true };
            }
            const created = await this.repository.createEvent(event, options);
            if (!created) {
                const concurrent = await this.repository.findById(event.event_id, options);
                if (concurrent && sameEventIdentity(concurrent, event)) return { ...concurrent, idempotent: true };
                throw new Error('personal_knowledge_event_identity_conflict');
            }
            await this.repository.appendTransition(event.event_id, {
                transition_type: 'processing_stage', processing_stage: 'received', occurred_at: this.now().toISOString()
            }, options);
            await this.repository.appendTransition(event.event_id, {
                transition_type: 'semantic_state', semantic_state: 'active', occurred_at: this.now().toISOString()
            }, options);
            return { ...event, processing_stage: 'received', semantic_state: 'active' };
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async search(input, { access } = {}) {
        required(access?.personId, 'person_id');
        required(access?.organizationId, 'organization_id');
        const run = ({ client } = {}) => this.repository.search(
            { ...input, limit: Number(input.limit || 10) },
            { access, client }
        );
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async getCycle(eventIdValue, { access } = {}) {
        required(access?.personId, 'person_id');
        required(access?.organizationId, 'organization_id');
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const event = await this.repository.findById(eventIdValue, options);
            if (!event) return null;
            const transitions = await this.repository.listTransitions(eventIdValue, options);
            return { event_id: eventIdValue, event, transitions };
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async recordUsage(eventIdValue, { access } = {}) {
        required(access?.personId, 'person_id');
        required(access?.organizationId, 'organization_id');
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const event = await this.repository.findById(eventIdValue, options);
            if (!event) throw new Error('personal_knowledge_event_not_found');
            return this.repository.appendTransition(eventIdValue, {
                transition_type: 'usage',
                payload: { routine: 'ohayo', outcome: 'used' },
                occurred_at: this.now().toISOString()
            }, options);
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async recordFeedback(feedback, { access } = {}) {
        required(access?.personId, 'person_id');
        required(access?.organizationId, 'organization_id');
        const eventIdValue = required(feedback?.event_id, 'event_id');
        const action = required(feedback?.action, 'action');
        if (!FEEDBACK_ACTIONS.has(action)) throw new Error('personal_knowledge_feedback_invalid:action');

        const run = async ({ client } = {}) => {
            const options = { access, client };
            const current = await this.repository.findById(eventIdValue, options);
            if (!current) throw new Error('personal_knowledge_event_not_found');
            const occurredAt = this.now().toISOString();

            if (action === 'adopt' || action === 'not_useful') {
                await this.repository.appendTransition(eventIdValue, {
                    transition_type: 'feedback',
                    payload: {
                        routine: 'oyasumi',
                        action,
                        ...(feedback.reason ? { reason: feedback.reason } : {})
                    },
                    occurred_at: occurredAt
                }, options);
                return { event_id: eventIdValue, action, semantic_state: current.semantic_state || 'active' };
            }

            if (action === 'reject') {
                await this.repository.appendTransition(eventIdValue, {
                    transition_type: 'semantic_state',
                    semantic_state: 'retracted',
                    ...(feedback.reason ? { reason: feedback.reason } : {}),
                    payload: { routine: 'oyasumi', action },
                    occurred_at: occurredAt
                }, options);
                return { event_id: eventIdValue, action, semantic_state: 'retracted' };
            }

            const correctionInput = required(feedback.correction_event, 'correction_event');
            if (correctionInput.corrects_event_id !== eventIdValue) {
                throw new Error('personal_knowledge_feedback_invalid:corrects_event_id');
            }
            const replacement = {
                ...correctionInput,
                event_id: eventId(correctionInput, access),
                source: correctionInput.source || {},
                source_pointer: correctionInput.source_pointer || {},
                parent_episode_id: correctionInput.parent_episode_id || null,
                owner_person_id: access.personId,
                organization_id: access.organizationId,
                occurred_at: correctionInput.occurred_at || occurredAt,
                captured_at: correctionInput.captured_at || occurredAt,
                body_hash: required(correctionInput.body_hash, 'correction_event.body_hash')
            };
            const existingReplacement = await findExistingEvent(this.repository, correctionInput, replacement, options);
            if (existingReplacement && !sameEventIdentity(existingReplacement, replacement)) {
                throw new Error('personal_knowledge_event_identity_conflict');
            }
            if (existingReplacement) replacement.event_id = existingReplacement.event_id;
            if (!existingReplacement) {
                const created = await this.repository.createEvent(replacement, options);
                if (!created) throw new Error('personal_knowledge_event_identity_conflict');
                await this.repository.appendTransition(replacement.event_id, {
                    transition_type: 'processing_stage', processing_stage: 'received', occurred_at: occurredAt
                }, options);
                await this.repository.appendTransition(replacement.event_id, {
                    transition_type: 'semantic_state', semantic_state: 'active', occurred_at: occurredAt
                }, options);
            }
            await this.repository.appendTransition(eventIdValue, {
                transition_type: 'semantic_state',
                semantic_state: 'superseded',
                supersedes_event_id: replacement.event_id,
                ...(feedback.reason ? { reason: feedback.reason } : {}),
                payload: { routine: 'oyasumi', action },
                occurred_at: occurredAt
            }, options);
            return {
                event_id: eventIdValue,
                action,
                semantic_state: 'superseded',
                replacement_event_id: replacement.event_id
            };
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async summarizeRoutineState(input, { access } = {}) {
        return this.#runRepositoryMethod('summarizeRoutineState', input, access);
    }

    async compressRoutineEpisodes(input, { access } = {}) {
        return this.#runRepositoryMethod('compressRoutineEpisodes', input, access);
    }

    async verifyRoutineRetrievability(input, { access } = {}) {
        return this.#runRepositoryMethod('verifyRoutineRetrievability', input, access);
    }

    async auditAccess(entry) {
        const access = {
            personId: required(entry?.personId, 'person_id'),
            organizationId: required(entry?.organizationId, 'organization_id'),
            actorPersonId: required(entry?.actorPersonId, 'actor_person_id'),
            role: entry.role || 'member',
            projectCodes: entry.projectCodes || [],
            clearance: entry.clearance || ['internal']
        };
        const run = ({ client } = {}) => this.repository.recordPrivilegedAccess(
            { ...entry, occurredAt: this.now().toISOString() },
            { access, client }
        );
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async #runRepositoryMethod(method, input, access) {
        required(access?.personId, 'person_id');
        required(access?.organizationId, 'organization_id');
        const run = ({ client } = {}) => this.repository[method](input, { access, client });
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }
}

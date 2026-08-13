import { createHash } from 'node:crypto';

function required(value, field) {
    if (value === undefined || value === null || value === '') throw new Error(`personal_knowledge_invalid:${field}`);
    return value;
}

function eventId(input) {
    if (input.event_id) return input.event_id;
    return `pke_${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24)}`;
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
            event_id: eventId(input),
            owner_person_id: access.personId,
            organization_id: access.organizationId,
            occurred_at: input.occurred_at || this.now().toISOString(),
            captured_at: input.captured_at || this.now().toISOString(),
            body_hash: required(input.body_hash, 'body_hash')
        };
        const run = async ({ client } = {}) => {
            const options = { client, access };
            const existing = await this.repository.findById(event.event_id, options);
            if (existing) {
                if (!sameEventIdentity(existing, event)) throw new Error('personal_knowledge_event_identity_conflict');
                return { ...existing, idempotent: true };
            }
            await this.repository.createEvent(event, options);
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

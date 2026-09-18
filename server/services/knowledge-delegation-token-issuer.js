const KNOWLEDGE_RETRIEVE_CAPABILITY = 'knowledge.retrieve';
const DEFAULT_TTL_SECONDS = 60;

function nonEmptyString(value, label, maxLength = 256) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
        throw new TypeError(`${label} is required`);
    }
    return value.trim();
}

function normalizeRefs(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
        throw new TypeError('knowledge_refs are required');
    }
    const refs = value.map((ref) => {
        if (!ref || typeof ref !== 'object' || Array.isArray(ref)
            || Object.keys(ref).some((key) => !['id', 'version'].includes(key))) {
            throw new TypeError('knowledge_refs are invalid');
        }
        return {
            id: nonEmptyString(ref.id, 'knowledge ref id', 512),
            version: nonEmptyString(ref.version, 'knowledge ref version', 128)
        };
    }).sort((left, right) => `${left.id}\u0000${left.version}`.localeCompare(`${right.id}\u0000${right.version}`));
    if (new Set(refs.map((ref) => `${ref.id}\u0000${ref.version}`)).size !== refs.length) {
        throw new TypeError('knowledge_refs must be unique');
    }
    return refs;
}

function normalizeRequest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('JSON object body is required');
    const supported = new Set([
        'organization_id', 'delegated_actor_person_id', 'project_code', 'outcome_contract_id',
        'outcome_contract_version', 'run_id', 'run_mode', 'knowledge_refs'
    ]);
    if (Object.keys(input).some((key) => !supported.has(key))) throw new TypeError('request contains unsupported fields');
    const version = Number(input.outcome_contract_version);
    if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('outcome_contract_version is invalid');
    const runMode = nonEmptyString(input.run_mode, 'run_mode');
    if (!['normal', 'safe_test'].includes(runMode)) throw new TypeError('run_mode is invalid');
    return {
        organization_id: nonEmptyString(input.organization_id, 'organization_id'),
        delegated_actor_person_id: nonEmptyString(input.delegated_actor_person_id, 'delegated_actor_person_id'),
        project_code: nonEmptyString(input.project_code, 'project_code', 128),
        outcome_contract_id: nonEmptyString(input.outcome_contract_id, 'outcome_contract_id'),
        outcome_contract_version: version,
        run_id: nonEmptyString(input.run_id, 'run_id'),
        run_mode: runMode,
        knowledge_refs: normalizeRefs(input.knowledge_refs)
    };
}

function sameRefs(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

export class KnowledgeDelegationTokenIssuer {
    constructor({ authService, authorityProvider, ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
        if (typeof authService?.issueServiceToken !== 'function') throw new TypeError('authService is required');
        if (typeof authorityProvider?.verifyAuthority !== 'function') throw new TypeError('authorityProvider is required');
        this.authService = authService;
        this.authorityProvider = authorityProvider;
        this.ttlSeconds = ttlSeconds;
    }

    async issue(input, serviceIdentity) {
        const request = normalizeRequest(input);
        const serviceSubject = nonEmptyString(serviceIdentity?.subject, 'authenticated service subject');
        const binding = await this.authorityProvider.verifyAuthority(request);
        const projectCodes = Array.isArray(binding?.authorized_project_codes) ? binding.authorized_project_codes : [];
        if (binding?.organization_id !== request.organization_id
            || binding?.delegated_actor_person_id !== request.delegated_actor_person_id
            || !projectCodes.includes(request.project_code)
            || binding?.capability !== KNOWLEDGE_RETRIEVE_CAPABILITY
            || binding?.outcome_contract_id !== request.outcome_contract_id
            || binding?.run_id !== request.run_id
            || Number(binding?.contract_version) !== request.outcome_contract_version
            || binding?.run_mode !== request.run_mode
            || !sameRefs(binding?.knowledge_refs, request.knowledge_refs)) {
            throw new Error('authority readback does not match the requested delegation');
        }
        const issued = this.authService.issueServiceToken({
            name: 'Mana knowledge delegation',
            serviceId: serviceSubject,
            organizationId: request.organization_id,
            projectCodes: [request.project_code],
            capabilities: [KNOWLEDGE_RETRIEVE_CAPABILITY],
            ttlSeconds: this.ttlSeconds,
            knowledgeDelegation: {
                delegated_actor_person_id: request.delegated_actor_person_id,
                project_code: request.project_code,
                outcome_contract_id: request.outcome_contract_id,
                outcome_contract_version: request.outcome_contract_version,
                run_id: request.run_id,
                run_mode: request.run_mode,
                knowledge_refs: request.knowledge_refs
            }
        });
        return {
            token: issued.token,
            token_type: issued.token_type,
            expires_at: issued.expires_at,
            binding: {
                organization_id: request.organization_id,
                delegated_actor_person_id: request.delegated_actor_person_id,
                service_subject: serviceSubject,
                project_code: request.project_code,
                outcome_contract_id: request.outcome_contract_id,
                outcome_contract_version: request.outcome_contract_version,
                run_id: request.run_id,
                run_mode: request.run_mode,
                knowledge_refs: request.knowledge_refs,
                authority_revision: binding.authority_revision,
                profile_id: binding.profile_id
            }
        };
    }
}

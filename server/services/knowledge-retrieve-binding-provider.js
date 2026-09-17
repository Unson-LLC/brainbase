import { KNOWLEDGE_RETRIEVE_CAPABILITY } from '../middleware/knowledge-retrieve-service-auth.js';

/**
 * The named Mana service exposes the outcome-authority Durable Object's
 * persisted binding through this contract. Brainbase deliberately talks to
 * this readback surface instead of accepting a caller-supplied x-mana header
 * or treating a request body as an authorization record.
 */
export const MANA_OUTCOME_AUTHORITY_READBACK_PATH = '/v1/outcome-authority:readback';
export const MANA_OUTCOME_AUTHORITY_READBACK_URL_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_READBACK_URL';
export const MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE';

const DEFAULT_TIMEOUT_MS = 5_000;

function nonEmptyString(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

function firstDefined(object, names) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
    for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(object, name) && object[name] !== undefined) {
            return object[name];
        }
    }
    return undefined;
}

function aliasedString(object, names, label, { required = true } = {}) {
    const values = names
        .map((name) => nonEmptyString(firstDefined(object, [name])))
        .filter(Boolean);
    const unique = [...new Set(values)];
    if (unique.length > 1) throw new Error(`${label} claims are ambiguous`);
    if (unique.length === 0) {
        if (required) throw new Error(`${label} claim is required`);
        return null;
    }
    return unique[0];
}

function list(value) {
    if (Array.isArray(value)) {
        return [...new Set(value.flatMap((item) => {
            if (typeof item === 'string') return [item.trim()];
            if (item && typeof item === 'object') {
                return [item.code, item.project_code, item.projectCode]
                    .filter((candidate) => typeof candidate === 'string')
                    .map((candidate) => candidate.trim());
            }
            return [];
        }).filter(Boolean))];
    }
    if (typeof value === 'string') {
        return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
    }
    return [];
}

function aliasedList(object, names, label, { required = true } = {}) {
    const values = names
        .map((name) => firstDefined(object, [name]))
        .filter((value) => value !== undefined && value !== null);
    if (values.length === 0) {
        if (required) throw new Error(`${label} claim is required`);
        return [];
    }
    const normalized = values.map(list);
    const first = normalized[0];
    if (normalized.slice(1).some((candidate) => candidate.length !== first.length
        || candidate.some((item, index) => item !== first[index]))) {
        throw new Error(`${label} claims are ambiguous`);
    }
    if (first.length === 0 && required) throw new Error(`${label} claim is required`);
    return first;
}

function resolveEndpoint(endpoint) {
    const value = nonEmptyString(endpoint);
    if (!value) return null;
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
        return null;
    }
    if (url.search) return null;
    if (url.pathname === '' || url.pathname === '/') {
        url.pathname = MANA_OUTCOME_AUTHORITY_READBACK_PATH;
    } else if (url.pathname !== MANA_OUTCOME_AUTHORITY_READBACK_PATH) {
        return null;
    }
    return url.toString();
}

function resolveActorId(claims) {
    const raw = firstDefined(claims, [
        'delegated_actor_person_id',
        'delegatedActorPersonId',
        'delegated_actor_id',
        'delegatedActorId',
        'delegated_actor',
        'delegatedActor',
        'person_id',
        'personId'
    ]);
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return aliasedString(raw, ['person_id', 'personId', 'actor_id', 'actorId', 'id'], 'delegated actor');
    }
    const actor = nonEmptyString(raw);
    if (!actor) throw new Error('delegated actor claim is required');
    return actor;
}

function resolveTokenIdentity(expected, context = {}) {
    const claims = context.verifiedToken || context.tokenClaims || {};
    const serviceIdentity = context.serviceIdentity || {};
    const subject = nonEmptyString(serviceIdentity.subject)
        || aliasedString(claims, ['subject', 'sub'], 'service subject');
    if (!subject) throw new Error('service subject is required');

    const subjectClaim = aliasedString(claims, ['subject', 'sub'], 'service subject', { required: false });
    if (subjectClaim && subjectClaim !== subject) throw new Error('service subject does not match verified identity');

    const organizationId = aliasedString(claims, [
        'organization_id', 'organizationId', 'tenant_id', 'tenantId'
    ], 'organization');
    const delegatedActorPersonId = resolveActorId(claims);
    const projectCodes = aliasedList(claims, [
        'authorized_project_codes', 'authorizedProjectCodes', 'project_codes', 'projectCodes'
    ], 'authorized project');
    if (!projectCodes.includes(expected.project_code)) {
        throw new Error(`project '${expected.project_code}' is not authorized by the verified service token`);
    }

    const capabilities = list(firstDefined(claims, ['capabilities', 'capability']));
    if (!capabilities.includes(KNOWLEDGE_RETRIEVE_CAPABILITY)) {
        throw new Error('knowledge.retrieve capability is required');
    }

    const tokenContractId = aliasedString(claims, [
        'outcome_contract_id', 'outcomeContractId', 'contract_id', 'contractId'
    ], 'outcome contract', { required: false });
    const tokenRunId = aliasedString(claims, ['run_id', 'runId', 'outcome_run_id', 'outcomeRunId'], 'outcome run', {
        required: false
    });
    if (tokenContractId && tokenContractId !== expected.outcome_contract_id) {
        throw new Error('outcome contract does not match the verified service token');
    }
    if (tokenRunId && tokenRunId !== expected.run_id) {
        throw new Error('outcome run does not match the verified service token');
    }

    const contractVersionValue = firstDefined(claims, [
        'outcome_contract_version', 'outcomeContractVersion', 'contract_version', 'contractVersion'
    ]);
    const contractVersion = Number(contractVersionValue);
    if (!Number.isSafeInteger(contractVersion) || contractVersion < 1) {
        throw new Error('outcome contract version claim is required');
    }

    const expectedOrganizationId = nonEmptyString(expected.organization_id || expected.organizationId);
    if (expectedOrganizationId && expectedOrganizationId !== organizationId) {
        throw new Error('organization does not match the verified service token');
    }
    const expectedActorId = nonEmptyString(
        expected.delegated_actor_person_id || expected.delegatedActorPersonId
    );
    if (expectedActorId && expectedActorId !== delegatedActorPersonId) {
        throw new Error('delegated actor does not match the verified service token');
    }

    return {
        serviceSubject: subject,
        organizationId,
        delegatedActorPersonId,
        projectCodes,
        contractVersion
    };
}

function expectedInput(expected) {
    const outcomeContractId = nonEmptyString(expected?.outcome_contract_id || expected?.outcomeContractId);
    const runId = nonEmptyString(expected?.run_id || expected?.runId);
    const projectCode = nonEmptyString(expected?.project_code || expected?.projectCode);
    if (!outcomeContractId || !runId || !projectCode) {
        throw new Error('project, outcome contract and run are required');
    }
    return { outcomeContractId, runId, projectCode };
}

function assertReadbackShape(value, identity, resource) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Mana outcome authority readback is not an object');
    }
    const principal = value.principal;
    const persisted = value.persisted;
    if (!principal || typeof principal !== 'object' || !persisted || typeof persisted !== 'object') {
        throw new Error('Mana outcome authority readback is incomplete');
    }
    const tenantId = nonEmptyString(principal.tenant_id);
    const projectCode = nonEmptyString(principal.project_id);
    const actorId = nonEmptyString(principal.actor_principal_id);
    const contractId = nonEmptyString(persisted.contract_id);
    const contractVersion = nonEmptyString(persisted.contract_version);
    const runId = nonEmptyString(persisted.run_id);
    const resourceRef = nonEmptyString(persisted.resource_ref);
    if (!tenantId || !projectCode || !actorId || !contractId || !contractVersion || !runId || !resourceRef) {
        throw new Error('Mana outcome authority readback contains empty binding fields');
    }
    if (tenantId !== identity.organizationId
        || projectCode !== identity.projectCode
        || actorId !== identity.delegatedActorPersonId
        || contractId !== identity.outcomeContractId
        || runId !== identity.runId
        || resourceRef !== resource
        || contractVersion !== String(identity.contractVersion)) {
        throw new Error('Mana outcome authority readback does not match the requested binding');
    }

    const runMode = nonEmptyString(value.run_mode);
    const contractStatus = nonEmptyString(value.contract_status);
    if (!['normal', 'safe_test'].includes(runMode) || !['draft', 'active'].includes(contractStatus)) {
        throw new Error('Mana outcome authority readback status is invalid');
    }
    if (runMode === 'normal' && contractStatus !== 'active') {
        throw new Error('normal outcome runs require an active contract');
    }
    if (!nonEmptyString(value.authority_revision) || !nonEmptyString(value.profile_id)) {
        throw new Error('Mana outcome authority readback provenance is required');
    }

    return {
        organization_id: tenantId,
        delegated_actor_person_id: actorId,
        authorized_project_codes: [projectCode],
        capability: KNOWLEDGE_RETRIEVE_CAPABILITY,
        outcome_contract_id: contractId,
        run_id: runId,
        service_subject: identity.serviceSubject,
        contract_version: identity.contractVersion,
        resource_ref: resourceRef,
        authority_revision: value.authority_revision,
        profile_id: value.profile_id,
        run_mode: runMode,
        contract_status: contractStatus
    };
}

async function readResponseJson(response) {
    if (typeof response?.json === 'function') return response.json();
    if (typeof response?.text === 'function') return JSON.parse(await response.text());
    throw new Error('Mana outcome authority readback response is not readable');
}

/**
 * Creates the production binding verifier used by the Brainbase retrieve
 * boundary. A null result means the deployment has no configured authority
 * endpoint and must remain unavailable; callers must not substitute headers,
 * request-body identities, or token self-claims for this provider.
 */
export function createManaOutcomeAuthorityReadbackProvider({
    endpoint,
    resource,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
    const readbackEndpoint = resolveEndpoint(endpoint);
    const resourceRef = nonEmptyString(resource);
    const timeout = Number(timeoutMs);
    if (!readbackEndpoint || !resourceRef || typeof fetchImpl !== 'function'
        || !Number.isSafeInteger(timeout) || timeout < 1) {
        return null;
    }

    return {
        async verifyBinding(expected, context = {}) {
            const request = expectedInput(expected);
            const identity = resolveTokenIdentity(expected, context);
            const readbackRequest = {
                tenant: identity.organizationId,
                project: request.projectCode,
                actor: identity.delegatedActorPersonId,
                contract: request.outcomeContractId,
                version: identity.contractVersion,
                run: request.runId,
                resource: resourceRef
            };
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            let response;
            try {
                response = await fetchImpl(readbackEndpoint, {
                    method: 'POST',
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify(readbackRequest),
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutId);
            }
            if (!response?.ok) throw new Error('Mana outcome authority readback was denied');
            let payload;
            try {
                payload = await readResponseJson(response);
            } catch {
                throw new Error('Mana outcome authority readback JSON is invalid');
            }
            return assertReadbackShape(payload, {
                ...identity,
                projectCode: request.projectCode,
                outcomeContractId: request.outcomeContractId,
                runId: request.runId
            }, resourceRef);
        }
    };
}

export function createManaOutcomeAuthorityReadbackProviderFromEnv({
    env = process.env,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
    return createManaOutcomeAuthorityReadbackProvider({
        endpoint: env?.[MANA_OUTCOME_AUTHORITY_READBACK_URL_ENV],
        resource: env?.[MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE_ENV],
        fetchImpl,
        timeoutMs
    });
}


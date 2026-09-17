import { KNOWLEDGE_RETRIEVE_CAPABILITY } from '../middleware/knowledge-retrieve-service-auth.js';

/**
 * Mana exposes the outcome-authority Durable Object through a named
 * WorkerEntrypoint. This is intentionally a service-binding contract: the
 * Brainbase process must receive the binding/bridge as a dependency. A public
 * URL (or the process-global fetch) is never a substitute for that
 * authenticated transport.
 */
export const MANA_OUTCOME_AUTHORITY_READBACK_PATH = '/v1/outcome-authority:readback';
export const MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE';
export const MANA_OUTCOME_AUTHORITY_BRIDGE_URL_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_BRIDGE_URL';
export const MANA_OUTCOME_AUTHORITY_BRIDGE_HOSTNAME_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_BRIDGE_HOSTNAME';
export const MANA_OUTCOME_AUTHORITY_BRIDGE_SERVICE_TOKEN_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_BRIDGE_SERVICE_TOKEN';
export const MANA_OUTCOME_AUTHORITY_BRIDGE_ACCESS_CLIENT_ID_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_BRIDGE_ACCESS_CLIENT_ID';
export const MANA_OUTCOME_AUTHORITY_BRIDGE_ACCESS_CLIENT_SECRET_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_BRIDGE_ACCESS_CLIENT_SECRET';
export const MANA_OUTCOME_AUTHORITY_BRIDGE_ISSUER_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_BRIDGE_ISSUER';
export const MANA_OUTCOME_AUTHORITY_BRIDGE_AUDIENCE_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_BRIDGE_AUDIENCE';
export const MANA_OUTCOME_AUTHORITY_BRIDGE_DEPLOYMENT_ID_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_BRIDGE_DEPLOYMENT_ID';

// Kept as a source-compatible marker for deployments removing the old URL
// setting. It is deliberately not read by the provider.
export const MANA_OUTCOME_AUTHORITY_READBACK_URL_ENV = 'BRAINBASE_MANA_OUTCOME_AUTHORITY_READBACK_URL';

const SERVICE_BINDING_ORIGIN = 'https://mana-outcome-authority.internal';
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

function resolveBridgeEndpoint(endpoint, expectedHostname = undefined) {
    const value = nonEmptyString(endpoint);
    if (!value) return null;
    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }
    const hostname = nonEmptyString(expectedHostname)?.toLowerCase() || null;
    if (url.protocol !== 'https:' || url.username || url.password || url.port
        || !['', '/'].includes(url.pathname) || url.search || url.hash
        || (hostname && url.hostname.toLowerCase() !== hostname)) return null;
    url.pathname = MANA_OUTCOME_AUTHORITY_READBACK_PATH;
    return url.toString();
}

function serviceAuthMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const issuer = nonEmptyString(value.issuer);
    const audience = list(value.audience);
    const deploymentId = nonEmptyString(value.deploymentId ?? value.deployment_id);
    if (!issuer || audience.length === 0 || !deploymentId) return null;
    return Object.freeze({ issuer, audience, deploymentId });
}

function sameServiceAuth(left, right) {
    return Boolean(left && right && left.issuer === right.issuer
        && left.deploymentId === right.deploymentId
        && left.audience.length === right.audience.length
        && left.audience.every((item, index) => item === right.audience[index]));
}

function normalizeKnowledgeRefs(value, { required = true, label = 'knowledge refs' } = {}) {
    if (value === undefined || value === null) {
        if (required) throw new Error(`${label} claim is required`);
        return null;
    }
    if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
        throw new Error(`${label} must be a non-empty array`);
    }
    const refs = value.map((ref) => {
        if (!ref || typeof ref !== 'object' || Array.isArray(ref)) {
            throw new Error(`${label} entries must be objects`);
        }
        if (Object.keys(ref).some((key) => !['id', 'version'].includes(key))) {
            throw new Error(`${label} entries contain unsupported fields`);
        }
        const id = nonEmptyString(ref.id);
        const version = nonEmptyString(ref.version);
        if (!id || !version || id.length > 512 || version.length > 128) {
            throw new Error(`${label} entries require bounded id and version`);
        }
        return { id, version };
    });
    const seen = new Set();
    for (const ref of refs) {
        const key = `${ref.id}\u0000${ref.version}`;
        if (seen.has(key)) throw new Error(`${label} entries must be unique`);
        seen.add(key);
    }
    return refs.sort((left, right) => `${left.id}\u0000${left.version}`.localeCompare(`${right.id}\u0000${right.version}`));
}

function aliasedKnowledgeRefs(object, names, label, { required = true } = {}) {
    const values = names
        .map((name) => firstDefined(object, [name]))
        .filter((value) => value !== undefined && value !== null);
    if (values.length === 0) {
        if (required) throw new Error(`${label} claim is required`);
        return null;
    }
    const normalized = values.map((value) => normalizeKnowledgeRefs(value, { required: true, label }));
    const first = normalized[0];
    if (normalized.slice(1).some((candidate) => JSON.stringify(candidate) !== JSON.stringify(first))) {
        throw new Error(`${label} claims are ambiguous`);
    }
    return first;
}

function sameKnowledgeRefs(left, right) {
    return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function resolveServiceBinding({ serviceBinding, transport } = {}) {
    const candidate = serviceBinding ?? transport;
    if (typeof candidate === 'function') return { fetch: candidate };
    if (candidate && typeof candidate.fetch === 'function') return candidate;
    if (candidate && typeof candidate.request === 'function') {
        return { fetch: candidate.request.bind(candidate) };
    }
    return null;
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
    const request = expectedInput(expected);
    const claims = context.serviceTokenClaims || context.verifiedToken || context.tokenClaims || {};
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
    if (!projectCodes.includes(request.projectCode)) {
        throw new Error(`project '${request.projectCode}' is not authorized by the verified service token`);
    }

    const capabilities = list(firstDefined(claims, ['capabilities', 'capability']));
    if (!capabilities.includes(KNOWLEDGE_RETRIEVE_CAPABILITY)) {
        throw new Error('knowledge.retrieve capability is required');
    }

    const tokenContractId = aliasedString(claims, [
        'outcome_contract_id', 'outcomeContractId', 'contract_id', 'contractId'
    ], 'outcome contract');
    const tokenRunId = aliasedString(claims, [
        'run_id', 'runId', 'outcome_run_id', 'outcomeRunId'
    ], 'outcome run');
    if (tokenContractId !== request.outcomeContractId) {
        throw new Error('outcome contract does not match the verified service token');
    }
    if (tokenRunId !== request.runId) {
        throw new Error('outcome run does not match the verified service token');
    }

    const contractVersionValue = firstDefined(claims, [
        'outcome_contract_version', 'outcomeContractVersion', 'contract_version', 'contractVersion'
    ]);
    const contractVersion = Number(contractVersionValue);
    if (!Number.isSafeInteger(contractVersion) || contractVersion < 1) {
        throw new Error('outcome contract version claim is required');
    }
    if (request.contractVersion !== null && contractVersion !== request.contractVersion) {
        throw new Error('outcome contract version does not match the verified service token');
    }
    const runMode = aliasedString(claims, ['run_mode', 'runMode'], 'run mode', { required: false });
    if (request.runMode && runMode !== request.runMode) {
        throw new Error('run mode does not match the verified service token');
    }
    const knowledgeRefs = aliasedKnowledgeRefs(claims, ['knowledge_refs', 'knowledgeRefs'], 'knowledge refs', {
        required: false
    });
    if (request.knowledgeRefs && (!knowledgeRefs || !sameKnowledgeRefs(knowledgeRefs, request.knowledgeRefs))) {
        throw new Error('knowledge refs do not match the verified service token');
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
        // Signed-token retrieve is the legacy organization-scoped contract.
        // Keep its readback tenant explicit without treating the organization
        // as the tenant for the authority-readback contract.
        tenantId: null,
        readbackTenantId: organizationId,
        delegatedActorPersonId,
        projectCodes,
        outcomeContractId: tokenContractId,
        runId: tokenRunId,
        contractVersion,
        runMode,
        knowledgeRefs
    };
}

function expectedInput(expected) {
    const outcomeContractId = nonEmptyString(expected?.outcome_contract_id || expected?.outcomeContractId);
    const runId = nonEmptyString(expected?.run_id || expected?.runId);
    const projectCode = nonEmptyString(expected?.project_code || expected?.projectCode);
    if (!outcomeContractId || !runId || !projectCode) {
        throw new Error('project, outcome contract and run are required');
    }
    const contractVersionValue = firstDefined(expected, [
        'outcome_contract_version', 'outcomeContractVersion', 'contract_version', 'contractVersion'
    ]);
    const contractVersion = contractVersionValue === undefined
        ? null
        : Number(contractVersionValue);
    if (contractVersion !== null && (!Number.isSafeInteger(contractVersion) || contractVersion < 1)) {
        throw new Error('outcome contract version is invalid');
    }
    const runMode = aliasedString(expected, ['run_mode', 'runMode'], 'run mode', { required: false });
    if (runMode && !['normal', 'safe_test'].includes(runMode)) {
        throw new Error('run mode is invalid');
    }
    const knowledgeRefs = aliasedKnowledgeRefs(expected, ['knowledge_refs', 'knowledgeRefs', 'refs'], 'knowledge refs', {
        required: false
    });
    return { outcomeContractId, runId, projectCode, contractVersion, runMode, knowledgeRefs };
}

function resolveAuthorityIdentity(expected) {
    const request = expectedInput(expected);
    if (request.contractVersion === null) {
        throw new Error('outcome contract version is required for authority readback');
    }
    const tenantId = aliasedString(expected, [
        'tenant_id', 'tenantId'
    ], 'tenant');
    const organizationId = aliasedString(expected, [
        'organization_id', 'organizationId'
    ], 'organization');
    if (tenantId === organizationId) {
        throw new Error('tenant and organization must be distinct');
    }
    const delegatedActorPersonId = resolveActorId(expected);
    return {
        request,
        identity: {
            serviceSubject: null,
            tenantId,
            readbackTenantId: tenantId,
            organizationId,
            delegatedActorPersonId,
            projectCode: request.projectCode,
            outcomeContractId: request.outcomeContractId,
            runId: request.runId,
            contractVersion: request.contractVersion,
            runMode: request.runMode,
            knowledgeRefs: request.knowledgeRefs
        }
    };
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
    if (tenantId !== identity.readbackTenantId
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
    if (identity.runMode && identity.runMode !== runMode) {
        throw new Error('Mana outcome authority readback run mode does not match the requested binding');
    }
    const readbackKnowledgeRefs = aliasedKnowledgeRefs(value, ['knowledge_refs', 'knowledgeRefs'], 'knowledge refs', {
        required: false
    }) || aliasedKnowledgeRefs(persisted, ['knowledge_refs', 'knowledgeRefs'], 'knowledge refs', {
        required: false
    });
    if (identity.knowledgeRefs && (!readbackKnowledgeRefs
        || !sameKnowledgeRefs(readbackKnowledgeRefs, identity.knowledgeRefs))) {
        throw new Error('Mana outcome authority readback knowledge refs do not match the requested binding');
    }
    if (!nonEmptyString(value.authority_revision) || !nonEmptyString(value.profile_id)) {
        throw new Error('Mana outcome authority readback provenance is required');
    }

    return {
        ...(identity.tenantId ? { tenant_id: tenantId } : {}),
        organization_id: identity.organizationId,
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
        contract_status: contractStatus,
        ...(readbackKnowledgeRefs ? { knowledge_refs: readbackKnowledgeRefs } : {})
    };
}

async function readResponseJson(response) {
    if (typeof response?.json === 'function') return response.json();
    if (typeof response?.text === 'function') return JSON.parse(await response.text());
    throw new Error('Mana outcome authority readback response is not readable');
}

export function createManaOutcomeAuthorityReadbackHttpTransport({
    endpoint,
    hostname,
    serviceToken,
    accessClientId,
    accessClientSecret,
    fetchImpl = globalThis.fetch,
    serviceAuth = null,
    expectedServiceAuth = null
} = {}) {
    const bridgeEndpoint = resolveBridgeEndpoint(endpoint, hostname);
    const bridgeToken = nonEmptyString(serviceToken);
    const accessId = nonEmptyString(accessClientId);
    const accessSecret = nonEmptyString(accessClientSecret);
    const configuredServiceAuth = serviceAuthMetadata(serviceAuth);
    const expected = expectedServiceAuth == null ? null : serviceAuthMetadata(expectedServiceAuth);
    if (!bridgeEndpoint || !bridgeToken || !accessId || !accessSecret || typeof fetchImpl !== 'function'
        || (expectedServiceAuth != null && (!configuredServiceAuth || !expected
            || !sameServiceAuth(configuredServiceAuth, expected)))) return null;

    return {
        serviceAuth: configuredServiceAuth,
        async fetch(_input, init = {}) {
            const headers = new Headers(init.headers || {});
            headers.delete('authorization');
            headers.delete('cf-access-client-id');
            headers.delete('cf-access-client-secret');
            headers.set('authorization', `Bearer ${bridgeToken}`);
            headers.set('cf-access-client-id', accessId);
            headers.set('cf-access-client-secret', accessSecret);
            headers.set('accept', 'application/json');
            headers.set('content-type', 'application/json');
            return fetchImpl(bridgeEndpoint, { ...init, method: 'POST', headers, redirect: 'manual' });
        }
    };
}

/**
 * Creates the Brainbase-side verifier for Mana's named outcome-authority
 * service. `null` means the binding or its resource configuration is absent;
 * callers must leave the retrieve route unavailable in that case.
 */
export function createManaOutcomeAuthorityReadbackProvider({
    serviceBinding = null,
    transport = null,
    resource,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    resolveTenantForOrganization = null
} = {}) {
    const binding = resolveServiceBinding({ serviceBinding, transport });
    const resourceRef = nonEmptyString(resource);
    const timeout = Number(timeoutMs);
    if (!binding || !resourceRef || !Number.isSafeInteger(timeout) || timeout < 1) return null;

    async function performReadback(request, identity) {
        const readbackRequest = {
            // The legacy service-token route is organization-scoped and has
            // no independent tenant claim. Its explicit readback tenant is
            // kept separate from authority readback's tenant identity.
            tenant: identity.readbackTenantId,
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
            // This hostname is only an input to the named binding. No
            // process-global/public fetch is used and no caller header is
            // trusted for authentication; the binding is the trust edge.
            response = await binding.fetch(`${SERVICE_BINDING_ORIGIN}${MANA_OUTCOME_AUTHORITY_READBACK_PATH}`, {
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
        return assertReadbackShape(payload, identity, resourceRef);
    }

    return {
        async verifyAuthority(expected) {
            let authority = expected;
            if (!authority?.tenant_id && !authority?.tenantId) {
                if (typeof resolveTenantForOrganization !== 'function') {
                    throw new Error('trusted tenant resolver is required');
                }
                const organizationId = aliasedString(authority, ['organization_id', 'organizationId'], 'organization');
                const mapping = await resolveTenantForOrganization(organizationId);
                if (!mapping || mapping.organization_id !== organizationId || !nonEmptyString(mapping.tenant_id)) {
                    throw new Error('organization is not mapped to an active tenant');
                }
                authority = { ...authority, tenant_id: mapping.tenant_id };
            }
            const { request, identity } = resolveAuthorityIdentity(authority);
            return performReadback(request, identity);
        },
        async verifyBinding(expected, context = {}) {
            const request = expectedInput(expected);
            const identity = resolveTokenIdentity(expected, context);
            return performReadback(request, {
                ...identity,
                projectCode: request.projectCode,
                outcomeContractId: request.outcomeContractId,
                runId: request.runId
            });
        }
    };
}

export function createManaOutcomeAuthorityReadbackProviderFromEnv({
    env = process.env,
    serviceBinding = null,
    transport = null,
    resource = env?.[MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE_ENV],
    timeoutMs = DEFAULT_TIMEOUT_MS,
    resolveTenantForOrganization = null
} = {}) {
    return createManaOutcomeAuthorityReadbackProvider({
        serviceBinding,
        transport,
        resource,
        timeoutMs,
        resolveTenantForOrganization
    });
}

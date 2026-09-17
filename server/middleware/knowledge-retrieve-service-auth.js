import { createServiceAuthMiddleware } from '../services/multitenant/service-auth.js';

export const KNOWLEDGE_RETRIEVE_CAPABILITY = 'knowledge.retrieve';

const SERVICE_AUTH_INVALID_TYPE = 'https://brainbase.example/problems/service-auth-invalid';
const BINDING_INVALID_TYPE = 'https://brainbase.example/problems/knowledge-retrieve-binding-invalid';
const BINDING_UNAVAILABLE_TYPE = 'https://brainbase.example/problems/knowledge-retrieve-binding-unavailable';
const INPUT_INVALID_TYPE = 'https://brainbase.example/problems/knowledge-retrieve-input-invalid';

const UNTRUSTED_HEADER_NAMES = new Set([
    'x-internal-api-key',
    'x-brainbase-role',
    'x-role',
    'x-brainbase-projects',
    'x-projects',
    'x-brainbase-clearance',
    'x-clearance',
    'x-mana'
]);

const UNTRUSTED_BODY_FIELDS = new Set([
    'actor',
    'actor_id',
    'actorId',
    'person_id',
    'personId',
    'delegated_actor',
    'delegated_actor_id',
    'delegatedActor',
    'delegatedActorPersonId',
    'organization_id',
    'organizationId',
    'tenant_id',
    'tenantId',
    'project_codes',
    'projectCodes',
    'capability',
    'capabilities',
    'access',
    'auth',
    'identity'
]);

function nonEmptyString(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
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

function configuredList(value) {
    return list(value);
}

function readHeader(req, name) {
    if (typeof req?.get === 'function') {
        const value = req.get(name);
        if (value !== undefined && value !== null) return value;
    }
    const headers = req?.headers;
    if (!headers || typeof headers !== 'object') return undefined;
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : undefined;
}

function hasHeader(req, name) {
    const headers = req?.headers;
    if (headers && typeof headers === 'object'
        && Object.keys(headers).some((candidate) => candidate.toLowerCase() === name.toLowerCase())) {
        return true;
    }
    return readHeader(req, name) !== undefined;
}

function hasUntrustedCredentialHeader(req) {
    const headers = req?.headers;
    if (headers && typeof headers === 'object') {
        for (const key of Object.keys(headers)) {
            const normalized = key.toLowerCase();
            if (UNTRUSTED_HEADER_NAMES.has(normalized) || normalized.startsWith('x-mana-')) return true;
        }
    }
    return [...UNTRUSTED_HEADER_NAMES].some((name) => hasHeader(req, name));
}

function firstOwnField(object, names) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
    for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(object, name)) return object[name];
    }
    return undefined;
}

function bodyIdentityField(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    for (const key of Object.keys(body)) {
        if (UNTRUSTED_BODY_FIELDS.has(key)) return key;
    }
    return null;
}

function writeProblem(res, status, code, type, title, details = {}) {
    const payload = {
        type,
        status,
        code,
        title,
        retryable: status >= 500,
        fault_domain: status >= 500 ? 'brainbase_cloud' : 'protocol',
        correlation_id: null,
        details
    };
    const response = typeof res?.type === 'function' ? res.type('application/problem+json') : res;
    return response.status(status).json(payload);
}

function serviceAuthInvalid(res, reason = 'service bearer token is required') {
    return writeProblem(res, 401, 'SERVICE_AUTH_INVALID', SERVICE_AUTH_INVALID_TYPE, 'サービス認証を確認できません', {
        required_action: 'reauthorize',
        reason
    });
}

function bindingUnavailable(res, reason) {
    return writeProblem(res, 503, 'KNOWLEDGE_RETRIEVE_BINDING_UNAVAILABLE', BINDING_UNAVAILABLE_TYPE, '知識取得の認可束縛を利用できません', {
        required_action: 'configure_binding_authority',
        reason
    });
}

function bindingInvalid(res, reason) {
    return writeProblem(res, 403, 'KNOWLEDGE_RETRIEVE_BINDING_INVALID', BINDING_INVALID_TYPE, '知識取得の認可束縛が無効です', {
        required_action: 'reauthorize',
        reason
    });
}

function inputInvalid(res, reason) {
    return writeProblem(res, 400, 'KNOWLEDGE_RETRIEVE_INPUT_INVALID', INPUT_INVALID_TYPE, '知識取得リクエストが無効です', {
        required_action: 'fix_request',
        reason
    });
}

function resolveBindingProvider({ bindingVerifier, bindingRepository } = {}) {
    if (typeof bindingVerifier === 'function') {
        return { owner: null, method: bindingVerifier };
    }
    if (bindingVerifier && typeof bindingVerifier === 'object') {
        for (const name of ['verify', 'verifyBinding', 'resolve', 'resolveBinding']) {
            if (typeof bindingVerifier[name] === 'function') {
                return { owner: bindingVerifier, method: bindingVerifier[name] };
            }
        }
    }
    if (bindingRepository && typeof bindingRepository === 'object') {
        for (const name of [
            'getKnowledgeRetrieveBinding',
            'getOutcomeContractBinding',
            'findByOutcomeAndRun',
            'getBinding',
            'find'
        ]) {
            if (typeof bindingRepository[name] === 'function') {
                return { owner: bindingRepository, method: bindingRepository[name] };
            }
        }
    }
    return null;
}

function unwrapBinding(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.binding && typeof value.binding === 'object' && !Array.isArray(value.binding)) return value.binding;
    if (value.context && typeof value.context === 'object' && !Array.isArray(value.context)) return value.context;
    if (value.authorization && typeof value.authorization === 'object' && !Array.isArray(value.authorization)) {
        return value.authorization;
    }
    if (value.ok === false || value.authorized === false || value.allowed === false) return null;
    return value;
}

function normalizeBinding(value) {
    const binding = unwrapBinding(value);
    if (!binding) return null;
    const organization = firstOwnField(binding, ['organization', 'tenant', 'organization_context']);
    const actor = firstOwnField(binding, ['delegated_actor', 'delegatedActor', 'actor', 'person']);
    const organizationId = nonEmptyString(firstOwnField(binding, [
        'organization_id', 'organizationId', 'tenant_id', 'tenantId'
    ]) || firstOwnField(organization, ['id', 'organization_id', 'organizationId']));
    const delegatedActorPersonId = nonEmptyString(firstOwnField(binding, [
        'delegated_actor_person_id',
        'delegatedActorPersonId',
        'actor_person_id',
        'actorPersonId',
        'person_id',
        'personId'
    ]) || firstOwnField(actor, ['person_id', 'personId', 'id']));
    const projectCodes = list(firstOwnField(binding, [
        'authorized_project_codes',
        'authorizedProjectCodes',
        'project_codes',
        'projectCodes',
        'projects'
    ]));
    const capabilities = list(firstOwnField(binding, ['capabilities', 'capability']));
    const capability = nonEmptyString(firstOwnField(binding, ['capability', 'capability_id', 'capabilityId']))
        || (capabilities.includes(KNOWLEDGE_RETRIEVE_CAPABILITY) ? KNOWLEDGE_RETRIEVE_CAPABILITY : null);
    const outcomeContractId = nonEmptyString(firstOwnField(binding, [
        'outcome_contract_id', 'outcomeContractId'
    ]));
    const runId = nonEmptyString(firstOwnField(binding, ['run_id', 'runId']));
    const serviceSubject = nonEmptyString(firstOwnField(binding, [
        'service_subject', 'serviceSubject', 'service_id', 'serviceId'
    ]));
    return {
        organizationId,
        delegatedActorPersonId,
        projectCodes,
        capability,
        capabilities,
        outcomeContractId,
        runId,
        serviceSubject
    };
}

function requestBindingInput(req, serviceIdentity) {
    const body = req?.body;
    const projectCode = nonEmptyString(firstOwnField(body, ['project_code', 'projectCode']));
    const outcomeContractId = nonEmptyString(firstOwnField(body, ['outcome_contract_id', 'outcomeContractId']));
    const runId = nonEmptyString(firstOwnField(body, ['run_id', 'runId']));
    return {
        outcome_contract_id: outcomeContractId,
        run_id: runId,
        outcomeContractId,
        runId,
        project_code: projectCode,
        projectCode,
        capability: KNOWLEDGE_RETRIEVE_CAPABILITY,
        capabilities: [KNOWLEDGE_RETRIEVE_CAPABILITY],
        service_subject: serviceIdentity?.subject || null,
        serviceSubject: serviceIdentity?.subject || null,
        request: body
    };
}

function validRequestBindingInput(req) {
    const body = req?.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return 'JSON object body is required';
    const untrustedField = bodyIdentityField(body);
    if (untrustedField) return `body field '${untrustedField}' is not an identity source`;
    const projectCode = nonEmptyString(firstOwnField(body, ['project_code', 'projectCode']));
    if (!projectCode) return 'project_code is required';
    if (!Array.isArray(body.refs)) return 'refs must be an array';
    if (!nonEmptyString(firstOwnField(body, ['outcome_contract_id', 'outcomeContractId']))) {
        return 'outcome_contract_id is required';
    }
    if (!nonEmptyString(firstOwnField(body, ['run_id', 'runId']))) return 'run_id is required';
    return null;
}

function configuredServiceAuth({ authService, issuer, audience, deploymentId } = {}) {
    const configuredIssuer = nonEmptyString(issuer ?? authService?.serviceTokenIssuer);
    const configuredAudience = configuredList(audience ?? authService?.serviceTokenAudience);
    const configuredDeploymentId = nonEmptyString(deploymentId ?? authService?.serviceTokenDeploymentId);
    return {
        issuer: configuredIssuer,
        audience: configuredAudience,
        deploymentId: configuredDeploymentId
    };
}

function accessFromBinding(binding) {
    return {
        role: 'member',
        projectCodes: [...binding.projectCodes],
        clearance: [],
        level: 1,
        employmentType: 'internal_service',
        personId: binding.delegatedActorPersonId,
        delegatedActorPersonId: binding.delegatedActorPersonId,
        slackUserId: null,
        slackWorkspaceId: null,
        tenantId: binding.organizationId,
        organizationId: binding.organizationId,
        capability: KNOWLEDGE_RETRIEVE_CAPABILITY
    };
}

/**
 * Protects the Mana Knowledge retrieve boundary.
 *
 * The token is verified by AuthService, while tenant, delegated actor and
 * project scope are read from a persisted outcome binding supplied by the
 * caller. Token self-claims and request headers/body identity fields are never
 * used to construct req.access.
 */
export function createKnowledgeRetrieveServiceAuthMiddleware({
    authService = null,
    bindingVerifier = null,
    bindingRepository = null,
    issuer = undefined,
    audience = undefined,
    deploymentId = undefined,
    now = () => new Date()
} = {}) {
    const serviceAuthConfig = configuredServiceAuth({ authService, issuer, audience, deploymentId });
    const verifyToken = typeof authService?.verifyServiceToken === 'function'
        ? async (token) => {
            if (typeof token !== 'string' || !token.startsWith('bbsvc_')) {
                throw new Error('Invalid service token');
            }
            return authService.verifyServiceToken(token);
        }
        : null;
    const provider = resolveBindingProvider({ bindingVerifier, bindingRepository });
    const serviceAuth = verifyToken && serviceAuthConfig.issuer && serviceAuthConfig.audience.length > 0
        && serviceAuthConfig.deploymentId
        ? createServiceAuthMiddleware({
            verifyToken,
            issuer: serviceAuthConfig.issuer,
            audience: serviceAuthConfig.audience[0],
            deploymentId: serviceAuthConfig.deploymentId,
            requiredCapabilities: [KNOWLEDGE_RETRIEVE_CAPABILITY],
            now
        })
        : null;

    return async (req, res, next) => {
        if (hasUntrustedCredentialHeader(req)) {
            return serviceAuthInvalid(res, 'untrusted credential headers are not accepted');
        }
        if (!serviceAuth) {
            return bindingUnavailable(res, 'AuthService verifier and issuer/audience/deployment configuration are required');
        }
        if (!provider) {
            return bindingUnavailable(res, 'a persisted outcome binding verifier or repository is required');
        }

        return serviceAuth(req, res, async () => {
            const configuredAudiences = serviceAuthConfig.audience;
            const verifiedAudiences = Array.isArray(req.serviceIdentity?.audience)
                ? req.serviceIdentity.audience
                : [];
            if (!configuredAudiences.every((candidate) => verifiedAudiences.includes(candidate))) {
                return serviceAuthInvalid(res, 'service token audience is not configured for this deployment');
            }

            const inputError = validRequestBindingInput(req);
            if (inputError) return inputInvalid(res, inputError);

            const expected = requestBindingInput(req, req.serviceIdentity);
            let persisted;
            try {
                persisted = await provider.method.call(provider.owner, expected, {
                    request: req,
                    serviceIdentity: req.serviceIdentity
                });
            } catch {
                return bindingUnavailable(res, 'persisted outcome binding read failed');
            }

            const binding = normalizeBinding(persisted);
            if (!binding
                || !binding.organizationId
                || !binding.delegatedActorPersonId
                || binding.projectCodes.length === 0
                || binding.capability !== KNOWLEDGE_RETRIEVE_CAPABILITY
                || binding.outcomeContractId !== expected.outcome_contract_id
                || binding.runId !== expected.run_id
                || (binding.serviceSubject && binding.serviceSubject !== req.serviceIdentity.subject)) {
                return bindingInvalid(res, 'persisted organization, actor, project, capability, outcome or run binding does not match');
            }

            if (!binding.projectCodes.includes(expected.project_code)) {
                return bindingInvalid(res, `project '${expected.project_code}' is not authorized by the persisted binding`);
            }

            const access = accessFromBinding(binding);
            req.access = access;
            req.authSource = 'service-token';
            req.knowledgeRetrieveBinding = Object.freeze({
                organizationId: binding.organizationId,
                delegatedActorPersonId: binding.delegatedActorPersonId,
                projectCodes: [...binding.projectCodes],
                capability: KNOWLEDGE_RETRIEVE_CAPABILITY,
                outcome_contract_id: binding.outcomeContractId,
                run_id: binding.runId,
                service_subject: req.serviceIdentity.subject
            });
            return next();
        });
    };
}

export const KNOWLEDGE_RETRIEVE_UNTRUSTED_HEADERS = Object.freeze([...UNTRUSTED_HEADER_NAMES]);
export const KNOWLEDGE_RETRIEVE_UNTRUSTED_BODY_FIELDS = Object.freeze([...UNTRUSTED_BODY_FIELDS]);

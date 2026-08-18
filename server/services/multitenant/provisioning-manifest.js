import { createHash } from 'node:crypto';

import { canonicalJson, deepFreeze } from './canonical-json.js';

const SECRET_KEY = /(?:access|refresh)[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?value|oauth[_-]?token|bearer[_-]?token/iu;
const SECRET_VALUE = /(?:^xox[baprs]-|^sk-[A-Za-z0-9]|-----BEGIN [A-Z ]+-----)/u;
const TENANT_KEY = /^[a-z][a-z0-9-]{1,62}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const TENANT_ID = /^ten_[0-9A-HJKMNP-TV-Z]{26}$/u;
const CONNECTION_ID = /^wsc_[0-9A-HJKMNP-TV-Z]{26}$/u;
const CREDENTIAL_REF = /^credref:\/\/[a-z][a-z0-9-]{1,62}\/[a-z][a-z0-9_-]{1,62}\/[a-z][a-z0-9_-]{1,62}$/u;
const CAPABILITY = /^[a-z][a-z0-9_:-]{1,63}$/u;

const ALLOWED_ROOT_KEYS = new Set([
    'tenant_key', 'tenant_id', 'display_name', 'project_code',
    'workspace_connection', 'service_actor', 'contract_revision'
]);
const ALLOWED_CONNECTION_KEYS = new Set([
    'provider', 'workspace_id', 'app_id', 'installation_id', 'connection_id',
    'credential_ref', 'credential_mode', 'scopes'
]);
const ALLOWED_ACTOR_KEYS = new Set(['actor_id', 'canonical_project_id', 'capabilities', 'public_keys']);
const CREDENTIAL_MODES = new Set(['cloud_standard', 'customer_oauth', 'customer_api']);
const ALLOWED_CAPABILITIES = new Set([
    'send_message', 'create_task', 'list_tasks', 'update_task', 'transition_task',
    'list_sessions', 'get_session', 'list_employees', 'get_employee', 'read_graph',
    'read_drive', 'write_drive', 'read_nocodb', 'write_nocodb'
]);

export class ProvisioningManifestError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'ProvisioningManifestError';
        this.code = code;
    }
}

function fail(code, message) {
    throw new ProvisioningManifestError(code, message);
}

function assertRecord(value, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('MANIFEST_INVALID', `${field} must be an object`);
    }
}

function assertKnownKeys(value, allowed, field) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail('MANIFEST_FIELD_FORBIDDEN', `${field}.${key} is not an allowed provisioning field`);
    }
}

function scanForSecretMaterial(value, path = []) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => scanForSecretMaterial(item, [...path, String(index)]));
        return;
    }
    if (!value || typeof value !== 'object') {
        if (typeof value === 'string' && SECRET_VALUE.test(value)) {
            fail('MANIFEST_SECRET_FORBIDDEN', 'Provisioning manifest contains secret material');
        }
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (SECRET_KEY.test(key)) fail('MANIFEST_SECRET_FORBIDDEN', 'Provisioning manifest contains a secret field');
        scanForSecretMaterial(child, [...path, key]);
    }
}

function requiredString(value, field, pattern = IDENTIFIER) {
    if (typeof value !== 'string' || !pattern.test(value)) fail('MANIFEST_INVALID', `${field} is invalid`);
    return value;
}

function sortedStrings(values, field, pattern = IDENTIFIER) {
    if (!Array.isArray(values) || values.length === 0) fail('MANIFEST_INVALID', `${field} must be a non-empty array`);
    const normalized = values.map((value) => requiredString(value, field, pattern));
    if (new Set(normalized).size !== normalized.length) fail('MANIFEST_INVALID', `${field} must not contain duplicates`);
    return normalized.sort((a, b) => a.localeCompare(b));
}

function normalizeConnection(value) {
    assertRecord(value, 'workspace_connection');
    assertKnownKeys(value, ALLOWED_CONNECTION_KEYS, 'workspace_connection');
    const credentialRef = requiredString(value.credential_ref, 'workspace_connection.credential_ref', CREDENTIAL_REF);
    if (!CREDENTIAL_REF.test(credentialRef)) fail('MANIFEST_INVALID', 'workspace_connection.credential_ref must be opaque');
    const credentialMode = requiredString(value.credential_mode, 'workspace_connection.credential_mode');
    if (!CREDENTIAL_MODES.has(credentialMode)) fail('MANIFEST_INVALID', 'workspace_connection.credential_mode is invalid');
    return {
        provider: requiredString(value.provider, 'workspace_connection.provider', /^[a-z][a-z0-9_-]{1,31}$/u),
        workspace_id: requiredString(value.workspace_id, 'workspace_connection.workspace_id'),
        app_id: requiredString(value.app_id, 'workspace_connection.app_id'),
        installation_id: requiredString(value.installation_id, 'workspace_connection.installation_id'),
        connection_id: requiredString(value.connection_id, 'workspace_connection.connection_id', CONNECTION_ID),
        credential_ref: credentialRef,
        credential_mode: credentialMode,
        scopes: sortedStrings(value.scopes, 'workspace_connection.scopes', /^[a-z][a-z0-9:._-]{1,127}$/u)
    };
}

function normalizeActor(value) {
    assertRecord(value, 'service_actor');
    assertKnownKeys(value, ALLOWED_ACTOR_KEYS, 'service_actor');
    const capabilities = sortedStrings(value.capabilities, 'service_actor.capabilities', CAPABILITY);
    if (capabilities.some((capability) => !ALLOWED_CAPABILITIES.has(capability))) {
        fail('CAPABILITY_FORBIDDEN', 'service_actor.capabilities contains an unsupported capability');
    }
    const actor = {
        actor_id: requiredString(value.actor_id, 'service_actor.actor_id', /^[a-z][a-z0-9_-]{2,127}$/u),
        canonical_project_id: requiredString(value.canonical_project_id, 'service_actor.canonical_project_id'),
        capabilities
    };
    if (value.public_keys !== undefined) {
        if (!Array.isArray(value.public_keys)) fail('MANIFEST_INVALID', 'service_actor.public_keys must be an array');
        actor.public_keys = value.public_keys.map((key, index) => {
            assertRecord(key, `service_actor.public_keys[${index}]`);
            if (Object.keys(key).some((field) => SECRET_KEY.test(field))) {
                fail('MANIFEST_SECRET_FORBIDDEN', 'Provisioning manifest contains a private key field');
            }
            return {
                kid: requiredString(key.kid, `service_actor.public_keys[${index}].kid`),
                kty: requiredString(key.kty, `service_actor.public_keys[${index}].kty`),
                alg: requiredString(key.alg, `service_actor.public_keys[${index}].alg`),
                use: requiredString(key.use, `service_actor.public_keys[${index}].use`),
                n: requiredString(key.n, `service_actor.public_keys[${index}].n`),
                e: requiredString(key.e, `service_actor.public_keys[${index}].e`)
            };
        });
    }
    return actor;
}

export function normalizeProvisioningManifest(input) {
    assertRecord(input, 'manifest');
    scanForSecretMaterial(input);
    assertKnownKeys(input, ALLOWED_ROOT_KEYS, 'manifest');
    if (typeof input.tenant_key !== 'string' || !TENANT_KEY.test(input.tenant_key)) {
        fail('MANIFEST_INVALID', 'tenant_key must be a lowercase canonical tenant key');
    }
    const normalized = {
        tenant_key: input.tenant_key,
        tenant_id: requiredString(input.tenant_id, 'tenant_id', TENANT_ID),
        display_name: requiredString(input.display_name, 'display_name', /^\S.{0,254}$/u),
        project_code: requiredString(input.project_code, 'project_code', /^[a-z][a-z0-9_-]{1,63}$/u),
        workspace_connection: normalizeConnection(input.workspace_connection),
        service_actor: normalizeActor(input.service_actor)
    };
    if (input.contract_revision !== undefined) {
        normalized.contract_revision = requiredString(input.contract_revision, 'contract_revision', /^[0-9]+$/u);
    }
    return deepFreeze(normalized);
}

export function canonicalProvisioningFingerprint(manifest) {
    const normalized = normalizeProvisioningManifest(manifest);
    return createHash('sha256').update(canonicalJson(normalized)).digest('hex');
}

export function redactedManifestSummary(manifest) {
    const normalized = normalizeProvisioningManifest(manifest);
    return deepFreeze({
        tenant_key: normalized.tenant_key,
        tenant_id: normalized.tenant_id,
        project_code: normalized.project_code,
        provider: normalized.workspace_connection.provider,
        workspace_id: normalized.workspace_connection.workspace_id,
        app_id: normalized.workspace_connection.app_id,
        connection_id: normalized.workspace_connection.connection_id,
        credential_ref: normalized.workspace_connection.credential_ref,
        actor_id: normalized.service_actor.actor_id,
        capability_count: normalized.service_actor.capabilities.length
    });
}

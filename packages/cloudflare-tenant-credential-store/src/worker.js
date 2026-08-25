const textEncoder = new TextEncoder();

export const MAX_CREDENTIAL_BYTES = 64 * 1024;
export const MAX_REQUEST_BODY_BYTES = 128 * 1024;
const CREDENTIAL_REF_PATTERN = /^credref:\/\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:_-]{0,127}$/u;
const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/u;
const REVISION_PATTERN = /^[1-9][0-9]{0,8}$/u;
const CREDENTIAL_MODES = new Set(['cloud_standard', 'customer_oauth', 'customer_api']);
const OPERATIONS = new Set(['store', 'verify', 'revoke', 'materialize']);

class CredentialStoreError extends Error {
    constructor(code, status = 403) {
        super(code);
        this.name = 'CredentialStoreError';
        this.code = code;
        this.status = status;
    }
}

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value) {
    return textEncoder.encode(value).byteLength;
}

function problem(status, code) {
    return Response.json({
        type: `https://brainbase.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
        status,
        code,
        title: '資格情報を処理できません',
        retryable: status >= 500,
        fault_domain: 'brainbase_cloud',
        correlation_id: null
    }, {
        status,
        headers: {
            'cache-control': 'no-store',
            'content-type': 'application/problem+json; charset=utf-8'
        }
    });
}

function requiredSecret(env, name) {
    const value = env?.[name];
    if (typeof value !== 'string' || value.length === 0) {
        throw new CredentialStoreError('STORE_CONFIGURATION_INVALID', 503);
    }
    return value;
}

function base64UrlEncode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlDecode(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/u.test(value)) {
        throw new CredentialStoreError('STORE_CONFIGURATION_INVALID', 503);
    }
    const padded = value.replaceAll('-', '+').replaceAll('_', '/')
        + '='.repeat((4 - (value.length % 4)) % 4);
    let binary;
    try {
        binary = atob(padded);
    } catch {
        throw new CredentialStoreError('STORE_CONFIGURATION_INVALID', 503);
    }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function digestBytes(value) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)));
}

async function digestHex(value) {
    return [...await digestBytes(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function constantTimeEquals(left, right) {
    const [leftDigest, rightDigest] = await Promise.all([digestBytes(left), digestBytes(right)]);
    let difference = leftDigest.length === rightDigest.length ? 0 : 1;
    for (let index = 0; index < Math.max(leftDigest.length, rightDigest.length); index += 1) {
        difference |= (leftDigest[index] ?? 0) ^ (rightDigest[index] ?? 0);
    }
    return difference === 0;
}

function normalizeIdentifier(value, field) {
    if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
        throw new CredentialStoreError('CREDENTIAL_BINDING_INVALID', 400);
    }
    return value;
}

function normalizeProvider(value) {
    if (typeof value !== 'string' || !PROVIDER_PATTERN.test(value)) {
        throw new CredentialStoreError('CREDENTIAL_BINDING_INVALID', 400);
    }
    return value;
}

function normalizeRevision(value) {
    const normalized = Number.isInteger(value) ? String(value) : value;
    if (typeof normalized !== 'string' || !REVISION_PATTERN.test(normalized)) {
        throw new CredentialStoreError('CREDENTIAL_BINDING_INVALID', 400);
    }
    return normalized;
}

function normalizeBinding(input) {
    if (!isObject(input)) throw new CredentialStoreError('CREDENTIAL_BINDING_INVALID', 400);
    return Object.freeze({
        tenant_id: normalizeIdentifier(input.tenant_id, 'tenant_id'),
        connection_id: normalizeIdentifier(input.connection_id, 'connection_id'),
        connection_revision: normalizeRevision(input.connection_revision),
        provider: normalizeProvider(input.provider)
    });
}

function canonicalBinding(binding) {
    return [binding.tenant_id, binding.connection_id, binding.connection_revision, binding.provider]
        .map((value) => `${value.length}:${value}`).join('|');
}

function assertCredentialRef(value) {
    if (typeof value !== 'string' || !CREDENTIAL_REF_PATTERN.test(value)) {
        throw new CredentialStoreError('CREDENTIAL_REF_INVALID', 400);
    }
    return value;
}

function assertCredentialMaterial(value, { required = true } = {}) {
    if (value === null && !required) return null;
    if (typeof value !== 'string' || (required && value.length === 0)) {
        throw new CredentialStoreError('CREDENTIAL_MATERIAL_INVALID', 400);
    }
    if (byteLength(value) > MAX_CREDENTIAL_BYTES) {
        throw new CredentialStoreError('CREDENTIAL_MATERIAL_TOO_LARGE', 413);
    }
    return value;
}

function assertCredentialMode(value) {
    const mode = value ?? 'customer_oauth';
    if (typeof mode !== 'string' || !CREDENTIAL_MODES.has(mode)) {
        throw new CredentialStoreError('CREDENTIAL_MODE_INVALID', 400);
    }
    return mode;
}

function assertNoUnknownFields(input, fields) {
    if (Object.keys(input).some((field) => !fields.has(field))) {
        throw new CredentialStoreError('REQUEST_SCHEMA_INVALID', 400);
    }
}

function normalizeStoreInput(input) {
    if (!isObject(input)) throw new CredentialStoreError('REQUEST_SCHEMA_INVALID', 400);
    assertNoUnknownFields(input, new Set([
        'operation', 'tenant_id', 'tenant_key', 'connection_id', 'connection_revision', 'provider',
        'workspace_id', 'app_id',
        'idempotency_key', 'credential_material', 'credential_refresh_material', 'credential_mode',
        // These two fields are generated by the authenticated Worker before
        // the request crosses the internal Durable Object boundary.
        'credential_ref', 'material_digest'
    ]));
    const binding = normalizeBinding(input);
    const credentialMaterial = assertCredentialMaterial(input.credential_material);
    const refreshMaterial = input.credential_refresh_material === undefined
        ? null
        : assertCredentialMaterial(input.credential_refresh_material, { required: false });
    if (input.idempotency_key !== undefined && input.idempotency_key !== null
        && (typeof input.idempotency_key !== 'string'
            || input.idempotency_key.length === 0
            || input.idempotency_key.length > 200
            || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(input.idempotency_key))) {
        throw new CredentialStoreError('REQUEST_SCHEMA_INVALID', 400);
    }
    return {
        ...binding,
        ...(input.tenant_key === undefined ? {} : { tenant_key: normalizeIdentifier(input.tenant_key, 'tenant_key') }),
        ...(input.workspace_id === undefined ? {} : { workspace_id: normalizeIdentifier(input.workspace_id, 'workspace_id') }),
        ...(input.app_id === undefined ? {} : { app_id: normalizeIdentifier(input.app_id, 'app_id') }),
        idempotency_key: input.idempotency_key ?? null,
        credential_material: credentialMaterial,
        credential_refresh_material: refreshMaterial,
        credential_mode: assertCredentialMode(input.credential_mode),
        ...(input.credential_ref === undefined ? {} : { credential_ref: assertCredentialRef(input.credential_ref) }),
        ...(input.material_digest === undefined
            ? {}
            : { material_digest: typeof input.material_digest === 'string' ? input.material_digest : null })
    };
}


function normalizeReferenceInput(input, { reason = false } = {}) {
    if (!isObject(input)) throw new CredentialStoreError('REQUEST_SCHEMA_INVALID', 400);
    const fields = new Set([
        'operation', 'tenant_id', 'tenant_key', 'connection_id', 'connection_revision', 'provider',
        'workspace_id', 'app_id', 'credential_ref',
        ...(reason ? ['reason'] : [])
    ]);
    assertNoUnknownFields(input, fields);
    const binding = normalizeBinding(input);
    const credentialRef = assertCredentialRef(input.credential_ref);
    if (reason && input.reason !== undefined
        && (typeof input.reason !== 'string' || input.reason.length > 128 || /[\r\n]/u.test(input.reason))) {
        throw new CredentialStoreError('REQUEST_SCHEMA_INVALID', 400);
    }
    return {
        ...binding,
        ...(input.tenant_key === undefined ? {} : { tenant_key: normalizeIdentifier(input.tenant_key, 'tenant_key') }),
        ...(input.workspace_id === undefined ? {} : { workspace_id: normalizeIdentifier(input.workspace_id, 'workspace_id') }),
        ...(input.app_id === undefined ? {} : { app_id: normalizeIdentifier(input.app_id, 'app_id') }),
        credential_ref: credentialRef,
        ...(reason ? { reason: input.reason ?? null } : {})
    };
}

function bindingMatches(record, binding) {
    return record?.tenant_id === binding.tenant_id
        && record?.connection_id === binding.connection_id
        && record?.connection_revision === binding.connection_revision
        && record?.provider === binding.provider
        && (binding.tenant_key === undefined || record?.tenant_key === binding.tenant_key)
        && (binding.workspace_id === undefined || record?.workspace_id === binding.workspace_id)
        && (binding.app_id === undefined || record?.app_id === binding.app_id);
}

async function encryptionKey(env) {
    const encoded = requiredSecret(env, 'BRAINBASE_TENANT_CREDENTIAL_STORE_ENCRYPTION_KEY');
    const raw = base64UrlDecode(encoded);
    if (raw.byteLength !== 32) {
        throw new CredentialStoreError('STORE_CONFIGURATION_INVALID', 503);
    }
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptMaterial(env, binding, credentialRef, material) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await encryptionKey(env);
    const additionalData = textEncoder.encode(`${canonicalBinding(binding)}|${credentialRef}`);
    const plaintext = textEncoder.encode(JSON.stringify({
        credential_material: material.credential_material,
        credential_refresh_material: material.credential_refresh_material
    }));
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData }, key, plaintext
    );
    return {
        iv: base64UrlEncode(iv),
        ciphertext: base64UrlEncode(new Uint8Array(ciphertext))
    };
}

async function decryptMaterial(env, binding, credentialRef, encrypted) {
    const key = await encryptionKey(env);
    const additionalData = textEncoder.encode(`${canonicalBinding(binding)}|${credentialRef}`);
    let plaintext;
    try {
        plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: base64UrlDecode(encrypted.iv), additionalData },
            key,
            base64UrlDecode(encrypted.ciphertext)
        );
    } catch {
        throw new CredentialStoreError('CREDENTIAL_DECRYPTION_FAILED', 503);
    }
    try {
        const result = JSON.parse(new TextDecoder().decode(plaintext));
        if (!isObject(result) || typeof result.credential_material !== 'string') {
            throw new Error('invalid_material');
        }
        return result;
    } catch {
        throw new CredentialStoreError('CREDENTIAL_DECRYPTION_FAILED', 503);
    }
}

function metadata(record) {
    return {
        valid: true,
        tenant_id: record.tenant_id,
        tenant_key: record.tenant_key ?? null,
        connection_id: record.connection_id,
        connection_revision: record.connection_revision,
        provider: record.provider,
        workspace_id: record.workspace_id ?? null,
        app_id: record.app_id ?? null,
        credential_ref: record.credential_ref,
        credential_mode: record.credential_mode,
        status: record.status
    };
}

function response(result) {
    return Response.json({ result }, {
        status: 200,
        headers: { 'cache-control': 'no-store' }
    });
}

function internalError(error) {
    if (error instanceof CredentialStoreError) return error;
    return new CredentialStoreError('CREDENTIAL_STORE_UNAVAILABLE', 503);
}

export class TenantCredentialStoreDurableObject {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request) {
        try {
            const input = await request.json();
            if (!isObject(input) || !OPERATIONS.has(input.operation)) {
                throw new CredentialStoreError('REQUEST_SCHEMA_INVALID', 400);
            }
            if (input.operation === 'store') return response(await this.store(input));
            const normalized = normalizeReferenceInput(input, { reason: input.operation === 'revoke' });
            if (input.operation === 'verify') return response(await this.verify(normalized));
            if (input.operation === 'revoke') return response(await this.revoke(normalized));
            return response(await this.materialize(normalized));
        } catch (error) {
            const normalized = internalError(error);
            return problem(normalized.status, normalized.code);
        }
    }

    async store(input) {
        const normalized = normalizeStoreInput(input);
        const computedMaterialDigest = await digestHex(JSON.stringify({
            credential_material: normalized.credential_material,
            credential_refresh_material: normalized.credential_refresh_material
        }));
        const materialDigest = normalized.material_digest ?? computedMaterialDigest;
        const identity = normalized.idempotency_key
            ? `${canonicalBinding(normalized)}|${normalized.idempotency_key}`
            : `${canonicalBinding(normalized)}|${crypto.randomUUID()}`;
        const credentialRef = normalized.credential_ref ?? `credref://bbcs/${await digestHex(identity)}`;
        const existing = await this.state.storage.get('record');
        if (existing) {
            if (!bindingMatches(existing, normalized)) {
                throw new CredentialStoreError('CREDENTIAL_BINDING_MISMATCH', 403);
            }
            if (existing.idempotency_key !== normalized.idempotency_key
                || existing.material_digest !== materialDigest) {
                throw new CredentialStoreError('CREDENTIAL_IDEMPOTENCY_CONFLICT', 409);
            }
            if (existing.status === 'revoked') {
                throw new CredentialStoreError('CREDENTIAL_REVOKED', 403);
            }
            return {
                credential_ref: existing.credential_ref,
                credential_mode: existing.credential_mode,
                refresh_revision: existing.refresh_revision
            };
        }
        const encrypted = await encryptMaterial(this.env, normalized, credentialRef, normalized);
        const record = {
            tenant_id: normalized.tenant_id,
            ...(normalized.tenant_key === undefined ? {} : { tenant_key: normalized.tenant_key }),
            connection_id: normalized.connection_id,
            connection_revision: normalized.connection_revision,
            provider: normalized.provider,
            ...(normalized.workspace_id === undefined ? {} : { workspace_id: normalized.workspace_id }),
            ...(normalized.app_id === undefined ? {} : { app_id: normalized.app_id }),
            credential_ref: credentialRef,
            credential_mode: normalized.credential_mode,
            idempotency_key: normalized.idempotency_key,
            material_digest: materialDigest,
            refresh_revision: normalized.credential_refresh_material === null ? 0 : 1,
            status: 'active',
            encrypted
        };
        await this.state.storage.put('record', record);
        return {
            credential_ref: credentialRef,
            credential_mode: record.credential_mode,
            refresh_revision: record.refresh_revision
        };
    }

    async readBoundRecord(normalized) {
        const record = await this.state.storage.get('record');
        if (!record || record.credential_ref !== normalized.credential_ref) {
            throw new CredentialStoreError('CREDENTIAL_REF_UNKNOWN', 403);
        }
        if (!bindingMatches(record, normalized)) {
            throw new CredentialStoreError('CREDENTIAL_BINDING_MISMATCH', 403);
        }
        return record;
    }

    async verify(normalized) {
        const record = await this.readBoundRecord(normalized);
        if (record.status === 'revoked') {
            throw new CredentialStoreError('CREDENTIAL_REVOKED', 403);
        }
        return metadata(record);
    }

    async revoke(normalized) {
        const record = await this.readBoundRecord(normalized);
        if (record.status !== 'revoked') {
            await this.state.storage.put('record', {
                ...record,
                status: 'revoked',
                encrypted: null
            });
        }
        return {
            credential_ref: record.credential_ref,
            status: 'revoked'
        };
    }

    async materialize(normalized) {
        const record = await this.readBoundRecord(normalized);
        if (record.status === 'revoked' || !record.encrypted) {
            throw new CredentialStoreError('CREDENTIAL_REVOKED', 403);
        }
        return decryptMaterial(this.env, normalized, record.credential_ref, record.encrypted);
    }
}

async function readBoundedBody(request) {
    const declaredLength = request.headers.get('content-length');
    if (declaredLength !== null) {
        const size = Number(declaredLength);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_REQUEST_BODY_BYTES) {
            throw new CredentialStoreError('REQUEST_BODY_TOO_LARGE', 413);
        }
    }
    if (!request.body) return '';
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_REQUEST_BODY_BYTES) {
                await reader.cancel('request_body_too_large');
                throw new CredentialStoreError('REQUEST_BODY_TOO_LARGE', 413);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
}

async function authenticate(request, env) {
    const expected = requiredSecret(env, 'BRAINBASE_TENANT_CREDENTIAL_STORE_SERVICE_TOKEN');
    const header = request.headers.get('authorization') ?? '';
    if (!header.startsWith('Bearer ') || !(await constantTimeEquals(header.slice(7), expected))) {
        throw new CredentialStoreError('SERVICE_AUTH_REQUIRED', 401);
    }
}

function namespace(env) {
    const value = env?.TENANT_CREDENTIAL_STORE;
    if (!value || typeof value.idFromName !== 'function' || typeof value.get !== 'function') {
        throw new CredentialStoreError('STORE_CONFIGURATION_INVALID', 503);
    }
    return value;
}

async function callDurableObject(env, credentialRef, input) {
    const durableObjects = namespace(env);
    const id = durableObjects.idFromName(`credential-ref:${credentialRef}`);
    const stub = durableObjects.get(id);
    const result = await stub.fetch(new Request('https://internal/credential-operation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
    }));
    const payload = await result.json();
    if (!result.ok) {
        throw new CredentialStoreError(payload.code ?? 'CREDENTIAL_STORE_UNAVAILABLE', result.status);
    }
    return payload.result;
}

async function dispatch(request, env, operation, input) {
    if (!OPERATIONS.has(operation)) throw new CredentialStoreError('STORE_ROUTE_NOT_ALLOWED', 404);
    if (operation === 'store') {
        const normalized = normalizeStoreInput({ ...input, operation });
        const materialDigest = await digestHex(JSON.stringify({
            credential_material: normalized.credential_material,
            credential_refresh_material: normalized.credential_refresh_material
        }));
        const identity = normalized.idempotency_key
            ? `${canonicalBinding(normalized)}|${normalized.idempotency_key}`
            : `${canonicalBinding(normalized)}|${crypto.randomUUID()}`;
        const credentialRef = `credref://bbcs/${await digestHex(identity)}`;
        return callDurableObject(env, credentialRef, {
            operation,
            ...normalized,
            credential_ref: credentialRef,
            material_digest: materialDigest
        });
    }
    const normalized = normalizeReferenceInput({ ...input, operation }, { reason: operation === 'revoke' });
    return callDurableObject(env, normalized.credential_ref, { operation, ...normalized });
}

export async function handleTenantCredentialStoreRequest(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health' && !url.search && !url.hash) {
        return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    }
    if (request.method !== 'POST' || url.search || url.hash) return problem(404, 'STORE_ROUTE_NOT_ALLOWED');
    const prefix = '/api/v1/credentials';
    if (!(url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
        return problem(404, 'STORE_ROUTE_NOT_ALLOWED');
    }
    const operationPath = url.pathname.slice(prefix.length).replace(/^\//u, '');
    try {
        await authenticate(request, env);
        const body = await readBoundedBody(request);
        let input;
        try {
            input = JSON.parse(body || '{}');
        } catch {
            throw new CredentialStoreError('REQUEST_SCHEMA_INVALID', 400);
        }
        if (!isObject(input)) throw new CredentialStoreError('REQUEST_SCHEMA_INVALID', 400);
        const operation = operationPath || input.operation;
        if (operationPath && input.operation !== undefined && input.operation !== operationPath) {
            throw new CredentialStoreError('REQUEST_SCHEMA_INVALID', 400);
        }
        const result = await dispatch(request, env, operation, input);
        return response(result);
    } catch (error) {
        const normalized = internalError(error);
        return problem(normalized.status, normalized.code);
    }
}

export default {
    fetch(request, env) {
        return handleTenantCredentialStoreRequest(request, env);
    }
};

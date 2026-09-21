export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

export const CANONICAL_RUNTIME_POST_PATHS = Object.freeze([
    '/v1/outcome-service-context:issue',
    '/api/v1/runtime/company-authority:resolve',
    '/api/v1/runtime/knowledge:resolve',
    '/api/v1/runtime/knowledge:retrieve',
    '/api/v1/runtime/tenant-context:resolve',
    '/api/v1/runtime/workspace-connections:validate-revision',
    '/api/v1/runtime/credential-leases',
    '/api/v1/runtime/provider-requests:forward',
    '/api/v1/runtime/meeting-minutes/context-receipts:create',
    '/api/v1/runtime/meeting-minutes/context-receipts:get',
    '/api/v1/runtime/quota:decide',
    '/api/v1/runtime/usage-events',
    '/api/v1/runtime/operation-receipts:finalize',
    '/api/v1/runtime/operation-receipts:finalize-with-pricing'
]);
const OUTCOME_CONTEXT_ISSUE_PATH = '/v1/outcome-service-context:issue';
const OUTCOME_AUTHORITY_READBACK_HEADER = 'brainbase-outcome-authority-readback';
export const VERIFICATION_KEYS_PATH = '/api/v1/runtime/verification-keys';
const RECEIPT_HISTORY_PATH = /^\/api\/v1\/runtime\/operation-receipts\/receipt_[0-9A-HJKMNP-TV-Z]{26}\/history:read$/;
const REQUEST_HEADERS = Object.freeze([
    'accept',
    'brainbase-deployment-id',
    'brainbase-protocol-version',
    'content-type'
]);
const RESPONSE_HEADERS = Object.freeze([
    'cache-control',
    'content-type',
    'retry-after'
]);

function problem(status, code, retryable = false) {
    return Response.json({
        type: `https://brainbase.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
        status,
        code,
        title: '要求を処理できません',
        retryable,
        fault_domain: 'brainbase_cloud',
        correlation_id: null,
        details: { required_action: retryable ? 'retry' : 'contact_operator' }
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
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error('bridge_configuration_invalid');
    }
    return value.trim();
}

function configuredOrigin(env) {
    const rawOrigin = requiredSecret(env, 'BRAINBASE_TENANT_RUNTIME_ORIGIN');
    const expectedHostname = requiredSecret(env, 'BRAINBASE_TENANT_RUNTIME_ORIGIN_HOSTNAME').toLowerCase();
    let origin;
    try {
        origin = new URL(rawOrigin);
    } catch {
        throw new Error('bridge_configuration_invalid');
    }
    const canonicalPath = origin.pathname === '' || origin.pathname === '/';
    if (origin.protocol !== 'https:'
        || origin.username || origin.password
        || origin.port || !canonicalPath
        || origin.search || origin.hash
        || origin.hostname.toLowerCase() !== expectedHostname) {
        throw new Error('bridge_configuration_invalid');
    }
    return origin;
}

function allowedRuntimePath(request) {
    const url = new URL(request.url);
    if (url.search !== '') return null;
    if (request.method === 'GET' && url.pathname === VERIFICATION_KEYS_PATH) {
        return { method: 'GET', path: url.pathname };
    }
    if (request.method === 'POST'
        && (CANONICAL_RUNTIME_POST_PATHS.includes(url.pathname) || RECEIPT_HISTORY_PATH.test(url.pathname))) {
        return { method: 'POST', path: url.pathname };
    }
    return null;
}

async function readBoundedBody(request) {
    const declaredLength = request.headers.get('content-length');
    if (declaredLength !== null) {
        const normalizedLength = declaredLength.trim();
        const size = Number(normalizedLength);
        if (!/^\d+$/.test(normalizedLength)
            || !Number.isSafeInteger(size)
            || size > MAX_REQUEST_BODY_BYTES) {
            throw new RangeError('request_body_too_large');
        }
    }
    if (!request.body) return new Uint8Array();

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
                throw new RangeError('request_body_too_large');
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
    return body;
}

function upstreamHeaders(request, env, outcomeAuthorityReadback = null) {
    const headers = new Headers();
    for (const name of REQUEST_HEADERS) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
    }
    headers.set('authorization', `Bearer ${requiredSecret(env, 'BRAINBASE_SERVICE_JWT')}`);
    headers.set('cf-access-client-id', requiredSecret(env, 'CF_ACCESS_CLIENT_ID'));
    headers.set('cf-access-client-secret', requiredSecret(env, 'CF_ACCESS_CLIENT_SECRET'));
    if (outcomeAuthorityReadback) {
        const bytes = new TextEncoder().encode(JSON.stringify(outcomeAuthorityReadback));
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        headers.set(OUTCOME_AUTHORITY_READBACK_HEADER, btoa(binary)
            .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''));
    }
    return headers;
}

function canonicalize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function base64UrlDecode(value) {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function verifyOutcomeAuthority(requestBody, env, now = new Date()) {
    let body;
    try {
        body = JSON.parse(new TextDecoder().decode(requestBody));
    } catch {
        throw new TypeError('request_body_invalid');
    }
    const proof = body?.authority_proof;
    const payload = proof?.payload;
    const integrity = proof?.integrity;
    if (!payload || !integrity || integrity.method !== 'jws_detached' || integrity.algorithm !== 'EdDSA') {
        throw new Error('outcome_authority_proof_invalid');
    }
    let jwks;
    try { jwks = JSON.parse(requiredSecret(env, 'MANA_OUTCOME_AUTHORITY_JWKS_JSON')); }
    catch { throw new Error('bridge_configuration_invalid'); }
    const matches = Array.isArray(jwks?.keys) ? jwks.keys.filter((key) => key?.kid === integrity.key_id
        && key.kty === 'OKP' && key.crv === 'Ed25519' && (!key.use || key.use === 'sig')) : [];
    if (matches.length !== 1) throw new Error('outcome_authority_proof_invalid');
    const [protectedHeader, detached, encodedSignature, ...rest] = String(integrity.value).split('.');
    let header;
    try { header = JSON.parse(new TextDecoder().decode(base64UrlDecode(protectedHeader))); }
    catch { throw new Error('outcome_authority_proof_invalid'); }
    if (!protectedHeader || detached !== '' || !encodedSignature || rest.length
        || header.alg !== 'EdDSA' || header.b64 !== false || header.kid !== integrity.key_id
        || canonicalize(header.crit) !== '["b64"]'
        || header.typ !== 'application/mana-outcome-authority-proof+jws') {
        throw new Error('outcome_authority_proof_invalid');
    }
    let key;
    try { key = await crypto.subtle.importKey('jwk', matches[0], { name: 'Ed25519' }, false, ['verify']); }
    catch { throw new Error('bridge_configuration_invalid'); }
    const verified = await crypto.subtle.verify({ name: 'Ed25519' }, key, base64UrlDecode(encodedSignature),
        new TextEncoder().encode(`${protectedHeader}.${canonicalize(payload)}`));
    const issuedAt = Date.parse(payload.issued_at);
    const expiresAt = Date.parse(payload.expires_at);
    const observedAt = now.getTime();
    if (!verified || payload.schema_version !== '1.0' || payload.issuer !== 'unson-business-mana-runtime'
        || payload.audience !== 'brainbase-tenant-runtime' || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
        || expiresAt <= issuedAt || expiresAt - issuedAt > 60_000 || issuedAt > observedAt + 10_000 || expiresAt < observedAt - 10_000
        || canonicalize(payload.principal) !== canonicalize(body.principal)
        || canonicalize(payload.persisted) !== canonicalize(body.persisted)
        || payload.operation_id !== body?.required?.operation_id
        || payload.run_mode !== body?.required?.run_mode
        || payload.profile_id !== body?.profile
        || typeof payload.authority_revision !== 'string' || !payload.authority_revision
        || !['draft', 'active'].includes(payload.contract_status)) {
        throw new Error('outcome_authority_proof_invalid');
    }
    return { principal: payload.principal, persisted: payload.persisted,
        authority_revision: payload.authority_revision, profile_id: payload.profile_id,
        run_mode: payload.run_mode, contract_status: payload.contract_status };
}

function safeUpstreamProblem(body, upstream, logger) {
    if (upstream.ok || !upstream.headers.get('content-type')?.includes('application/problem+json')) return;
    try {
        const parsed = JSON.parse(new TextDecoder().decode(body));
        logger.warn(JSON.stringify({
            event: 'tenant_runtime_upstream_problem',
            status: upstream.status,
            code: typeof parsed?.code === 'string' ? parsed.code : null,
            scope_reason: typeof parsed?.details?.scope_reason === 'string' ? parsed.details.scope_reason : null,
            required_action: typeof parsed?.details?.required_action === 'string' ? parsed.details.required_action : null,
        }));
    } catch {
        logger.warn(JSON.stringify({ event: 'tenant_runtime_upstream_problem', status: upstream.status,
            code: null, scope_reason: null, required_action: null }));
    }
}

async function downstreamResponse(upstream, logger) {
    const headers = new Headers();
    for (const name of RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value !== null) headers.set(name, value);
    }
    headers.set('cache-control', 'no-store');
    const body = await upstream.arrayBuffer();
    safeUpstreamProblem(body, upstream, logger);
    return new Response(body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
    });
}

export async function handleTenantRuntimeBridgeRequest(request, env, { fetchImpl = fetch, logger = console } = {}) {
    const route = allowedRuntimePath(request);
    if (!route) return problem(404, 'BRIDGE_ROUTE_NOT_ALLOWED');

    let origin;
    let headers;
    try {
        origin = configuredOrigin(env);
    } catch {
        return problem(503, 'BRIDGE_CONFIGURATION_INVALID');
    }

    let body = null;
    if (route.method === 'POST') {
        try {
            body = await readBoundedBody(request);
        } catch (error) {
            if (error instanceof RangeError) return problem(413, 'REQUEST_BODY_TOO_LARGE');
            return problem(400, 'REQUEST_BODY_INVALID');
        }
    }

    let outcomeAuthorityReadback = null;
    if (route.path === OUTCOME_CONTEXT_ISSUE_PATH) {
        try {
            outcomeAuthorityReadback = await verifyOutcomeAuthority(body, env);
            const { authority_proof: _authorityProof, ...forwardBody } = JSON.parse(new TextDecoder().decode(body));
            body = new TextEncoder().encode(JSON.stringify(forwardBody));
        } catch (error) {
            if (error instanceof TypeError) return problem(400, 'REQUEST_BODY_INVALID');
            if (error?.message === 'bridge_configuration_invalid') return problem(503, 'BRIDGE_CONFIGURATION_INVALID');
            if (error?.message === 'outcome_authority_proof_invalid') return problem(403, 'OUTCOME_AUTHORITY_PROOF_INVALID');
            return problem(502, 'OUTCOME_AUTHORITY_PROOF_VERIFICATION_FAILED', true);
        }
    }
    try {
        headers = upstreamHeaders(request, env, outcomeAuthorityReadback);
    } catch {
        return problem(503, 'BRIDGE_CONFIGURATION_INVALID');
    }

    const upstreamUrl = new URL(route.path, origin);
    const upstreamRequest = new Request(upstreamUrl, {
        method: route.method,
        headers,
        ...(body === null ? {} : { body }),
        redirect: 'manual'
    });
    try {
        return await downstreamResponse(await fetchImpl(upstreamRequest), logger);
    } catch {
        return problem(502, 'BRIDGE_UPSTREAM_UNAVAILABLE', true);
    }
}

export default {
    fetch(request, env) {
        return handleTenantRuntimeBridgeRequest(request, env);
    }
};

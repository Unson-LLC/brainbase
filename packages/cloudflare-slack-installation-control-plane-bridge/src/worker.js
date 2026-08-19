export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export const INSTALLATION_CONTROL_PLANE_PATHS = Object.freeze([
    '/api/v1/slack-installations:authorize',
    '/api/v1/slack-installations:exchange-and-register'
]);

const REQUEST_HEADERS = Object.freeze([
    'accept',
    'authorization',
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
    const rawOrigin = requiredSecret(env, 'BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_ORIGIN');
    const expectedHostname = requiredSecret(
        env,
        'BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_ORIGIN_HOSTNAME'
    ).toLowerCase();
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

function assertAllowedRoute(request) {
    const url = new URL(request.url);
    return request.method === 'POST'
        && INSTALLATION_CONTROL_PLANE_PATHS.includes(url.pathname)
        && url.search === ''
        && url.hash === '';
}

async function readBoundedBody(request) {
    const declaredLength = request.headers.get('content-length');
    if (declaredLength !== null) {
        const size = Number(declaredLength);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_REQUEST_BODY_BYTES) {
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

function upstreamHeaders(request, env) {
    const headers = new Headers();
    const pathname = new URL(request.url).pathname;
    const isAuthorize = pathname === INSTALLATION_CONTROL_PLANE_PATHS[0];
    for (const name of REQUEST_HEADERS) {
        // Only the browser-initiated authorization request carries the
        // caller's bearer credential. The callback exchange is authenticated
        // by the private Service Binding/Access boundary and must not receive
        // a user token even if a caller tries to add one.
        if (name === 'authorization' && !isAuthorize) continue;
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
    }
    if (!isAuthorize) {
        // The callback is deliberately authenticated as a single-purpose
        // Brainbase service. Never let a caller's bearer token cross the
        // Service Binding boundary; the Node route verifies this token's
        // signature, issuer, audience, deployment and exact capability.
        headers.set(
            'authorization',
            `Bearer ${requiredSecret(env, 'BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN')}`
        );
    }
    // The bridge accepts a user/service credential, never caller-supplied
    // Cloudflare Access headers. Access authenticates the private origin.
    headers.set('cf-access-client-id', requiredSecret(env, 'CF_ACCESS_CLIENT_ID'));
    headers.set('cf-access-client-secret', requiredSecret(env, 'CF_ACCESS_CLIENT_SECRET'));
    return headers;
}

function downstreamResponse(upstream) {
    const headers = new Headers();
    for (const name of RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value !== null) headers.set(name, value);
    }
    headers.set('cache-control', 'no-store');
    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
    });
}

export async function handleSlackInstallationControlPlaneBridgeRequest(
    request,
    env,
    { fetchImpl = fetch } = {}
) {
    if (!assertAllowedRoute(request)) return problem(404, 'BRIDGE_ROUTE_NOT_ALLOWED');

    let origin;
    let headers;
    try {
        origin = configuredOrigin(env);
        headers = upstreamHeaders(request, env);
    } catch {
        return problem(503, 'BRIDGE_CONFIGURATION_INVALID');
    }

    let body;
    try {
        body = await readBoundedBody(request);
    } catch (error) {
        if (error instanceof RangeError) return problem(413, 'REQUEST_BODY_TOO_LARGE');
        return problem(400, 'REQUEST_BODY_INVALID');
    }

    const upstreamUrl = new URL(new URL(request.url).pathname, origin);
    const upstreamRequest = new Request(upstreamUrl, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual'
    });
    try {
        return downstreamResponse(await fetchImpl(upstreamRequest));
    } catch {
        return problem(502, 'BRIDGE_UPSTREAM_UNAVAILABLE', true);
    }
}

export default {
    fetch(request, env) {
        return handleSlackInstallationControlPlaneBridgeRequest(request, env);
    }
};

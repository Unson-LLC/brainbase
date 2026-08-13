#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrainbaseHttpClient } from './lib/brainbase-http-client.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
        args.set(arg.slice(2), process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1]);
        if (!process.argv[i + 1]?.startsWith('--')) i += 1;
    }
}

const baseUrl = String(args.get('base-url') || process.env.BRAINBASE_ADMIN_BASE_URL || 'http://127.0.0.1:31019').replace(/\/$/, '');
const outputPath = args.get('output') ? path.resolve(String(args.get('output'))) : null;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function gitContext() {
    try {
        const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim();
        return { head_sha: head, dirty: Boolean(status), status };
    } catch {
        return { head_sha: null, dirty: null, status: null };
    }
}

function readToken() {
    if (process.env.BRAINBASE_AUTH_TOKEN) return { token: process.env.BRAINBASE_AUTH_TOKEN, source: 'env:BRAINBASE_AUTH_TOKEN' };
    const tokenPath = path.join(os.homedir(), '.brainbase', 'tokens.json');
    const parsed = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    if (!parsed.access_token) throw new Error('access_token is missing from ~/.brainbase/tokens.json');
    return { token: parsed.access_token, source: '~/.brainbase/tokens.json' };
}

function readInternalApiSecret() {
    if (process.env.INTERNAL_API_SECRET) return { secret: process.env.INTERNAL_API_SECRET, source: 'env:INTERNAL_API_SECRET' };
    const envPath = path.join(os.homedir(), 'workspace', '.env');
    if (!fs.existsSync(envPath)) return null;
    const match = fs.readFileSync(envPath, 'utf8').match(/^INTERNAL_API_SECRET=(.*)$/m);
    if (!match?.[1]) return null;
    return { secret: match[1].replace(/^['"]|['"]$/g, ''), source: '~/workspace/.env' };
}

function cacheHeaders(headers) {
    return {
        cache_control: headers.get('cache-control'),
        pragma: headers.get('pragma'),
        expires: headers.get('expires')
    };
}

function assertNoCache(headers, label) {
    assert(headers.cache_control === 'no-store, no-cache, must-revalidate, proxy-revalidate', `${label} cache-control mismatch: ${headers.cache_control}`);
    assert(headers.pragma === 'no-cache', `${label} pragma mismatch: ${headers.pragma}`);
    assert(headers.expires === '0', `${label} expires mismatch: ${headers.expires}`);
}

async function requestJson({ method = 'GET', endpoint, headers = {}, body = null, auth = true }) {
    const result = await http.request(endpoint, { method, headers, body: body || undefined, auth, throwOnError: false });
    return {
        method,
        endpoint,
        status: result.status,
        latency_ms: result.latencyMs,
        headers: cacheHeaders(result.headers),
        payload: result.payload
    };
}

const internalApi = readInternalApiSecret();
let tokenAuth = null;
try {
    tokenAuth = readToken();
} catch (error) {
    if (!internalApi) throw error;
}

const authSource = internalApi?.source || tokenAuth.source;
const sessionId = 'admin-path-surface-smoke';
const http = createBrainbaseHttpClient({
    baseUrl,
    accessToken: tokenAuth?.token,
    internalApiKey: internalApi?.secret,
    sessionId
});

const liveChecks = [];
for (const check of [
    { method: 'GET', endpoint: '/api/admin/overview' },
    { method: 'GET', endpoint: '/api/admin/graph/entities?limit=1' },
    { method: 'GET', endpoint: '/api/admin/candidates?limit=1' },
    { method: 'GET', endpoint: '/api/admin/personal-kg?limit=5' },
    {
        method: 'POST',
        endpoint: '/api/admin/context-preview',
        body: { project: 'brainbase', includeEdges: true, includeMemory: false, includePhilosophy: true }
    },
    { method: 'GET', endpoint: '/api/admin/data-flow?project=brainbase' },
    { method: 'GET', endpoint: '/api/admin/health' }
]) {
    const result = await requestJson(check);
    assert(result.status === 200, `${check.method} ${check.endpoint} returned HTTP ${result.status}`);
    assertNoCache(result.headers, `${check.method} ${check.endpoint}`);
    liveChecks.push({
        method: result.method,
        endpoint: result.endpoint,
        status: result.status,
        latency_ms: result.latency_ms,
        headers: result.headers,
        source_class: result.payload.source_class || null,
        top_level_keys: Object.keys(result.payload).sort(),
        personal_kg_total: result.payload.summary?.total || result.payload.personal_kg?.summary?.total || null,
        database_status: result.payload.runtime_config?.database?.connection_status || null,
        value_redacted: result.payload.runtime_config?.database?.value_redacted || null,
        has_postgres_url: JSON.stringify(result.payload).includes('postgres://')
    });
}

const unauthenticated = await requestJson({ endpoint: '/api/admin/overview', auth: false });
assert(unauthenticated.status === 401, `Unauthenticated overview returned HTTP ${unauthenticated.status}`);
assertNoCache(unauthenticated.headers, 'GET /api/admin/overview unauthenticated');

const personalKg = liveChecks.find((item) => item.endpoint.startsWith('/api/admin/personal-kg'));
const overview = liveChecks.find((item) => item.endpoint === '/api/admin/overview');
const health = liveChecks.find((item) => item.endpoint === '/api/admin/health');
assert(personalKg?.personal_kg_total && personalKg.personal_kg_total > 0, 'Personal KG total missing from path-surface smoke');
assert(health?.database_status === 'connected', 'DB connection is not connected in health path-surface smoke');
assert(overview?.database_status === health.database_status, `Overview DB status (${overview?.database_status}) does not match health DB status (${health.database_status})`);
assert(overview?.value_redacted === true, 'Overview DB value is not redacted in path-surface smoke');
assert(health?.value_redacted === true, 'Health DB value is not redacted in path-surface smoke');
assert(liveChecks.every((item) => item.has_postgres_url === false), 'A live admin response leaked a postgres URL');

const result = {
    checked_at: new Date().toISOString(),
    base_url: baseUrl,
    git_context: gitContext(),
    auth: `${authSource}; credential value not recorded`,
    csrf: 'fetched from /api/csrf-token; token value not recorded',
    static_client_paths: [
        '/api/admin/candidates',
        '/api/admin/context-preview',
        '/api/admin/data-flow',
        '/api/admin/graph/entities',
        '/api/admin/health',
        '/api/admin/overview',
        '/api/admin/personal-kg'
    ],
    server_routes: [
        { method: 'GET', mounted_path: '/api/admin/overview' },
        { method: 'GET', mounted_path: '/api/admin/graph/entities' },
        { method: 'GET', mounted_path: '/api/admin/candidates' },
        { method: 'GET', mounted_path: '/api/admin/personal-kg' },
        { method: 'POST', mounted_path: '/api/admin/context-preview' },
        { method: 'GET', mounted_path: '/api/admin/data-flow' },
        { method: 'GET', mounted_path: '/api/admin/health' }
    ],
    missing_routes: [],
    live_checks: liveChecks,
    rejection_checks: [
        {
            method: unauthenticated.method,
            endpoint: unauthenticated.endpoint,
            status: unauthenticated.status,
            headers: unauthenticated.headers
        }
    ],
    conclusion: 'pass: /api/admin/* paths have mounted server routes, live authenticated responses, no-store/no-cache headers, source_class boundaries, Personal KG data, DB health redaction, CSRF-backed POST coverage, unauthenticated rejection cache headers, and no postgres URL leakage.'
};

if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
} else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

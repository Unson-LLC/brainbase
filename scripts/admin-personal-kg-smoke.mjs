#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function getJson(endpoint, headers) {
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: { Accept: 'application/json', ...headers }
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    return { endpoint, status: response.status, latency_ms: Date.now() - startedAt, payload };
}

const internalApi = readInternalApiSecret();
let tokenAuth = null;
try {
    tokenAuth = readToken();
} catch (error) {
    if (!internalApi) throw error;
}
const authHeaders = internalApi
    ? { 'x-internal-api-key': internalApi.secret }
    : { Authorization: `Bearer ${tokenAuth.token}` };
const authSource = internalApi?.source || tokenAuth.source;
assert(tokenAuth, 'Denied owner smoke requires BRAINBASE_AUTH_TOKEN or ~/.brainbase/tokens.json');
const deniedOwnerHeaders = { Authorization: `Bearer ${tokenAuth.token}` };
const deniedOwnerAuthSource = tokenAuth.source;
const [personalKg, deniedOwner, overview, health] = await Promise.all([
    getJson('/api/admin/personal-kg?limit=5', authHeaders),
    getJson('/api/admin/personal-kg?owner=umeda&limit=5', deniedOwnerHeaders),
    getJson('/api/admin/overview', authHeaders),
    getJson('/api/admin/health', authHeaders)
]);

assert(personalKg.status === 200, `Personal KG returned HTTP ${personalKg.status}`);
assert(personalKg.payload.source_class === 'personal_kg', 'Personal KG source_class mismatch');
assert(personalKg.payload.status === 'available', 'Personal KG is not available');
assert(personalKg.payload.owner_person_id, 'Personal KG owner_person_id missing');
assert(Number(personalKg.payload.summary?.returned_count || 0) <= 5, 'Personal KG returned_count exceeds requested limit');
assert(personalKg.payload.records?.every((record) => record.source_class === 'personal_kg'), 'Personal KG records have wrong source_class');

assert(deniedOwner.status === 200, `Denied owner returned HTTP ${deniedOwner.status}`);
assert(deniedOwner.payload.requested_owner_person_id === 'umeda', 'Denied owner request marker missing');
assert(Array.isArray(deniedOwner.payload.records) && deniedOwner.payload.records.length === 0, 'Denied owner returned records');
assert(JSON.stringify(deniedOwner.payload).includes('現在の権限では表示できません'), 'Denied owner warning missing');

assert(overview.status === 200, `Overview returned HTTP ${overview.status}`);
assert(overview.payload.personal_kg?.summary?.returned_count === 0, 'Overview fetched Personal KG record bodies');

assert(health.status === 200, `Health returned HTTP ${health.status}`);
const database = health.payload.runtime_config?.database;
assert(database?.value === null && database?.value_redacted === true, 'DB value is not redacted');
assert(!JSON.stringify(health.payload).includes('postgres://'), 'Health leaked a postgres URL');
const personalKgReadiness = (health.payload.runtime_config?.checks || []).find((item) => item.source_class === 'personal_kg');
assert(personalKgReadiness?.status === 'available', 'Personal KG read path is not available');
const runtimeKeyStatus = Object.fromEntries((health.payload.runtime_config?.keys || []).map((item) => [item.key, item.status]));
assert(runtimeKeyStatus.BRAINBASE_ENV_PATH === 'present', 'BRAINBASE_ENV_PATH is not present in server runtime health');
if (tokenAuth) assert(!JSON.stringify(health.payload).includes(tokenAuth.token), 'Health leaked the bearer token');
if (internalApi) assert(!JSON.stringify(health.payload).includes(internalApi.secret), 'Health leaked the internal API secret');

const result = {
    checked_at: new Date().toISOString(),
    base_url: baseUrl,
    auth: `${authSource}; credential value not recorded`,
    denied_owner_auth: `${deniedOwnerAuthSource}; credential value not recorded`,
    personal_kg: {
        endpoint: personalKg.endpoint,
        latency_ms: personalKg.latency_ms,
        status: personalKg.payload.status,
        owner_person_id: personalKg.payload.owner_person_id,
        summary: personalKg.payload.summary,
        first_record_shape: personalKg.payload.records?.[0] ? {
            id: personalKg.payload.records[0].id,
            memory_layer: personalKg.payload.records[0].memory_layer,
            sns_ready: personalKg.payload.records[0].sns_ready,
            promotion_status: personalKg.payload.records[0].promotion_status,
            redaction_status: personalKg.payload.records[0].redaction_status,
            requires_approval: personalKg.payload.records[0].requires_approval,
            cognitive_type: personalKg.payload.records[0].cognitive_type,
            source_system: personalKg.payload.records[0].source_system,
            created_at: personalKg.payload.records[0].created_at
        } : null
    },
    denied_owner_filter: {
        endpoint: deniedOwner.endpoint,
        status: deniedOwner.payload.status,
        owner_person_id: deniedOwner.payload.owner_person_id,
        requested_owner_person_id: deniedOwner.payload.requested_owner_person_id,
        record_count: deniedOwner.payload.records?.length || 0,
        warnings: deniedOwner.payload.warnings || []
    },
    overview: {
        endpoint: overview.endpoint,
        latency_ms: overview.latency_ms,
        source_status: Object.fromEntries((overview.payload.sources || []).map((sourceItem) => [sourceItem.source_class, sourceItem.status])),
        personal_kg_records_fetched: overview.payload.personal_kg?.summary?.returned_count,
        personal_kg_total: overview.payload.personal_kg?.summary?.total
    },
    health: {
        endpoint: health.endpoint,
        latency_ms: health.latency_ms,
        source_status: Object.fromEntries((health.payload.sources || []).map((sourceItem) => [sourceItem.source_class, sourceItem.status])),
        database: database ? {
            label: database.label,
            status: database.status,
            connection_status: database.connection_status,
            keys: database.keys,
            value: database.value,
            value_redacted: database.value_redacted
        } : null,
        personal_kg_readiness: personalKgReadiness ? {
            label: personalKgReadiness.label,
            status: personalKgReadiness.status
        } : null,
        runtime_key_status: runtimeKeyStatus,
        database_key_status: Object.fromEntries((health.payload.runtime_config?.keys || [])
            .filter((item) => item.key === 'INFO_SSOT_DATABASE_URL' || item.key === 'INFO_SSOT_DB_URL')
            .map((item) => [item.key, item.status]))
    }
};

if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
} else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

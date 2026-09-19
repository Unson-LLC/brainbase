import { isCanonicalId } from './ids.js';
import { ContractError } from './errors.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STATE_DIGEST = /^[a-f0-9]{64}$/u;
const ISSUE_FIELDS = Object.freeze([
    'provider', 'tenant_id', 'person_id', 'jti', 'issued_at', 'expires_at', 'state_digest'
]);
const CONSUME_FIELDS = Object.freeze([...ISSUE_FIELDS, 'now']);

function canonicalInstant(value) {
    if (typeof value !== 'string') return null;
    const millis = Date.parse(value);
    if (!Number.isFinite(millis)) return null;
    const date = new Date(millis);
    return date.toISOString() === value ? date : null;
}

function exactFields(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    return keys.length === expected.length
        && JSON.stringify(keys) === JSON.stringify([...expected].sort());
}

function stateBinding(value, fields) {
    if (!exactFields(value, fields) || value.provider !== 'github'
        || !isCanonicalId(value.tenant_id, 'ten')
        || !isCanonicalId(value.person_id, 'per')
        || typeof value.jti !== 'string' || !UUID_V4.test(value.jti)
        || typeof value.state_digest !== 'string' || !STATE_DIGEST.test(value.state_digest)) return null;
    const issuedAt = canonicalInstant(value.issued_at);
    const expiresAt = canonicalInstant(value.expires_at);
    if (!issuedAt || !expiresAt || expiresAt <= issuedAt
        || expiresAt.getTime() - issuedAt.getTime() > STATE_TTL_MS) return null;
    return { issuedAt, expiresAt };
}

function unavailable() {
    return new ContractError('GITHUB_STATE_STORE_UNAVAILABLE', {
        status: 503,
        retryable: true,
        fault_domain: 'brainbase_cloud'
    });
}

/**
 * Durable, tenant-scoped, one-use storage for GitHub App callback state.
 * The database stores only the signed-state digest and its binding; the
 * replayable signed state itself is never accepted by this adapter.
 */
export class PostgresGitHubAuthorizationLedger {
    constructor({ pool, now = () => new Date() } = {}) {
        if (!pool || typeof pool.connect !== 'function') {
            throw new Error('Multitenant PostgreSQL pool is required');
        }
        this.pool = pool;
        this.now = now;
    }

    async #withTenant(tenantId, operation) {
        let client;
        let transactionStarted = false;
        try {
            client = await this.pool.connect();
            await client.query('BEGIN');
            transactionStarted = true;
            await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [tenantId]);
            const result = await operation(client);
            await client.query('COMMIT');
            transactionStarted = false;
            return result;
        } catch {
            if (transactionStarted) {
                try {
                    await client.query('ROLLBACK');
                } catch {
                    // Keep the original failure; the caller receives a safe code.
                }
            }
            throw unavailable();
        } finally {
            client?.release();
        }
    }

    async issue(input) {
        const binding = stateBinding(input, ISSUE_FIELDS);
        const current = this.now();
        if (!binding || !(current instanceof Date) || Number.isNaN(current.getTime())
            || binding.issuedAt.getTime() > current.getTime()
            || binding.expiresAt.getTime() <= current.getTime()) return false;

        return this.#withTenant(input.tenant_id, async (client) => {
            const result = await client.query(
                `INSERT INTO github_authorization_states (
                    tenant_id, jti, person_id, state_digest, issued_at, expires_at
                 ) VALUES ($1, $2::uuid, $3, $4, $5::timestamptz, $6::timestamptz)
                 ON CONFLICT DO NOTHING
                 RETURNING jti`,
                [input.tenant_id, input.jti, input.person_id, input.state_digest,
                    binding.issuedAt.toISOString(), binding.expiresAt.toISOString()]
            );
            return result.rowCount === 1;
        });
    }

    async consume(input) {
        const binding = stateBinding(input, CONSUME_FIELDS);
        const now = canonicalInstant(input?.now);
        if (!binding || !now || binding.issuedAt.getTime() > now.getTime()
            || binding.expiresAt.getTime() <= now.getTime()) return false;

        return this.#withTenant(input.tenant_id, async (client) => {
            const result = await client.query(
                `UPDATE github_authorization_states
                    SET consumed_at = $7::timestamptz
                  WHERE tenant_id = $1
                    AND jti = $2::uuid
                    AND person_id = $3
                    AND state_digest = $4
                    AND issued_at = $5::timestamptz
                    AND expires_at = $6::timestamptz
                    AND consumed_at IS NULL
                    AND issued_at <= $7::timestamptz
                    AND expires_at > $7::timestamptz
                  RETURNING jti`,
                [input.tenant_id, input.jti, input.person_id, input.state_digest,
                    binding.issuedAt.toISOString(), binding.expiresAt.toISOString(), now.toISOString()]
            );
            return result.rowCount === 1;
        });
    }
}

export function createPostgresGitHubAuthorizationLedger(options) {
    return new PostgresGitHubAuthorizationLedger(options);
}

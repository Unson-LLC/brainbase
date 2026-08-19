import {
    createHash,
    createPrivateKey,
    createPublicKey,
    sign,
    verify
} from 'node:crypto';
import { canonicalJson, deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';
import { assertMigrationCandidateTargets } from './migration-planner.js';

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ALGORITHM = 'EdDSA';

function keyFor(value, type) {
    if (typeof value === 'string' || Buffer.isBuffer(value) || value?.type) return value;
    return type === 'private'
        ? createPrivateKey({ key: value, format: 'jwk' })
        : createPublicKey({ key: value, format: 'jwk' });
}

function invalidAttestation() {
    throw new ContractError('MIGRATION_PLAN_ATTESTATION_INVALID', {
        status: 403,
        fault_domain: 'protocol'
    });
}

function payloadBytes(plan) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.mode !== 'dry_run') {
        invalidAttestation();
    }
    const { attestation: _attestation, ...unsigned } = plan;
    try {
        return Buffer.from(canonicalJson(unsigned), 'utf8');
    } catch {
        invalidAttestation();
    }
}

function digestFor(payload) {
    return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function decodeSignature(value) {
    if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value) || value.includes('=')) {
        invalidAttestation();
    }
    const signature = Buffer.from(value, 'base64url');
    if (signature.length !== 64 || signature.toString('base64url') !== value) invalidAttestation();
    return signature;
}

/**
 * Signs the immutable dry-run migration plan and verifies it before writes.
 * The private key is retained only by this process and is never serialized.
 */
export class MigrationPlanAttestor {
    constructor({ key_id: keyId, private_key: privateKey, public_key: publicKey } = {}) {
        if (typeof keyId !== 'string' || keyId.length === 0 || !privateKey) {
            throw new Error('Migration plan signing key is required');
        }
        this.keyId = keyId;
        this.privateKey = keyFor(privateKey, 'private');
        this.publicKey = keyFor(publicKey ?? createPublicKey(this.privateKey), 'public');
    }

    attest(plan) {
        assertMigrationCandidateTargets(plan?.target_tenant_id, plan?.candidates);
        const payload = payloadBytes(plan);
        const digest = digestFor(payload);
        const signature = sign(null, payload, this.privateKey).toString('base64url');
        return deepFreeze({
            ...plan,
            attestation: {
                algorithm: ALGORITHM,
                key_id: this.keyId,
                digest,
                signature
            }
        });
    }

    verify(plan) {
        assertMigrationCandidateTargets(plan?.target_tenant_id, plan?.candidates);
        const attestation = plan?.attestation;
        if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)
            || Object.keys(attestation).length !== 4
            || !['algorithm', 'key_id', 'digest', 'signature'].every((field) => (
                Object.hasOwn(attestation, field)
            ))
            || attestation.algorithm !== ALGORITHM
            || attestation.key_id !== this.keyId
            || !DIGEST_PATTERN.test(attestation.digest)) {
            invalidAttestation();
        }
        const payload = payloadBytes(plan);
        if (digestFor(payload) !== attestation.digest) invalidAttestation();
        const signature = decodeSignature(attestation.signature);
        try {
            if (!verify(null, payload, this.publicKey, signature)) invalidAttestation();
        } catch {
            invalidAttestation();
        }
        return plan;
    }
}

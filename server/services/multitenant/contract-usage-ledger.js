import { createHash } from 'node:crypto';
import { canonicalJson, deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';
import { generateCanonicalId } from './ids.js';
import { assertCanonicalRevision } from './tenant-context.js';

const OUTCOMES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const COLLECTION_STATES = new Set(['collected', 'partial', 'not_collected']);
const IDEMPOTENCY_OWNER_BY_SCOPE = Object.freeze({
    credential_lease: 'brainbase',
    quota_decision: 'brainbase',
    business_effect: 'brainbase',
    usage_receipt: 'brainbase',
    queue_execution: 'mana_runtime',
    slack_delivery: 'mana_runtime'
});

function fail(code, options = {}) {
    throw new ContractError(code, { status: 400, fault_domain: 'protocol', ...options });
}

function lengthPrefix(value) {
    const bytes = Buffer.from(String(value), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
}

export function computeBusinessIdempotencyKey(input) {
    const fields = ['protocol_id', 'protocol_major', 'tenant_id', 'connection_id', 'slack_event_id', 'operation_id'];
    const hash = createHash('sha256');
    for (const field of fields) {
        if (input[field] === undefined || input[field] === null) {
            throw new ContractError('IDEMPOTENCY_INPUT_INVALID', { status: 400, details: { field } });
        }
        hash.update(lengthPrefix(input[field]));
    }
    return `ik1_${hash.digest('base64url')}`;
}

export function validateUsageEvent(event) {
    assertCanonicalRevision(event?.connection_revision, 'connection_revision');
    assertCanonicalRevision(event?.contract_revision, 'contract_revision');
    if (event?.message_type !== 'usage_event' || event.protocol_version !== '1.0') fail('SCHEMA_INVALID');
    if (!COLLECTION_STATES.has(event.collection_state)) fail('COLLECTION_STATE_INVALID');
    if (!OUTCOMES.has(event.outcome)) fail('OUTCOME_INVALID');
    if (event.collection_state === 'not_collected' && event.quantity !== null) {
        fail('USAGE_NOT_COLLECTED_HAS_QUANTITY');
    }
    if (event.collection_state === 'partial'
        && (!Array.isArray(event.unknown_fields) || event.unknown_fields.length === 0)) {
        fail('USAGE_PARTIAL_UNKNOWN_FIELDS_REQUIRED');
    }
    if (event.collection_state === 'collected') {
        if (typeof event.quantity !== 'number' || !Number.isFinite(event.quantity) || event.quantity < 0) {
            fail('USAGE_COLLECTED_QUANTITY_REQUIRED');
        }
        if (!Array.isArray(event.unknown_fields) || event.unknown_fields.length !== 0) {
            fail('USAGE_COLLECTED_UNKNOWN_FIELDS_FORBIDDEN');
        }
        if (event.quantity === 0 && event.failure_code !== 'NO_DATA') fail('USAGE_ZERO_REQUIRES_NO_DATA');
    }
    return true;
}

export function normalizeUsageEvent(input) {
    const event = {
        message_type: input.message_type ?? 'usage_event',
        usage_event_id: input.usage_event_id ?? generateCanonicalId('usage'),
        protocol_version: input.protocol_version ?? '1.0',
        ...input,
        unknown_fields: input.unknown_fields ?? []
    };
    validateUsageEvent(event);
    return deepFreeze(structuredClone(event));
}

export function validateQuotaDecision(decision) {
    if (decision?.message_type !== 'quota_decision') fail('SCHEMA_INVALID');
    assertCanonicalRevision(decision.contract_revision, 'contract_revision');
    assertCanonicalRevision(decision.quota_revision, 'quota_revision');
    if (!new Set(['allowed', 'warning', 'hard_stopped', 'approval_required', 'unavailable']).has(decision.decision)) {
        fail('QUOTA_DECISION_INVALID');
    }
    if (decision.decision === 'unavailable') {
        if (decision.limit !== null || decision.used !== null || decision.remaining !== null) {
            fail('QUOTA_UNAVAILABLE_VALUE_INVALID');
        }
    } else if ([decision.limit, decision.used, decision.remaining]
        .some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        fail('QUOTA_VALUE_INVALID');
    }
    return true;
}

export function validateOperationReceipt(receipt) {
    if (receipt?.message_type !== 'operation_receipt') fail('SCHEMA_INVALID');
    assertCanonicalRevision(receipt.connection_revision, 'connection_revision');
    assertCanonicalRevision(receipt.contract_revision, 'contract_revision');
    if (!COLLECTION_STATES.has(receipt.collection_state)) fail('COLLECTION_STATE_INVALID');
    if (!OUTCOMES.has(receipt.outcome)) fail('OUTCOME_INVALID');
    if (!receipt.reply || !Number.isInteger(receipt.reply.reply_count)
        || receipt.reply.reply_count < 0 || receipt.reply.reply_count > 1
        || receipt.reply.legacy_reply_count !== 0) {
        fail('REPLY_OWNERSHIP_INVALID');
    }
    return true;
}

export function validateIdempotencyClaim(claim) {
    const expectedOwner = IDEMPOTENCY_OWNER_BY_SCOPE[claim?.scope];
    if (!expectedOwner || claim.owner !== expectedOwner) fail('IDEMPOTENCY_OWNER_INVALID');
    const expectedKey = computeBusinessIdempotencyKey({
        protocol_id: 'mana-brainbase-tenant-context',
        protocol_major: '1',
        tenant_id: claim.tenant_id,
        connection_id: claim.connection_id,
        slack_event_id: claim.slack_event_id,
        operation_id: claim.operation_id
    });
    if (claim.idempotency_key !== expectedKey) fail('IDEMPOTENCY_KEY_INVALID');
    return true;
}

export class ContractUsageLedger {
    #contracts = new Map();
    #claims = new Map();
    #usageEvents = new Map();
    #receipts = new Map();
    #receiptHashes = new Map();

    constructor({ now = () => new Date() } = {}) {
        this.now = now;
    }

    registerContract(input) {
        if (!input.tenant_id || !input.contract_id || !input.contract_revision || !input.allowances
            || !Array.isArray(input.thresholds_basis_points) || !input.overage_policy
            || !Number.isInteger(input.rate_card_revision) || !Number.isInteger(input.fx_table_revision)) {
            throw new ContractError('CONTRACT_INVALID', { status: 400 });
        }
        const contract = deepFreeze({ ...input });
        this.#contracts.set(`${input.tenant_id}:${input.contract_revision}`, contract);
        return contract;
    }

    decideQuota(input) {
        assertCanonicalRevision(input.contract_revision, 'contract_revision');
        const contract = this.#contracts.get(`${input.tenant_id}:${input.contract_revision}`);
        if (!contract) throw new ContractError('UPSTREAM_UNAVAILABLE', { status: 503, retryable: true, fault_domain: 'brainbase_cloud' });
        const allowance = Number(contract.allowances[input.metric]);
        if (!Number.isFinite(allowance) || allowance <= 0) throw new ContractError('UPSTREAM_UNAVAILABLE', { status: 503 });
        const observed = Number(input.observed_quantity);
        const requested = Number(input.requested_quantity);
        if (!Number.isFinite(observed) || !Number.isFinite(requested) || observed < 0 || requested < 0) {
            throw new ContractError('QUOTA_INPUT_INVALID', { status: 400 });
        }
        const resulting = observed + requested;
        const basisPoints = Math.round((resulting / allowance) * 10000);
        let decision = 'allowed';
        if (basisPoints >= contract.hard_stop_basis_points && contract.overage_policy === 'deny') decision = 'hard_stopped';
        else if (contract.overage_policy === 'allow_with_approval' && basisPoints >= contract.hard_stop_basis_points) decision = 'approval_required';
        else if (contract.thresholds_basis_points.some((threshold) => basisPoints >= threshold)) decision = 'warning';
        const decisionRecord = {
            message_type: 'quota_decision',
            tenant_id: input.tenant_id,
            contract_revision: input.contract_revision,
            quota_revision: String(input.quota_revision ?? contract.quota_revision ?? contract.contract_revision_number ?? '0'),
            limit: allowance,
            used: observed,
            remaining: Math.max(0, allowance - resulting),
            unit: input.unit ?? input.metric,
            window_started_at: input.window_started_at ?? contract.window_started_at,
            window_ends_at: input.window_ends_at ?? contract.window_ends_at,
            decision,
            decided_at: this.now().toISOString(),
            failure_code: null
        };
        validateQuotaDecision(decisionRecord);
        return deepFreeze(decisionRecord);
    }

    claimEffect(input) {
        const existing = this.#claims.get(input.idempotency_key);
        if (existing) {
            if (existing.payload_hash !== input.payload_hash || existing.context_hash !== input.context_hash) {
                throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            }
            return deepFreeze({ ...existing, replayed: true });
        }
        const claim = {
            idempotency_key: input.idempotency_key,
            payload_hash: input.payload_hash,
            context_hash: input.context_hash,
            state: 'claimed',
            claimed_at: this.now().toISOString(),
            retain_until: new Date(this.now().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
        };
        this.#claims.set(input.idempotency_key, claim);
        return deepFreeze({ ...claim, replayed: false });
    }

    transitionClaim(idempotencyKey, state) {
        if (!new Set(['pending', 'claimed', 'succeeded', 'failed_terminal']).has(state)) {
            throw new ContractError('IDEMPOTENCY_STATE_INVALID', { status: 400 });
        }
        const claim = this.#claims.get(idempotencyKey);
        if (!claim) throw new ContractError('IDEMPOTENCY_CLAIM_UNKNOWN', { status: 404 });
        claim.state = state;
        return deepFreeze({ ...claim });
    }

    recordUsage(input) {
        const event = normalizeUsageEvent(input);
        const existing = this.#usageEvents.get(event.usage_event_id);
        if (existing) {
            if (canonicalJson(existing) !== canonicalJson(event)) {
                throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            }
            return existing;
        }
        this.#usageEvents.set(event.usage_event_id, event);
        return event;
    }

    finalizeReceipt(input) {
        const receiptCandidate = input.message_type === 'operation_receipt' ? structuredClone(input) : {
            message_type: 'operation_receipt',
            receipt_id: input.receipt_id ?? generateCanonicalId('receipt'),
            protocol_version: input.protocol_version ?? '1.0',
            ...input,
            collection_state: input.collection_state ?? input.usage?.collection_state,
            operation_ids: input.operation_ids ?? [input.operation_id],
            idempotency_keys: input.idempotency_keys ?? (input.idempotency_key ? [input.idempotency_key] : []),
            completed_at: input.completed_at ?? input.finalized_at ?? this.now().toISOString(),
            reply: input.reply ?? { state: input.outcome, reply_count: 0, legacy_reply_count: 0 }
        };
        receiptCandidate.receipt_id ??= generateCanonicalId('receipt');
        validateOperationReceipt(receiptCandidate);
        const receiptId = receiptCandidate.receipt_id;
        const inputHash = createHash('sha256').update(canonicalJson(receiptCandidate)).digest('base64url');
        const existingHash = this.#receiptHashes.get(receiptId);
        if (existingHash) {
            if (existingHash !== inputHash) throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            return this.#receipts.get(receiptId);
        }
        const receipt = deepFreeze(receiptCandidate);
        this.#receipts.set(receipt.receipt_id, receipt);
        this.#receiptHashes.set(receipt.receipt_id, inputHash);
        return receipt;
    }
}

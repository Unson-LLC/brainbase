import { createHash } from 'node:crypto';
import { canonicalJson, deepFreeze } from './canonical-json.js';
import { ContractError } from './errors.js';
import { generateCanonicalId } from './ids.js';

const OUTCOMES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const COLLECTION_STATES = new Set(['collected', 'partial', 'not_collected']);

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

function decimalString(value) {
    if (value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return String(value);
    if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return value;
    throw new ContractError('USAGE_COLLECTION_INVALID', { status: 400 });
}

export function normalizeUsageEvent(input) {
    if (!OUTCOMES.has(input.outcome) || !COLLECTION_STATES.has(input.collection_state)) {
        throw new ContractError('USAGE_COLLECTION_INVALID', { status: 400 });
    }
    if (input.collection_state === 'not_collected' && input.quantity !== null) {
        throw new ContractError('USAGE_COLLECTION_INVALID', { status: 400 });
    }
    if (input.collection_state === 'collected' && input.quantity === null) {
        throw new ContractError('USAGE_COLLECTION_INVALID', { status: 400 });
    }
    if (input.collection_state === 'partial'
        && (!Array.isArray(input.unknown_fields) || input.unknown_fields.length === 0)) {
        throw new ContractError('USAGE_COLLECTION_INVALID', { status: 400 });
    }
    for (const field of ['tenant_id', 'tenant_revision_at_write', 'connection_id', 'connection_revision', 'deployment_id', 'correlation_id', 'operation_id', 'idempotency_key', 'contract_revision', 'kind', 'unit']) {
        if (input[field] === undefined || input[field] === null || input[field] === '') {
            throw new ContractError('USAGE_COLLECTION_INVALID', { status: 400, details: { field } });
        }
    }
    if (input.failure_code === 'NO_DATA'
        && !(input.collection_state === 'collected' && Number(input.quantity) === 0 && input.outcome === 'succeeded')) {
        throw new ContractError('USAGE_COLLECTION_INVALID', { status: 400 });
    }
    return deepFreeze({
        usage_event_id: input.usage_event_id ?? generateCanonicalId('use'),
        protocol_version: input.protocol_version ?? '1.0',
        ...input,
        quantity: decimalString(input.quantity)
    });
}

export class ContractUsageLedger {
    #contracts = new Map();
    #claims = new Map();
    #usageEvents = new Map();
    #receipts = new Map();
    #usageByIdempotency = new Map();
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
        return deepFreeze({
            tenant_id: input.tenant_id,
            contract_revision: input.contract_revision,
            metric: input.metric,
            observed_quantity: String(input.observed_quantity),
            requested_quantity: String(input.requested_quantity),
            threshold_basis_points: basisPoints,
            decision,
            decided_at: this.now().toISOString()
        });
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
        const idempotencyKey = `${input.tenant_id}:${input.idempotency_key}`;
        const inputHash = createHash('sha256').update(canonicalJson(input)).digest('base64url');
        const replay = this.#usageByIdempotency.get(idempotencyKey);
        if (replay) {
            if (replay.input_hash !== inputHash) throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            return replay.event;
        }
        const event = normalizeUsageEvent(input);
        const existing = this.#usageEvents.get(event.usage_event_id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
            throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
        }
        this.#usageEvents.set(event.usage_event_id, event);
        this.#usageByIdempotency.set(idempotencyKey, { input_hash: inputHash, event });
        return event;
    }

    finalizeReceipt(input) {
        const collectionState = input.usage?.collection_state;
        if (!COLLECTION_STATES.has(collectionState) || !OUTCOMES.has(input.outcome)) {
            throw new ContractError('RECEIPT_INVALID', { status: 400 });
        }
        if (collectionState === 'not_collected' && input.usage.observed_units !== null) {
            throw new ContractError('RECEIPT_INVALID', { status: 400 });
        }
        if (collectionState === 'partial'
            && (!Array.isArray(input.usage.unknown_fields) || input.usage.unknown_fields.length === 0)) {
            throw new ContractError('RECEIPT_INVALID', { status: 400 });
        }
        for (const field of ['tenant_id', 'tenant_revision_at_write', 'connection_id', 'connection_revision', 'contract_revision', 'deployment_id', 'correlation_id', 'actor_principal_id', 'capability_id', 'quota_decision', 'credential_mode', 'pricing_snapshot']) {
            if (input[field] === undefined || input[field] === null || input[field] === '') {
                throw new ContractError('RECEIPT_INVALID', { status: 400, details: { field } });
            }
        }
        const receiptId = input.receipt_id ?? generateCanonicalId('rcp');
        const receiptCandidate = {
            receipt_id: receiptId,
            protocol_version: input.protocol_version ?? '1.0',
            ...input,
            operation_ids: input.operation_ids ?? [input.operation_id],
            idempotency_keys: input.idempotency_keys ?? (input.idempotency_key ? [input.idempotency_key] : []),
            finalized_at: input.finalized_at ?? this.now().toISOString()
        };
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

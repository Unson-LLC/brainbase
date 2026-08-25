import { createHash } from 'node:crypto';
import { canonicalJson, deepFreeze } from './canonical-json.js';
import { validateCanonicalWire } from './canonical-wire-validator.js';
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
const PRICING_SNAPSHOT_FIELDS = Object.freeze([
    'rate_card_revision', 'fx_table_revision', 'sales_price_revision',
    'purchase_currency', 'purchase_minor_units', 'billing_currency',
    'billing_minor_units', 'fx_rate_decimal', 'effective_at'
]);
const CURRENCY = /^[A-Z]{3}$/;
const POSITIVE_DECIMAL = /^(?:0\.(?:0*[1-9][0-9]*)|[1-9][0-9]*(?:\.[0-9]+)?)$/;
const QUOTA_METRIC = /^[a-z][a-z0-9_.:-]{0,127}$/u;
const QUOTA_CALLER_AUTHORITY_FIELDS = new Set([
    'observed_quantity', 'quota_revision', 'unit',
    'window_started_at', 'window_ends_at'
]);

function fail(code, options = {}) {
    throw new ContractError(code, { status: 400, fault_domain: 'protocol', ...options });
}

function quotaUnavailable() {
    throw new ContractError('UPSTREAM_UNAVAILABLE', {
        status: 503,
        retryable: true,
        fault_domain: 'brainbase_cloud'
    });
}

export function validateQuotaRequest(input) {
    if (!input || typeof input !== 'object'
        || typeof input.metric !== 'string' || !QUOTA_METRIC.test(input.metric)
        || typeof input.requested_quantity !== 'number'
        || !Number.isFinite(input.requested_quantity) || input.requested_quantity <= 0) {
        throw new ContractError('QUOTA_INPUT_INVALID', { status: 400, fault_domain: 'protocol' });
    }
    return true;
}

export function resolveQuotaWindowPolicy(policy, now = new Date()) {
    let normalized = policy;
    if (typeof normalized === 'string') {
        try {
            normalized = JSON.parse(normalized);
        } catch {
            quotaUnavailable();
        }
    }
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
        quotaUnavailable();
    }
    if (normalized.kind === 'calendar_month') {
        if (normalized.timezone !== 'UTC') quotaUnavailable();
        const current = now instanceof Date ? new Date(now.getTime()) : new Date(now);
        if (!Number.isFinite(current.getTime())) quotaUnavailable();
        const startedAt = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
        const endsAt = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
        return {
            window_started_at: startedAt.toISOString(),
            window_ends_at: endsAt.toISOString()
        };
    }
    if (normalized.kind !== 'fixed'
        || typeof normalized.window_started_at !== 'string'
        || typeof normalized.window_ends_at !== 'string'
        || !normalized.window_started_at.endsWith('Z')
        || !normalized.window_ends_at.endsWith('Z')) {
        quotaUnavailable();
    }
    const startedAt = Date.parse(normalized.window_started_at);
    const endsAt = Date.parse(normalized.window_ends_at);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) {
        quotaUnavailable();
    }
    return {
        window_started_at: normalized.window_started_at,
        window_ends_at: normalized.window_ends_at
    };
}

export function calculateQuotaDecision({
    contract,
    tenant_id,
    contract_revision,
    metric,
    used_quantity,
    requested_quantity,
    quota_revision,
    unit = metric,
    window_started_at,
    window_ends_at,
    decided_at
}) {
    assertCanonicalRevision(contract_revision, 'contract_revision');
    validateQuotaRequest({ metric, requested_quantity });
    const allowance = Number(contract?.allowances?.[metric]);
    if (!Number.isFinite(allowance) || allowance <= 0) quotaUnavailable();
    if (typeof used_quantity !== 'number' || !Number.isFinite(used_quantity) || used_quantity < 0) {
        throw new ContractError('QUOTA_INPUT_INVALID', { status: 400, fault_domain: 'protocol' });
    }
    if (typeof window_started_at !== 'string' || typeof window_ends_at !== 'string'
        || !window_started_at.endsWith('Z') || !window_ends_at.endsWith('Z')
        || !Number.isFinite(Date.parse(window_started_at)) || !Number.isFinite(Date.parse(window_ends_at))
        || Date.parse(window_ends_at) <= Date.parse(window_started_at)) {
        quotaUnavailable();
    }
    const resulting = used_quantity + requested_quantity;
    if (!Number.isFinite(resulting)) {
        throw new ContractError('QUOTA_INPUT_INVALID', { status: 400, fault_domain: 'protocol' });
    }
    const thresholds = Array.isArray(contract.thresholds_basis_points)
        ? contract.thresholds_basis_points.map(Number)
        : [];
    const hardStop = Number(contract.hard_stop_basis_points);
    if (!Number.isFinite(hardStop) || thresholds.some((threshold) => !Number.isFinite(threshold))) {
        quotaUnavailable();
    }
    const basisPoints = Math.round((resulting / allowance) * 10000);
    let decision = 'allowed';
    if (basisPoints >= hardStop && contract.overage_policy === 'deny') decision = 'hard_stopped';
    else if (contract.overage_policy === 'allow_with_approval' && basisPoints >= hardStop) decision = 'approval_required';
    else if (thresholds.some((threshold) => basisPoints >= threshold)) decision = 'warning';
    const decisionRecord = {
        message_type: 'quota_decision',
        tenant_id,
        contract_revision,
        quota_revision: String(quota_revision ?? contract.quota_revision ?? contract_revision),
        limit: allowance,
        used: used_quantity,
        remaining: Math.max(0, allowance - resulting),
        unit,
        window_started_at,
        window_ends_at,
        decision,
        decided_at: decided_at ?? new Date().toISOString(),
        failure_code: null
    };
    validateQuotaDecision(decisionRecord);
    return deepFreeze(decisionRecord);
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
    validateCanonicalWire('UsageEvent', event);
    return true;
}

export function normalizeUsageEvent(input) {
    const event = structuredClone(input);
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
    validateCanonicalWire('QuotaDecision', decision);
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
    validateCanonicalWire('OperationReceipt', receipt);
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
    validateCanonicalWire('IdempotencyClaim', claim);
    return true;
}

export function validatePricingSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
        || Object.keys(snapshot).length !== PRICING_SNAPSHOT_FIELDS.length
        || PRICING_SNAPSHOT_FIELDS.some((field) => !Object.hasOwn(snapshot, field))) {
        fail('PRICING_SNAPSHOT_INVALID');
    }
    for (const field of ['rate_card_revision', 'fx_table_revision', 'sales_price_revision']) {
        assertCanonicalRevision(snapshot[field], `pricing_snapshot.${field}`);
    }
    for (const field of ['purchase_currency', 'billing_currency']) {
        if (typeof snapshot[field] !== 'string' || !CURRENCY.test(snapshot[field])) fail('PRICING_SNAPSHOT_INVALID');
    }
    for (const field of ['purchase_minor_units', 'billing_minor_units']) {
        if (snapshot[field] !== null && (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0)) {
            fail('PRICING_SNAPSHOT_INVALID');
        }
    }
    if (typeof snapshot.fx_rate_decimal !== 'string' || !POSITIVE_DECIMAL.test(snapshot.fx_rate_decimal)) {
        fail('PRICING_SNAPSHOT_INVALID');
    }
    if (typeof snapshot.effective_at !== 'string' || !snapshot.effective_at.endsWith('Z')
        || !Number.isFinite(Date.parse(snapshot.effective_at))) {
        fail('PRICING_SNAPSHOT_INVALID');
    }
    return true;
}

export class ContractUsageLedger {
    #contracts = new Map();
    #claims = new Map();
    #usageEvents = new Map();
    #receipts = new Map();
    #receiptHashes = new Map();
    #receiptPricing = new Map();

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
        if (Object.keys(input).some((field) => QUOTA_CALLER_AUTHORITY_FIELDS.has(field)
            || field.startsWith('window_'))) {
            throw new ContractError('QUOTA_INPUT_INVALID', { status: 400, fault_domain: 'protocol' });
        }
        if (input.used_quantity === undefined) {
            quotaUnavailable();
        }
        const used = input.used_quantity;
        const policyWindow = contract.quota_window_policy
            ? resolveQuotaWindowPolicy(contract.quota_window_policy, this.now())
            : {
                // Compatibility for the in-memory test ledger: these are explicit
                // contract-owned bounds, never a caller-supplied or inferred period.
                window_started_at: contract.window_started_at,
                window_ends_at: contract.window_ends_at
            };
        return calculateQuotaDecision({
            contract,
            tenant_id: input.tenant_id,
            contract_revision: input.contract_revision,
            metric: input.metric,
            used_quantity: used,
            requested_quantity: input.requested_quantity,
            quota_revision: contract.quota_revision ?? contract.contract_revision_number ?? input.contract_revision,
            unit: input.metric,
            window_started_at: policyWindow.window_started_at,
            window_ends_at: policyWindow.window_ends_at,
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

    finalizeReceiptWithPricing({ receipt: receiptInput, pricing_snapshot: pricingSnapshot }) {
        validatePricingSnapshot(pricingSnapshot);
        const receipt = this.finalizeReceipt(receiptInput);
        const key = `${receipt.tenant_id}:${receipt.receipt_id}`;
        const finalized = deepFreeze({
            receipt,
            pricing_snapshot: structuredClone(pricingSnapshot)
        });
        const existing = this.#receiptPricing.get(key);
        if (existing) {
            if (canonicalJson(existing) !== canonicalJson(finalized)) {
                throw new ContractError('IDEMPOTENCY_CONFLICT', { status: 409 });
            }
            return existing;
        }
        this.#receiptPricing.set(key, finalized);
        return finalized;
    }

    readReceiptHistory({ tenant_id: tenantId, receipt_id: receiptId }) {
        const record = this.#receiptPricing.get(`${tenantId}:${receiptId}`);
        return record ? deepFreeze([record]) : deepFreeze([]);
    }
}

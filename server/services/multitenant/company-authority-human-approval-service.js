// @ts-check

import { createHash, createPublicKey, randomUUID } from 'node:crypto';

import { AppError } from '../../lib/errors.js';
import {
    CONTRACT_ID,
    MAX_TTL_SECONDS,
    SCHEMA_VERSION,
    acceptCompanyAuthorityResponse,
    canonicalJson,
    createDetachedJws,
    validateObservedExecutionRequest,
    verifyDetachedJws
} from '../../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';

export const COMPANY_AUTHORITY_HUMAN_APPROVAL_SCHEMA_VERSION = '1.0';
export const COMPANY_AUTHORITY_HUMAN_APPROVAL_RECEIPT_TYPE = 'company_authority_human_approval';
export const COMPANY_AUTHORITY_HUMAN_APPROVAL_PROTECTED_TYP =
    'application/mana-brainbase-company-authority-human-approval+jws';

const MAX_RECEIPT_TTL_MS = MAX_TTL_SECONDS * 1000;

function clone(value) {
    return value == null ? value : structuredClone(value);
}

function canonicalDigest(value) {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function actorId(actor = {}) {
    return actor.person_id || actor.sub || null;
}

function asDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function timestamp(value, field) {
    const date = asDate(value);
    if (!date) throw approvalError('company_authority_human_approval_invalid', `${field} must be a valid timestamp`);
    return date;
}

function approvalError(code, message, details = {}, statusCode = 409) {
    const error = statusCode === 403
        ? AppError.forbidden(message, { code, ...details })
        : statusCode === 503
        ? new AppError(message, { code, statusCode })
        : AppError.conflict(message, { code, ...details });
    error.code = code;
    error.statusCode = statusCode;
    error.status = statusCode;
    return error;
}

function requireString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw approvalError('company_authority_human_approval_invalid', `${field} is required`, { field }, 422);
    }
    return value;
}

function sameValue(actual, expected, field) {
    if (actual !== expected) {
        throw approvalError('company_authority_human_approval_binding_mismatch', `${field} does not match the signed binding`, {
            field,
            expected,
            actual
        });
    }
}

function publicJwkFor(signingKey) {
    const publicKey = signingKey?.public_key
        || (signingKey?.private_key ? createPublicKey(signingKey.private_key) : null);
    if (!publicKey) return null;
    if (typeof publicKey.export === 'function') return publicKey.export({ format: 'jwk' });
    return publicKey;
}

function responseForContext(context) {
    return {
        schema_version: SCHEMA_VERSION,
        contract_id: CONTRACT_ID,
        correlation_id: context.tenant_context.correlation_id,
        context,
        error: null
    };
}

function contextRevisions(context) {
    return {
        tenant_revision: context.tenant_context.tenant.tenant_revision,
        connection_revision: context.tenant_context.workspace_connection.connection_revision,
        contract_revision: context.tenant_context.contract_revision,
        membership_revision: context.actor.membership_revision,
        policy_revision: context.authority.policy_revision,
        raci_revision: context.authority.raci_revision,
        resource_revision: context.authority.resource_revision
    };
}

function contextBinding(context, observedRequest, step, {
    executionHash = null,
    handoffIdempotencyKey = null,
    targetApproverId = null
} = {}) {
    const tenantContext = context.tenant_context;
    const authority = context.authority;
    const target = targetApproverId || step.requested_to || authority.approver_person_id || null;
    requireString(step.id, 'human step id');
    requireString(step.requested_by, 'human step requested_by');
    requireString(step.requested_to, 'human step requested_to');
    requireString(target, 'target approver');
    if (authority.approver_person_id !== null && authority.approver_person_id !== undefined) {
        sameValue(authority.approver_person_id, target, 'target approver');
    }
    sameValue(target, step.requested_to, 'target approver');

    const binding = {
        schema_version: COMPANY_AUTHORITY_HUMAN_APPROVAL_SCHEMA_VERSION,
        human_step_id: step.id,
        workflow_run_id: requireString(step.workflow_run_id, 'workflow_run_id'),
        workflow_id: requireString(step.workflow_id, 'workflow_id'),
        workspace_id: step.workspace_id || null,
        requested_by: step.requested_by,
        target_approver_id: target,
        tenant_id: requireString(tenantContext.tenant.tenant_id, 'tenant_id'),
        handoff_idempotency_key: requireString(
            handoffIdempotencyKey || tenantContext.idempotency_key,
            'handoff_idempotency_key'
        ),
        project_id: requireString(context.scope.project_id, 'project_id'),
        resource_ref: requireString(context.scope.resource_ref, 'resource_ref'),
        capability_id: requireString(authority.capability_id, 'capability_id'),
        desired_effect: requireString(observedRequest.requested_action.desired_effect, 'desired_effect'),
        correlation_id: requireString(tenantContext.correlation_id, 'correlation_id'),
        operation_id: requireString(tenantContext.operation_id, 'operation_id'),
        execution_hash: executionHash || canonicalDigest(observedRequest),
        original_authority_receipt_id: requireString(
            context.evidence.authority_resolution_receipt_id,
            'original_authority_receipt_id'
        ),
        revisions: contextRevisions(context)
    };
    sameValue(binding.execution_hash, canonicalDigest(observedRequest), 'execution_hash');
    return binding;
}

function bindingDigest(marker) {
    return canonicalDigest({
        binding: marker.binding,
        observed_request: marker.observed_request,
        authority_context: marker.authority_context
    });
}

function receiptDigestPayload(receipt) {
    const { digest: _digest, integrity: _integrity, ...payload } = receipt;
    return payload;
}

function isCompanyAuthorityHumanApprovalMarker(value) {
    // The explicit marker opts the step into the Company Authority path. A
    // malformed marker must fail closed instead of falling back to generic
    // approval handling.
    return Boolean(value && typeof value === 'object');
}

/**
 * Durable, signed approval exchange for an existing workflow human step.
 *
 * The marker is intentionally explicit and Company Authority-specific. A
 * regular workflow human step never enters this service and keeps the legacy
 * resolve path unchanged.
 */
export class CompanyAuthorityHumanApprovalService {
    constructor({
        repository,
        companyAuthorityContextProducer,
        signingKey = companyAuthorityContextProducer?.signingKey,
        audience = companyAuthorityContextProducer?.audience || 'mana-runtime',
        deploymentId = companyAuthorityContextProducer?.deploymentId,
        now = companyAuthorityContextProducer?.now || (() => new Date()),
        maxReceiptTtlMs = MAX_RECEIPT_TTL_MS
    } = {}) {
        if (!repository?.createCompanyAuthorityApprovalReceipt
            || !repository?.getCompanyAuthorityApprovalReceipt
            || !repository?.consumeCompanyAuthorityApprovalReceipt
            || !repository?.listCompanyAuthorityApprovalReceipts) {
            throw new Error('CompanyAuthorityHumanApprovalService requires approval receipt repository methods');
        }
        if (!companyAuthorityContextProducer?.resolve) {
            throw new Error('CompanyAuthorityHumanApprovalService requires CompanyAuthorityContextProducer');
        }
        if (!signingKey?.key_id || !signingKey.private_key) {
            throw new Error('CompanyAuthorityHumanApprovalService requires a signing key');
        }
        this.repository = repository;
        this.companyAuthorityContextProducer = companyAuthorityContextProducer;
        this.signingKey = signingKey;
        this.audience = audience;
        this.deploymentId = deploymentId;
        this.now = now;
        this.publicJwk = publicJwkFor(signingKey);
        this.maxReceiptTtlMs = Math.min(Number(maxReceiptTtlMs) || MAX_RECEIPT_TTL_MS, MAX_RECEIPT_TTL_MS);
    }

    isBound(step) {
        return isCompanyAuthorityHumanApprovalMarker(step?.metadata?.company_authority_human_approval);
    }

    /**
     * Create the immutable binding marker which must be stored with the human
     * step before the resolve endpoint can approve it.
     */
    createBinding(step, {
        observedRequest,
        authorityResponse,
        authorityContext = authorityResponse?.context || authorityResponse,
        executionHash = null,
        handoffIdempotencyKey = null,
        targetApproverId = null
    } = {}) {
        if (!authorityContext || authorityContext === authorityResponse?.error) {
            throw approvalError('company_authority_human_approval_invalid', 'signed Company Authority context is required', {}, 422);
        }
        try {
            validateObservedExecutionRequest(observedRequest);
        } catch (error) {
            throw approvalError('company_authority_human_approval_invalid', 'observed execution request is invalid', {
                cause: error?.code || error?.message
            }, 422);
        }
        if (authorityResponse?.context === null || authorityResponse?.error) {
            throw approvalError('company_authority_human_approval_invalid', 'a failed Company Authority response cannot be approved', {
                cause: authorityResponse.error?.code || 'authority_error'
            });
        }
        try {
            acceptCompanyAuthorityResponse(responseForContext(authorityContext), {
                expectedAudience: this.audience,
                expectedDeploymentId: this.deploymentId,
                now: asDate(this.now()),
                publicJwk: this.publicJwk,
                request: observedRequest
            });
        } catch (error) {
            throw approvalError('company_authority_human_approval_invalid', 'original Company Authority context is not accepted', {
                cause: error?.code || error?.message
            }, 422);
        }
        const binding = contextBinding(authorityContext, observedRequest, step, {
            executionHash,
            handoffIdempotencyKey,
            targetApproverId
        });
        const marker = {
            schema_version: COMPANY_AUTHORITY_HUMAN_APPROVAL_SCHEMA_VERSION,
            binding,
            observed_request: clone(observedRequest),
            authority_context: clone(authorityContext),
            binding_digest: bindingDigest({
                binding,
                observed_request: observedRequest,
                authority_context: authorityContext
            }),
            integrity: {
                method: 'jws_detached',
                algorithm: 'EdDSA',
                key_id: this.signingKey.key_id,
                value: ''
            }
        };
        const privateJwk = this.signingKey.private_key.export({ format: 'jwk' });
        marker.integrity.value = createDetachedJws(
            marker,
            privateJwk,
            this.signingKey.key_id,
            { typ: COMPANY_AUTHORITY_HUMAN_APPROVAL_PROTECTED_TYP }
        );
        return marker;
    }

    async attachBinding(stepId, options = {}) {
        const step = this.repository.getHumanStep(stepId);
        if (!step) throw AppError.notFound('workflow_human_step', stepId);
        const marker = this.createBinding(step, options);
        return this._transaction(() => this.repository.updateHumanStep(stepId, {
            metadata: {
                ...(step.metadata || {}),
                company_authority_human_approval: marker
            }
        }));
    }

    async resolve({ step, input = {}, actor = {} } = {}) {
        const marker = this._verifyBinding(step);
        const resolvedBy = actorId(actor);
        if (!resolvedBy || resolvedBy !== step.requested_to || resolvedBy !== marker.binding.target_approver_id) {
            throw approvalError('company_authority_human_approval_approver_mismatch',
                'human approval actor is not the canonical requested approver', {}, 403);
        }
        this._assertInputBinding(input, marker);
        const now = asDate(this.now());

        const existingRecords = this.repository.listCompanyAuthorityApprovalReceipts({ humanStepId: step.id });
        const existing = existingRecords.find((record) => record.binding_digest === marker.binding_digest) || null;
        if (existing?.consumed_at) {
            throw approvalError('company_authority_human_approval_replay', 'human approval receipt was already consumed');
        }
        const freshResponse = await this.companyAuthorityContextProducer.resolve(clone(marker.observed_request));
        if (!freshResponse || freshResponse.error || !freshResponse.context) {
            throw approvalError('company_authority_human_approval_fresh_resolve_failed',
                'fresh Company Authority context was not resolved', {
                    cause: freshResponse?.error?.code || 'missing_context'
                });
        }
        this._acceptFreshResponse(freshResponse, marker);
        const record = existing || await this._createReceipt(
            marker,
            step,
            resolvedBy,
            now,
            freshResponse.context
        );
        this._verifyReceiptRecord(record, marker, step, now);
        const consumed = await this._transaction(() => this.repository.consumeCompanyAuthorityApprovalReceipt(record.id, {
            consumed_at: now.toISOString(),
            consumed_by: resolvedBy,
            expected: {
                tenant_id: marker.binding.tenant_id,
                project_id: marker.binding.project_id,
                resource_ref: marker.binding.resource_ref,
                human_step_id: marker.binding.human_step_id,
                binding_digest: marker.binding_digest
            }
        }));
        if (!consumed) {
            throw approvalError('company_authority_human_approval_replay', 'human approval receipt was already consumed');
        }
        return {
            receipt: clone(consumed.receipt),
            consumed_at: consumed.consumed_at,
            consumed_by: consumed.consumed_by,
            fresh_context: clone(freshResponse.context)
        };
    }

    _verifyBinding(step) {
        const marker = step?.metadata?.company_authority_human_approval;
        if (!isCompanyAuthorityHumanApprovalMarker(marker)) {
            throw approvalError('company_authority_human_approval_unavailable',
                'Company Authority human approval binding is missing; approval is fail-closed', {}, 503);
        }
        if (!marker.binding
            || typeof marker.binding !== 'object'
            || Array.isArray(marker.binding)
            || !marker.observed_request
            || typeof marker.observed_request !== 'object'
            || Array.isArray(marker.observed_request)
            || !marker.authority_context
            || typeof marker.authority_context !== 'object'
            || Array.isArray(marker.authority_context)) {
            throw approvalError('company_authority_human_approval_tampered',
                'human approval binding shape is invalid');
        }
        if (marker.schema_version !== COMPANY_AUTHORITY_HUMAN_APPROVAL_SCHEMA_VERSION) {
            throw approvalError('company_authority_human_approval_tampered', 'human approval binding schema is invalid');
        }
        if (marker.binding_digest !== bindingDigest(marker)) {
            throw approvalError('company_authority_human_approval_tampered', 'human approval binding digest does not match');
        }
        try {
            verifyDetachedJws(marker, this.publicJwk, {
                expectedTyp: COMPANY_AUTHORITY_HUMAN_APPROVAL_PROTECTED_TYP,
                expectedKeyId: this.signingKey.key_id
            });
        } catch (error) {
            throw approvalError('company_authority_human_approval_tampered', 'human approval binding signature is invalid', {
                cause: error?.code || error?.message
            });
        }
        sameValue(marker.binding.human_step_id, step.id, 'human_step_id');
        sameValue(marker.binding.workflow_run_id, step.workflow_run_id, 'workflow_run_id');
        sameValue(marker.binding.workflow_id, step.workflow_id, 'workflow_id');
        sameValue(marker.binding.project_id, step.project_id, 'project_id');
        sameValue(marker.binding.requested_by, step.requested_by, 'requested_by');
        sameValue(marker.binding.target_approver_id, step.requested_to, 'target_approver_id');
        try {
            validateObservedExecutionRequest(marker.observed_request);
        } catch (error) {
            throw approvalError('company_authority_human_approval_tampered', 'observed execution request is invalid', {
                cause: error?.code || error?.message
            });
        }
        try {
            // Verify the original context against the request and signer at
            // its issuance time. Expiry is checked separately at resolve so a
            // stale but authentic marker receives the stale error.
            acceptCompanyAuthorityResponse(responseForContext(marker.authority_context), {
                expectedAudience: this.audience,
                expectedDeploymentId: this.deploymentId,
                now: timestamp(marker.authority_context.issued_at, 'authority_context.issued_at'),
                publicJwk: this.publicJwk,
                request: marker.observed_request
            });
        } catch (error) {
            throw approvalError('company_authority_human_approval_tampered',
                'original Company Authority context is invalid or does not match the observed request', {
                    cause: error?.code || error?.message
                });
        }
        const expectedBinding = contextBinding(
            marker.authority_context,
            marker.observed_request,
            step,
            {
                executionHash: marker.binding.execution_hash,
                handoffIdempotencyKey: marker.binding.handoff_idempotency_key,
                targetApproverId: marker.binding.target_approver_id
            }
        );
        sameValue(canonicalDigest(marker.binding), canonicalDigest(expectedBinding), 'binding');
        return marker;
    }

    _assertInputBinding(input, marker) {
        const binding = marker.binding;
        const claims = {
            tenant_id: input.tenant_id,
            project_id: input.project_id,
            resource_ref: input.resource_ref,
            capability_id: input.capability_id,
            desired_effect: input.desired_effect,
            correlation_id: input.correlation_id,
            operation_id: input.operation_id,
            handoff_idempotency_key: input.handoff_idempotency_key || input.idempotency_key,
            target_approver_id: input.target_approver_id
        };
        for (const [field, value] of Object.entries(claims)) {
            if (value !== undefined && value !== null) sameValue(value, binding[field], field);
        }
        if (input.company_authority_human_approval) {
            sameValue(
                canonicalDigest(input.company_authority_human_approval),
                canonicalDigest(marker),
                'company_authority_human_approval'
            );
        }
    }

    async _createReceipt(marker, step, resolvedBy, now, freshContext) {
        const issuedAt = now.toISOString();
        const sourceExpiresAt = timestamp(freshContext?.expires_at, 'fresh_context.expires_at');
        const expiresAt = new Date(Math.min(
            sourceExpiresAt.getTime(),
            now.getTime() + this.maxReceiptTtlMs
        ));
        if (expiresAt.getTime() <= now.getTime()) {
            throw approvalError('company_authority_human_approval_stale', 'approval receipt TTL is already expired');
        }
        const receiptId = `cahapr_${randomUUID()}`;
        const unsigned = {
            schema_version: COMPANY_AUTHORITY_HUMAN_APPROVAL_SCHEMA_VERSION,
            receipt_type: COMPANY_AUTHORITY_HUMAN_APPROVAL_RECEIPT_TYPE,
            receipt_id: receiptId,
            human_step_id: step.id,
            workflow_run_id: step.workflow_run_id,
            workflow_id: step.workflow_id,
            requested_by: marker.binding.requested_by,
            resolved_by: resolvedBy,
            resolved_at: issuedAt,
            tenant_id: marker.binding.tenant_id,
            handoff_idempotency_key: marker.binding.handoff_idempotency_key,
            project_id: marker.binding.project_id,
            resource_ref: marker.binding.resource_ref,
            capability_id: marker.binding.capability_id,
            desired_effect: marker.binding.desired_effect,
            correlation_id: marker.binding.correlation_id,
            operation_id: marker.binding.operation_id,
            execution_hash: marker.binding.execution_hash,
            original_authority_receipt_id: marker.binding.original_authority_receipt_id,
            target_approver_id: marker.binding.target_approver_id,
            revisions: clone(marker.binding.revisions),
            audience: this.audience,
            key_id: this.signingKey.key_id,
            issued_at: issuedAt,
            expires_at: expiresAt.toISOString()
        };
        const digest = canonicalDigest(unsigned);
        const signable = { ...unsigned, digest };
        const privateJwk = this.signingKey.private_key.export({ format: 'jwk' });
        const receipt = {
            ...signable,
            integrity: {
                method: 'jws_detached',
                algorithm: 'EdDSA',
                key_id: this.signingKey.key_id,
                value: createDetachedJws(
                    signable,
                    privateJwk,
                    this.signingKey.key_id,
                    { typ: COMPANY_AUTHORITY_HUMAN_APPROVAL_PROTECTED_TYP }
                )
            }
        };
        const persisted = await this._transaction(() => {
            // Serialize the binding lookup with creation so concurrent
            // resolves share one durable receipt rather than minting two
            // independently consumable approvals.
            const existing = this.repository.listCompanyAuthorityApprovalReceipts({ humanStepId: step.id })
                .find((candidate) => candidate.binding_digest === marker.binding_digest);
            if (existing) return existing;
            return this.repository.createCompanyAuthorityApprovalReceipt({
                id: receiptId,
                receipt,
                digest,
                binding_digest: marker.binding_digest,
                tenant_id: marker.binding.tenant_id,
                project_id: marker.binding.project_id,
                resource_ref: marker.binding.resource_ref,
                human_step_id: step.id,
                requested_by: marker.binding.requested_by,
                target_approver_id: marker.binding.target_approver_id
            });
        });
        return persisted;
    }

    _verifyReceiptRecord(record, marker, step, now) {
        if (!record?.receipt || record.id !== record.receipt.receipt_id) {
            throw approvalError('company_authority_human_approval_tampered', 'approval receipt record is invalid');
        }
        if (record.binding_digest !== marker.binding_digest || record.human_step_id !== step.id) {
            throw approvalError('company_authority_human_approval_replay', 'approval receipt is bound to another human step');
        }
        if (record.receipt.digest !== canonicalDigest(receiptDigestPayload(record.receipt))) {
            throw approvalError('company_authority_human_approval_tampered', 'approval receipt digest does not match');
        }
        try {
            verifyDetachedJws(record.receipt, this.publicJwk, {
                expectedTyp: COMPANY_AUTHORITY_HUMAN_APPROVAL_PROTECTED_TYP,
                expectedKeyId: this.signingKey.key_id
            });
        } catch (error) {
            throw approvalError('company_authority_human_approval_tampered', 'approval receipt signature is invalid', {
                cause: error?.code || error?.message
            });
        }
        for (const field of [
            'requested_by', 'target_approver_id', 'handoff_idempotency_key', 'capability_id',
            'desired_effect', 'correlation_id', 'operation_id', 'execution_hash',
            'original_authority_receipt_id'
        ]) {
            sameValue(record.receipt[field], marker.binding[field], field);
        }
        sameValue(record.receipt.resolved_by, marker.binding.target_approver_id, 'resolved_by');
        sameValue(record.receipt.audience, this.audience, 'audience');
        sameValue(record.receipt.key_id, this.signingKey.key_id, 'key_id');
        sameValue(record.receipt.receipt_type, COMPANY_AUTHORITY_HUMAN_APPROVAL_RECEIPT_TYPE, 'receipt_type');
        sameValue(canonicalDigest(record.receipt.revisions), canonicalDigest(marker.binding.revisions), 'revisions');
        const issuedAt = timestamp(record.receipt.issued_at, 'receipt.issued_at');
        const expiresAt = timestamp(record.receipt.expires_at, 'receipt.expires_at');
        if (expiresAt.getTime() <= issuedAt.getTime()
            || expiresAt.getTime() - issuedAt.getTime() > this.maxReceiptTtlMs) {
            throw approvalError('company_authority_human_approval_tampered', 'approval receipt TTL is invalid');
        }
        if (expiresAt.getTime() <= now.getTime()) {
            throw approvalError('company_authority_human_approval_stale', 'approval receipt has expired');
        }
        for (const field of ['tenant_id', 'project_id', 'resource_ref', 'target_approver_id']) {
            sameValue(record.receipt[field], marker.binding[field], field);
        }
    }

    _acceptFreshResponse(response, marker) {
        try {
            acceptCompanyAuthorityResponse(response, {
                expectedAudience: this.audience,
                expectedDeploymentId: this.deploymentId,
                now: asDate(this.now()),
                publicJwk: this.publicJwk,
                request: marker.observed_request
            });
        } catch (error) {
            throw approvalError('company_authority_human_approval_fresh_resolve_failed',
                'fresh Company Authority context is invalid or stale', {
                    cause: error?.code || error?.message
                });
        }
        const context = response.context;
        const tenantContext = context.tenant_context;
        const fresh = {
            tenant_id: tenantContext.tenant.tenant_id,
            handoff_idempotency_key: tenantContext.idempotency_key,
            project_id: context.scope.project_id,
            resource_ref: context.scope.resource_ref,
            capability_id: context.authority.capability_id,
            desired_effect: marker.observed_request.requested_action.desired_effect,
            correlation_id: tenantContext.correlation_id,
            operation_id: tenantContext.operation_id,
            original_authority_receipt_id: context.evidence.authority_resolution_receipt_id,
            target_approver_id: context.authority.approver_person_id || marker.binding.target_approver_id,
            revisions: contextRevisions(context)
        };
        for (const field of [
            'tenant_id', 'handoff_idempotency_key', 'project_id', 'resource_ref', 'capability_id',
            'desired_effect', 'correlation_id', 'operation_id', 'original_authority_receipt_id', 'target_approver_id'
        ]) {
            sameValue(fresh[field], marker.binding[field], field);
        }
        for (const [field, expected] of Object.entries(marker.binding.revisions)) {
            sameValue(fresh.revisions[field], expected, `revisions.${field}`);
        }
        const issuedAt = timestamp(context.issued_at, 'fresh_context.issued_at');
        const expiresAt = timestamp(context.expires_at, 'fresh_context.expires_at');
        if (expiresAt.getTime() <= asDate(this.now()).getTime()) {
            throw approvalError('company_authority_human_approval_fresh_resolve_failed', 'fresh Company Authority context has expired');
        }
        if (expiresAt.getTime() <= issuedAt.getTime()) {
            throw approvalError('company_authority_human_approval_fresh_resolve_failed', 'fresh Company Authority context expiry precedes issuance');
        }
        if (expiresAt.getTime() - issuedAt.getTime() > MAX_RECEIPT_TTL_MS) {
            throw approvalError('company_authority_human_approval_fresh_resolve_failed', 'fresh Company Authority context TTL is invalid');
        }
    }

    async _transaction(callback) {
        if (typeof this.repository.transaction === 'function') return this.repository.transaction(callback);
        return callback();
    }
}

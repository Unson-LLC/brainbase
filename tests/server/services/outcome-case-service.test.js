import { describe, expect, it, vi } from 'vitest';

import { deriveClosureStatus, OutcomeCaseError, OutcomeCaseService } from '../../../server/services/outcome-case/outcome-case-service.js';

class MemoryOutcomeCaseRepository {
    constructor() {
        this.items = new Map();
    }

    async create(outcomeCase) {
        this.items.set(outcomeCase.case_id, structuredClone(outcomeCase));
        return structuredClone(outcomeCase);
    }

    async findByCaseId(caseId) {
        const item = this.items.get(caseId);
        return item ? structuredClone(item) : null;
    }

    async update(outcomeCase) {
        this.items.set(outcomeCase.case_id, structuredClone(outcomeCase));
        return structuredClone(outcomeCase);
    }
}

function createInput(overrides = {}) {
    return {
        project_code: 'brainbase',
        capability_id: 'cap_outcome_control',
        user_observable_outcome: '依頼者が外部の完了読戻しを確認できる',
        protected_constraints: ['外部読戻しなしで閉鎖しない'],
        non_goals: ['汎用 workflow engine'],
        selected_domain_pack: 'delivery-control/v1',
        current_external_state: 'processing',
        technical_story_refs: ['story-outcome-case-v1'],
        run_receipt_refs: [],
        prior_attempt_refs: [],
        unresolved_failure_boundary: null,
        ...overrides
    };
}

function authenticatedActor(overrides = {}) {
    return { person_id: 'per_owner', projectCodes: ['brainbase'], organizationId: 'org_unson', ...overrides };
}

function createService({ receiptStates = {}, receiptSnapshots = {}, referenceStates = { project: 'confirmed', capability: 'confirmed' }, resolveClosureAuthority } = {}) {
    const repository = new MemoryOutcomeCaseRepository();
    const readRunReceipt = vi.fn(async ({ runReceiptRef }) => {
        if (receiptSnapshots[runReceiptRef]) return structuredClone(receiptSnapshots[runReceiptRef]);
        const evidenceState = receiptStates[runReceiptRef];
        return evidenceState ? {
            source_status: 'success',
            evidence_state: evidenceState,
            action_required: 'none',
            issue_codes: [],
            recommended_action: null,
            diagnostics: { state: 'healthy', issue_codes: [], recommended_action: null }
        } : null;
    });
    return {
        repository,
        readRunReceipt,
        resolveOutcomeReferences: vi.fn(async ({ projectCode, capabilityId }) => ({
            project: referenceStates.project === 'confirmed'
                ? { ref: projectCode, state: 'confirmed' }
                : { ref: projectCode, state: 'unresolved', reason: 'project_not_found' },
            capability: referenceStates.capability === 'confirmed'
                ? { ref: capabilityId, state: 'confirmed' }
                : { ref: capabilityId, state: 'unresolved', reason: 'capability_not_found' }
        })),
        service: new OutcomeCaseService({
            repository,
            readRunReceipt,
            resolveOutcomeReferences: async ({ projectCode, capabilityId }) => ({
                project: referenceStates.project === 'confirmed'
                    ? { ref: projectCode, state: 'confirmed' }
                    : { ref: projectCode, state: 'unresolved', reason: 'project_not_found' },
                capability: referenceStates.capability === 'confirmed'
                    ? { ref: capabilityId, state: 'confirmed' }
                    : { ref: capabilityId, state: 'unresolved', reason: 'capability_not_found' }
            }),
            resolveClosureAuthority: resolveClosureAuthority || (async ({ projectCode }) => ({
                state: 'confirmed', closure_authorized_person_ids: ['per_owner'],
                provenance: { source: 'test_raci', project_code: projectCode }
            })),
            now: () => new Date('2026-09-04T00:00:00.000Z')
        })
    };
}

describe('OutcomeCaseService', () => {
    it('creates the required control-plane record with an explicit external state', async () => {
        const { service } = createService();

        const outcomeCase = await service.create(createInput(), authenticatedActor());

        expect(outcomeCase).toMatchObject({
            project_code: 'brainbase',
            capability_id: 'cap_outcome_control',
            closure_status: 'open',
            current_external_state: 'processing',
            revision: 1,
            terminal_evaluation: null,
            evaluation_history: [],
            reference_resolution: {
                project: { ref: 'brainbase', state: 'confirmed', reason: null },
                capability: { ref: 'cap_outcome_control', state: 'confirmed', reason: null }
            }
        });
        expect(outcomeCase.case_id).toMatch(/^oc_/);
        expect(outcomeCase.created_at).toBe('2026-09-04T00:00:00.000Z');
        expect(outcomeCase.updated_at).toBe('2026-09-04T00:00:00.000Z');
        expect(outcomeCase.authority).toMatchObject({
            state: 'confirmed',
            closure_authorized_person_ids: ['per_owner'],
            provenance: { source: 'test_raci' }
        });
    });

    it('closes only with four-way confirmed evidence', async () => {
        const { service, readRunReceipt } = createService({ receiptStates: { 'run-1': 'confirmed' } });
        const outcomeCase = await service.create(createInput(), authenticatedActor());

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z',
            current_external_state: 'verified-complete'
        }, authenticatedActor());

        expect(readRunReceipt).toHaveBeenCalledWith(expect.objectContaining({
            projectCode: 'brainbase',
            runReceiptRef: 'run-1'
        }));
        expect(evaluated.closure_status).toBe('closed');
        expect(evaluated.revision).toBe(2);
        expect(evaluated.terminal_evaluation.run_receipts).toEqual([
            {
                ref: 'run-1', source_status: 'success', evidence_state: 'confirmed',
                action_required: 'none', issue_codes: [], recommended_action: null,
                diagnostics: { state: 'healthy', issue_codes: [], recommended_action: null }
            }
        ]);
    });

    it.each(['unconfirmed', 'no_data'])('keeps %s technical evidence out of service closure', async (technicalEvidenceStatus) => {
        const { service, readRunReceipt } = createService({ receiptStates: { 'run-1': 'confirmed' } });
        const outcomeCase = await service.create(createInput(), authenticatedActor());

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: technicalEvidenceStatus, refs: [] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied',
            evaluator: 'untrusted-request-text',
            observed_at: '2026-09-04T00:01:00.000Z',
            current_external_state: 'verified-complete'
        }, authenticatedActor());

        expect(readRunReceipt).toHaveBeenCalledWith(expect.objectContaining({
            projectCode: 'brainbase',
            runReceiptRef: 'run-1'
        }));
        expect(evaluated).toMatchObject({
            closure_status: 'incomplete',
            current_external_state: 'verified-complete',
            reference_resolution: {
                project: { ref: 'brainbase', state: 'confirmed', reason: null },
                capability: { ref: 'cap_outcome_control', state: 'confirmed', reason: null }
            },
            authority: {
                state: 'confirmed',
                closure_authorized_person_ids: ['per_owner'],
                provenance: { source: 'test_raci', project_code: 'brainbase' }
            },
            terminal_evaluation: {
                technical_evidence: { status: technicalEvidenceStatus, refs: [] },
                run_receipts: [{ ref: 'run-1', evidence_state: 'confirmed' }],
                external_readback: { status: 'confirm', ref: 'external:receipt-1' },
                constraints_status: 'satisfied',
                evaluated_by: 'per_owner',
                close_eligible: false
            }
        });
    });

    it.each([
        ['confirmed', true],
        ['unconfirmed', false],
        ['no_data', false]
    ])('derives closure only when technical evidence is confirmed (%s)', (technicalEvidenceStatus, closeEligible) => {
        expect(deriveClosureStatus({
            technicalEvidence: { status: technicalEvidenceStatus, refs: ['test:outcome-case'] },
            runReceipts: [{
                ref: 'run-1', source_status: 'success', evidence_state: 'confirmed',
                action_required: 'none', issue_codes: [], recommended_action: null,
                diagnostics: { state: 'healthy', issue_codes: [], recommended_action: null }
            }],
            externalReadback: { status: 'confirm', ref: 'external:receipt-1' },
            constraintsStatus: 'satisfied',
            referenceResolution: {
                project: { ref: 'brainbase', state: 'confirmed' },
                capability: { ref: 'cap_outcome_control', state: 'confirmed' }
            },
            authority: {
                state: 'confirmed',
                closure_authorized_person_ids: ['per_owner']
            }
        })).toEqual(closeEligible
            ? { closure_status: 'closed', close_eligible: true }
            : { closure_status: 'incomplete', close_eligible: false });
    });

    it.each([
        ['waiting_human', 'waiting_human'],
        ['failed', 'incomplete'],
        ['blocked', 'incomplete'],
        ['cancelled', 'incomplete']
    ])('does not close confirmed receipt when source status is %s', (sourceStatus, closureStatus) => {
        const issueCodes = sourceStatus === 'waiting_human'
            ? ['human_action_required']
            : sourceStatus === 'cancelled' ? [] : [`source_${sourceStatus}`];
        expect(deriveClosureStatus({
            technicalEvidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            runReceipts: [{
                ref: 'run-1', source_status: sourceStatus, evidence_state: 'confirmed',
                action_required: sourceStatus === 'waiting_human' ? 'approve' : 'none',
                issue_codes: issueCodes,
                recommended_action: sourceStatus === 'waiting_human' ? 'approve' : null,
                diagnostics: {
                    state: issueCodes.length ? 'action_required' : 'healthy',
                    issue_codes: issueCodes,
                    recommended_action: sourceStatus === 'waiting_human' ? 'approve' : null
                }
            }],
            externalReadback: { status: 'confirm', ref: 'external:receipt-1' },
            constraintsStatus: 'satisfied',
            referenceResolution: {
                project: { ref: 'brainbase', state: 'confirmed' },
                capability: { ref: 'cap_outcome_control', state: 'confirmed' }
            },
            authority: { state: 'confirmed', closure_authorized_person_ids: ['per_owner'] }
        })).toEqual({ closure_status: closureStatus, close_eligible: false });
    });

    it('persists the complete RunReceipt diagnosis snapshot and fails closed on action-required success', async () => {
        const diagnostic = {
            source_status: 'success', evidence_state: 'confirmed', action_required: 'review',
            issue_codes: ['manual_review_required'], recommended_action: 'review',
            diagnostics: {
                state: 'action_required', issue_codes: ['manual_review_required'], recommended_action: 'review'
            }
        };
        const { service } = createService({ receiptSnapshots: { 'run-review': diagnostic } });
        const outcomeCase = await service.create(createInput(), authenticatedActor());

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-review'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied', evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z'
        }, authenticatedActor());

        expect(evaluated).toMatchObject({
            closure_status: 'waiting_human',
            terminal_evaluation: { close_eligible: false, run_receipts: [{ ref: 'run-review', ...diagnostic }] },
            evaluation_history: [{ run_receipts: [{ ref: 'run-review', ...diagnostic }] }]
        });
        expect(await service.read(outcomeCase.case_id, authenticatedActor())).toEqual(evaluated);
    });

    it('does not close from technical evidence when receipt readback is unconfirmed', async () => {
        const { service } = createService({ receiptStates: { 'run-1': 'unconfirmed' } });
        const outcomeCase = await service.create(createInput(), authenticatedActor());

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: {
                status: 'confirmed',
                refs: ['test:passed', 'http:200', 'deploy:ready', 'storage:saved']
            },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z'
        }, authenticatedActor());

        expect(evaluated.closure_status).toBe('incomplete');
        expect(evaluated.terminal_evaluation.close_eligible).toBe(false);
    });

    it('keeps no_data and unknown constraints out of closure and requires a real evidence ref for confirm', async () => {
        const { service } = createService();
        const outcomeCase = await service.create(createInput({ current_external_state: 'unknown' }), authenticatedActor());

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['missing-run'],
            external_readback: { status: 'no_data' },
            constraints_status: 'unknown',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z'
        }, authenticatedActor());

        expect(evaluated.closure_status).toBe('waiting_human');
        expect(evaluated.terminal_evaluation.run_receipts).toEqual([
            {
                ref: 'missing-run', source_status: null, evidence_state: 'no_data',
                action_required: null, issue_codes: [], recommended_action: null, diagnostics: null
            }
        ]);

        await expect(service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['missing-run'],
            external_readback: { status: 'confirm' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:02:00.000Z'
        }, authenticatedActor())).rejects.toMatchObject({
            code: 'validation_failed'
        });
    });

    it('rejects direct closure status injection', async () => {
        const { service } = createService();

        await expect(service.create(createInput({ closure_status: 'closed' }), authenticatedActor())).rejects.toBeInstanceOf(OutcomeCaseError);
    });

    it('denies an actor without an authenticated organization before any repository read or write', async () => {
        const { service, repository } = createService();

        await expect(service.create(createInput(), { person_id: 'per_owner', projectCodes: ['brainbase'] }))
            .rejects.toMatchObject({
                code: 'outcome_case_organization_access_denied',
                status: 403,
                details: { audit_event: 'outcome_case_unknown_tenant_denied' }
            });
        expect(repository.items).toHaveLength(0);
    });

    it('rejects conflicting organization claims before create, read, or evaluate can reach the repository', async () => {
        const { service, repository } = createService();
        const conflictingActor = authenticatedActor({ tenantId: 'org_other' });

        for (const attempt of [
            () => service.create(createInput(), conflictingActor),
            () => service.read('oc_not_visible', conflictingActor),
            () => service.evaluate('oc_not_visible', { evaluator: 'per_owner' }, conflictingActor)
        ]) {
            await expect(attempt()).rejects.toMatchObject({
                code: 'outcome_case_organization_access_denied',
                status: 403,
                details: { audit_event: 'outcome_case_ambiguous_tenant_denied' }
            });
        }
        expect(repository.items).toHaveLength(0);
    });

    it('retains every previously stored receipt ref, appends the evaluation history, and diagnoses all retained refs before close', async () => {
        const { service, readRunReceipt } = createService({
            receiptStates: { 'run-1': 'confirmed', 'run-2': 'confirmed' }
        });
        const outcomeCase = await service.create(createInput(), authenticatedActor());

        await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:first-evaluation'] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'no_data' },
            constraints_status: 'unknown',
            evaluator: 'first-claim',
            observed_at: '2026-09-04T00:01:00.000Z'
        }, authenticatedActor());

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-2'],
            external_readback: { status: 'confirm', ref: 'external:receipt-2' },
            constraints_status: 'satisfied',
            evaluator: 'untrusted-request-text',
            observed_at: '2026-09-04T00:02:00.000Z'
        }, authenticatedActor());

        expect(evaluated.run_receipt_refs).toEqual(['run-1', 'run-2']);
        expect(evaluated.evaluation_history).toHaveLength(2);
        expect(evaluated.evaluation_history[0]).toMatchObject({
            run_receipt_refs: ['run-1'],
            retained_run_receipt_refs: ['run-1'],
            evaluator_claim: 'first-claim',
            current_external_state: 'processing',
            unresolved_failure_boundary: null,
            resulting_revision: 2,
            resulting_closure_status: 'waiting_human'
        });
        expect(evaluated.evaluation_history[1]).toMatchObject({
            run_receipt_refs: ['run-2'],
            retained_run_receipt_refs: ['run-1', 'run-2'],
            evaluator_claim: 'untrusted-request-text',
            evaluated_by: 'per_owner',
            current_external_state: 'processing',
            unresolved_failure_boundary: null,
            resulting_revision: 3,
            resulting_closure_status: 'closed'
        });
        expect(readRunReceipt).toHaveBeenCalledWith(expect.objectContaining({ runReceiptRef: 'run-1' }));
        expect(readRunReceipt).toHaveBeenCalledWith(expect.objectContaining({ runReceiptRef: 'run-2' }));
        expect(evaluated.closure_status).toBe('closed');
    });

    it('uses the authenticated actor, not evaluator text, for closure authority', async () => {
        const { service } = createService({ receiptStates: { 'run-1': 'confirmed' } });
        const outcomeCase = await service.create(createInput(), authenticatedActor());
        const evaluation = {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z'
        };

        await expect(service.evaluate(outcomeCase.case_id, evaluation, authenticatedActor({ person_id: 'someone_else' })))
            .rejects.toMatchObject({ code: 'closure_authority_denied', status: 403 });
        await expect(service.evaluate(outcomeCase.case_id, evaluation, authenticatedActor({ person_id: null })))
            .rejects.toMatchObject({ code: 'closure_actor_unauthenticated', status: 403 });
    });

    it('records unresolved authoritative references and forbids closure', async () => {
        const { service } = createService({
            receiptStates: { 'run-1': 'confirmed' },
            referenceStates: { project: 'confirmed', capability: 'unresolved' }
        });
        const outcomeCase = await service.create(createInput(), authenticatedActor());

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z'
        }, authenticatedActor());

        expect(evaluated.closure_status).toBe('waiting_human');
        expect(evaluated.reference_resolution.capability).toMatchObject({
            ref: 'cap_outcome_control', state: 'unresolved'
        });
    });

    it('rejects self-declared closure authority and cross-project reads or evaluations', async () => {
        const { service } = createService({ receiptStates: { 'run-1': 'confirmed' } });
        const owner = authenticatedActor();
        await expect(service.create(createInput({ authority: { closure_authorized_person_ids: ['per_owner'] } }), owner))
            .rejects.toMatchObject({ code: 'validation_failed' });

        const outcomeCase = await service.create(createInput(), owner);
        const foreignActor = authenticatedActor({ person_id: 'per_other', projectCodes: ['other'] });
        await expect(service.read(outcomeCase.case_id, foreignActor))
            .rejects.toMatchObject({ code: 'outcome_case_project_access_denied', status: 403 });
        await expect(service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z'
        }, foreignActor)).rejects.toMatchObject({ code: 'outcome_case_project_access_denied', status: 403 });
    });

    it('persists unavailable authoritative closure authority and forbids close', async () => {
        const { service } = createService({
            receiptStates: { 'run-1': 'confirmed' },
            resolveClosureAuthority: async () => ({
                state: 'unresolved', closure_authorized_person_ids: [], provenance: null,
                reason: 'authoritative_resolver_unavailable'
            })
        });
        const actor = authenticatedActor();
        const outcomeCase = await service.create(createInput(), actor);
        expect(outcomeCase.authority).toMatchObject({
            state: 'unresolved', reason: 'authoritative_resolver_unavailable'
        });

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z'
        }, actor);
        expect(evaluated).toMatchObject({ closure_status: 'waiting_human' });
        expect(evaluated.authority).toMatchObject({
            state: 'unresolved', reason: 'authoritative_resolver_unavailable'
        });
        expect(evaluated.evaluation_history.at(-1).authority).toMatchObject({ state: 'unresolved' });
    });
});

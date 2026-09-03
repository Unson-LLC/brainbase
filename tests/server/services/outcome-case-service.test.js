import { describe, expect, it, vi } from 'vitest';

import { OutcomeCaseError, OutcomeCaseService } from '../../../server/services/outcome-case/outcome-case-service.js';

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
        authority: { closure_authorized_person_ids: ['per_owner'] },
        selected_domain_pack: 'delivery-control/v1',
        current_external_state: 'processing',
        technical_story_refs: ['story-outcome-case-v1'],
        run_receipt_refs: [],
        prior_attempt_refs: [],
        unresolved_failure_boundary: null,
        ...overrides
    };
}

function createService({ receiptStates = {}, referenceStates = { project: 'confirmed', capability: 'confirmed' } } = {}) {
    const repository = new MemoryOutcomeCaseRepository();
    const readRunReceipt = vi.fn(async ({ runReceiptRef }) => {
        const evidenceState = receiptStates[runReceiptRef];
        return evidenceState ? { evidence_state: evidenceState } : null;
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
            now: () => new Date('2026-09-04T00:00:00.000Z')
        })
    };
}

describe('OutcomeCaseService', () => {
    it('creates the required control-plane record with an explicit external state', async () => {
        const { service } = createService();

        const outcomeCase = await service.create(createInput(), { person_id: 'per_owner' });

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
    });

    it('closes only with four-way confirmed evidence', async () => {
        const { service, readRunReceipt } = createService({ receiptStates: { 'run-1': 'confirmed' } });
        const outcomeCase = await service.create(createInput());

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z',
            current_external_state: 'verified-complete'
        }, { person_id: 'per_owner' });

        expect(readRunReceipt).toHaveBeenCalledWith(expect.objectContaining({
            projectCode: 'brainbase',
            runReceiptRef: 'run-1'
        }));
        expect(evaluated.closure_status).toBe('closed');
        expect(evaluated.revision).toBe(2);
        expect(evaluated.terminal_evaluation.run_receipts).toEqual([
            { ref: 'run-1', evidence_state: 'confirmed' }
        ]);
    });

    it('does not close from technical evidence when receipt readback is unconfirmed', async () => {
        const { service } = createService({ receiptStates: { 'run-1': 'unconfirmed' } });
        const outcomeCase = await service.create(createInput());

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
        }, { person_id: 'per_owner' });

        expect(evaluated.closure_status).toBe('incomplete');
        expect(evaluated.terminal_evaluation.close_eligible).toBe(false);
    });

    it('keeps no_data and unknown constraints out of closure and requires a real evidence ref for confirm', async () => {
        const { service } = createService();
        const outcomeCase = await service.create(createInput({ current_external_state: 'unknown' }));

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['missing-run'],
            external_readback: { status: 'no_data' },
            constraints_status: 'unknown',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z'
        });

        expect(evaluated.closure_status).toBe('waiting_human');
        expect(evaluated.terminal_evaluation.run_receipts).toEqual([
            { ref: 'missing-run', evidence_state: 'no_data' }
        ]);

        await expect(service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['missing-run'],
            external_readback: { status: 'confirm' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:02:00.000Z'
        }, { person_id: 'per_owner' })).rejects.toMatchObject({
            code: 'validation_failed'
        });
    });

    it('rejects direct closure status injection', async () => {
        const { service } = createService();

        await expect(service.create(createInput({ closure_status: 'closed' }))).rejects.toBeInstanceOf(OutcomeCaseError);
    });

    it('retains every previously stored receipt ref, appends the evaluation history, and diagnoses all retained refs before close', async () => {
        const { service, readRunReceipt } = createService({
            receiptStates: { 'run-1': 'confirmed', 'run-2': 'confirmed' }
        });
        const outcomeCase = await service.create(createInput());

        await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:first-evaluation'] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'no_data' },
            constraints_status: 'unknown',
            evaluator: 'first-claim',
            observed_at: '2026-09-04T00:01:00.000Z'
        }, { person_id: 'per_owner' });

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-2'],
            external_readback: { status: 'confirm', ref: 'external:receipt-2' },
            constraints_status: 'satisfied',
            evaluator: 'untrusted-request-text',
            observed_at: '2026-09-04T00:02:00.000Z'
        }, { person_id: 'per_owner' });

        expect(evaluated.run_receipt_refs).toEqual(['run-1', 'run-2']);
        expect(evaluated.evaluation_history).toHaveLength(2);
        expect(evaluated.evaluation_history[0]).toMatchObject({
            run_receipt_refs: ['run-1'],
            retained_run_receipt_refs: ['run-1'],
            evaluator_claim: 'first-claim'
        });
        expect(evaluated.evaluation_history[1]).toMatchObject({
            run_receipt_refs: ['run-2'],
            retained_run_receipt_refs: ['run-1', 'run-2'],
            evaluator_claim: 'untrusted-request-text',
            evaluated_by: 'per_owner'
        });
        expect(readRunReceipt).toHaveBeenCalledWith(expect.objectContaining({ runReceiptRef: 'run-1' }));
        expect(readRunReceipt).toHaveBeenCalledWith(expect.objectContaining({ runReceiptRef: 'run-2' }));
        expect(evaluated.closure_status).toBe('closed');
    });

    it('uses the authenticated actor, not evaluator text, for closure authority', async () => {
        const { service } = createService({ receiptStates: { 'run-1': 'confirmed' } });
        const outcomeCase = await service.create(createInput());
        const evaluation = {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z'
        };

        await expect(service.evaluate(outcomeCase.case_id, evaluation, { person_id: 'someone_else' }))
            .rejects.toMatchObject({ code: 'closure_authority_denied', status: 403 });
        await expect(service.evaluate(outcomeCase.case_id, evaluation, {}))
            .rejects.toMatchObject({ code: 'closure_actor_unauthenticated', status: 403 });
    });

    it('records unresolved authoritative references and forbids closure', async () => {
        const { service } = createService({
            receiptStates: { 'run-1': 'confirmed' },
            referenceStates: { project: 'confirmed', capability: 'unresolved' }
        });
        const outcomeCase = await service.create(createInput());

        const evaluated = await service.evaluate(outcomeCase.case_id, {
            technical_evidence: { status: 'confirmed', refs: ['test:outcome-case'] },
            run_receipt_refs: ['run-1'],
            external_readback: { status: 'confirm', ref: 'external:receipt-1' },
            constraints_status: 'satisfied',
            evaluator: 'per_owner',
            observed_at: '2026-09-04T00:01:00.000Z'
        }, { person_id: 'per_owner' });

        expect(evaluated.closure_status).toBe('waiting_human');
        expect(evaluated.reference_resolution.capability).toMatchObject({
            ref: 'cap_outcome_control', state: 'unresolved'
        });
    });
});

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
        authority: { accountable: 'per_owner' },
        selected_domain_pack: 'delivery-control/v1',
        current_external_state: 'processing',
        technical_story_refs: ['story-outcome-case-v1'],
        run_receipt_refs: [],
        prior_attempt_refs: [],
        unresolved_failure_boundary: null,
        ...overrides
    };
}

function createService({ receiptStates = {} } = {}) {
    const repository = new MemoryOutcomeCaseRepository();
    const readRunReceipt = vi.fn(async ({ runReceiptRef }) => {
        const evidenceState = receiptStates[runReceiptRef];
        return evidenceState ? { evidence_state: evidenceState } : null;
    });
    return {
        repository,
        readRunReceipt,
        service: new OutcomeCaseService({ repository, readRunReceipt, now: () => new Date('2026-09-04T00:00:00.000Z') })
    };
}

describe('OutcomeCaseService', () => {
    it('creates the required control-plane record with an explicit external state', async () => {
        const { service } = createService();

        const outcomeCase = await service.create(createInput());

        expect(outcomeCase).toMatchObject({
            project_code: 'brainbase',
            capability_id: 'cap_outcome_control',
            closure_status: 'open',
            current_external_state: 'processing',
            revision: 1,
            terminal_evaluation: null
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
        });

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
        });

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
        })).rejects.toMatchObject({
            code: 'validation_failed'
        });
    });

    it('rejects direct closure status injection', async () => {
        const { service } = createService();

        await expect(service.create(createInput({ closure_status: 'closed' }))).rejects.toBeInstanceOf(OutcomeCaseError);
    });
});

import { describe, expect, it, vi } from 'vitest';

import { OutcomeCasePostgresRepository } from '../../../server/services/outcome-case/outcome-case-postgres-repository.js';

const record = {
    case_id: 'oc_01',
    project_code: 'brainbase',
    capability_id: 'cap_outcome_control',
    user_observable_outcome: '利用者が外部完了を読戻せる',
    protected_constraints: ['外部読戻しなしで閉鎖しない'],
    non_goals: ['workflow'],
    authority: { closure_authorized_person_ids: ['per_owner'] },
    selected_domain_pack: 'delivery-control/v1',
    reference_resolution: {
        project: { ref: 'brainbase', state: 'confirmed', reason: null },
        capability: { ref: 'cap_outcome_control', state: 'confirmed', reason: null }
    },
    evaluation_history: [],
    terminal_evaluation: null,
    closure_status: 'open',
    current_external_state: 'processing',
    technical_story_refs: ['story-outcome-case-v1'],
    run_receipt_refs: [],
    prior_attempt_refs: [],
    unresolved_failure_boundary: null,
    revision: 1,
    created_at: '2026-09-04T00:00:00.000Z',
    updated_at: '2026-09-04T00:00:00.000Z'
};

describe('OutcomeCasePostgresRepository', () => {
    it('stores a complete control-plane record and only mutates evaluation fields', async () => {
        const pool = { query: vi.fn()
            .mockResolvedValueOnce({ rows: [record] })
            .mockResolvedValueOnce({ rows: [{
                ...record,
                revision: 2,
                closure_status: 'incomplete',
                run_receipt_refs: ['run-1'],
                evaluation_history: [{ close_eligible: false }],
                terminal_evaluation: { close_eligible: false }
            }] }) };
        const repository = new OutcomeCasePostgresRepository({ pool });

        const created = await repository.create(record);
        const updated = await repository.update({
            ...record,
            revision: 2,
            closure_status: 'incomplete',
            run_receipt_refs: ['run-1'],
            evaluation_history: [{ close_eligible: false }],
            terminal_evaluation: { close_eligible: false }
        }, { expectedRevision: 1 });

        expect(created).toMatchObject({ case_id: 'oc_01', revision: 1 });
        expect(updated).toMatchObject({ closure_status: 'incomplete', revision: 2 });
        expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO outcome_cases');
        expect(pool.query.mock.calls[0][0]).toContain('evaluation_history');
        expect(pool.query.mock.calls[0][0]).toContain('reference_resolution');
        expect(pool.query.mock.calls[1][0]).toContain('authority = $3::jsonb');
        expect(pool.query.mock.calls[1][0]).toContain('evaluation_history = $5::jsonb');
        expect(pool.query.mock.calls[1][0]).toContain('project_code = ANY($13::text[])');
        expect(pool.query.mock.calls[1][0]).not.toContain('user_observable_outcome =');
    });

    it('reports a revision conflict instead of silently overwriting a newer evaluation', async () => {
        const repository = new OutcomeCasePostgresRepository({
            pool: { query: vi.fn().mockResolvedValue({ rows: [] }) }
        });

        await expect(repository.update({ ...record, revision: 2 }, { expectedRevision: 1 }))
            .rejects.toMatchObject({ code: 'outcome_case_revision_conflict', status: 409 });
    });

    it('scopes reads and updates to the authenticated actor project set', async () => {
        const pool = { query: vi.fn().mockResolvedValue({ rows: [record] }) };
        const repository = new OutcomeCasePostgresRepository({ pool });

        await repository.findByCaseId('oc_01', { projectCodes: ['brainbase'] });
        await repository.update({ ...record, revision: 2 }, {
            expectedRevision: 1,
            actor: { projectCodes: ['brainbase'] }
        });

        expect(pool.query.mock.calls[0]).toEqual([
            expect.stringContaining('project_code = ANY($2::text[])'),
            ['oc_01', ['brainbase']]
        ]);
        expect(pool.query.mock.calls[1][1]).toEqual(expect.arrayContaining([['brainbase']]));
    });
});

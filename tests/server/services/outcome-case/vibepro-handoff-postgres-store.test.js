import { describe, expect, it, vi } from 'vitest';

import { VibeproHandoffPostgresStore } from '../../../../server/services/outcome-case/vibepro-handoff-postgres-store.js';

const actor = {
    personId: 'per_owner', organizationId: 'org_unson', tenantId: 'org_unson',
    projectCodes: ['brainbase'], clearance: ['internal'], role: 'member'
};

const request = {
    caseId: 'oc_001', resolutionId: 'resolution_001', expectedRevision: 3,
    target: {
        repository: 'https://github.com/Unson-LLC/example.git', repository_root: '.',
        base_sha: 'a'.repeat(40), story_id: 'story-outcome-vibepro-producer-contract'
    },
    technicalAcceptance: [{ id: 'TA-1', criterion: '採用済みの技術受入を読戻せる' }],
    productionProbe: { id: 'probe-1', procedure: '保存済みsnapshotを読戻す' }
};

function clientWith({ caseRow, receiptRow, grant = true, inserted = true } = {}) {
    return {
        query: vi.fn(async (text, values = []) => {
            if (text.includes("set_config")) return { rows: [] };
            if (text.includes('FROM outcome_cases')) return { rows: caseRow ? [caseRow] : [] };
            if (text.includes('FROM judgment_receipts')) return { rows: receiptRow ? [receiptRow] : [] };
            if (text.includes('FROM vibepro_handoff_adoption_grants')) return { rows: grant ? [{ allowed: true }] : [] };
            if (text.includes('INSERT INTO vibepro_handoff_adoptions')) return { rows: inserted ? [{
                organization_id: values[0], project_code: values[1], owner_person_id: values[2],
                case_id: values[3], resolution_id: values[4], outcome_case_revision: values[5],
                decision: JSON.parse(values[6]), target: JSON.parse(values[7]),
                technical_acceptance: JSON.parse(values[8]), production_probe: JSON.parse(values[9])
            }] : [] };
            throw new Error(`unexpected query: ${text}`);
        })
    };
}

const caseRow = {
    case_id: 'oc_001', organization_id: 'org_unson', project_code: 'brainbase', revision: 3,
    user_observable_outcome: '利用者が結果を確認できる'
};
const receiptRow = {
    organization_id: 'org_unson', project_code: 'brainbase', owner_person_id: 'per_owner',
    resolution_id: 'resolution_001', turn_id: 'turn_001', receipt: { personal_judgment: 'not copied' }
};

describe('VibeproHandoffPostgresStore', () => {
    it('本人のraw receiptと専用grantからだけadopted sourceを保存し、raw本文を複製しない', async () => {
        const client = clientWith({ caseRow, receiptRow });
        const infoSSOTService = { withAccessContext: vi.fn(async (_access, operation) => operation(client)) };
        const store = new VibeproHandoffPostgresStore({ pool: {}, infoSSOTService });

        const source = await store.adopt(request, actor);

        expect(source).toMatchObject({
            status: 'adopted', organization_id: 'org_unson', project_code: 'brainbase',
            case_id: 'oc_001', resolution_id: 'resolution_001', outcome_case_revision: 3,
            decision: {
                case_id: 'oc_001', project_code: 'brainbase', resolution_id: 'resolution_001', turn_id: 'turn_001',
                judgment_receipt_ref: 'brainbase://judgment-receipts/resolution_001'
            }
        });
        expect(JSON.stringify(source)).not.toContain('personal_judgment');
        expect(infoSSOTService.withAccessContext).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'org_unson', projectCodes: ['brainbase']
        }), expect.any(Function), { requireCanonicalTenant: true });
        expect(client.query.mock.calls.map(([text]) => text).join('\n')).toContain('vibepro_handoff_adoption_grants');
    });

    it('専用grantがなければRACI roleを渡しても保存せず拒否する', async () => {
        const client = clientWith({ caseRow, receiptRow, grant: false });
        const store = new VibeproHandoffPostgresStore({
            pool: {}, infoSSOTService: { withAccessContext: async (_access, operation) => operation(client) }
        });

        await expect(store.adopt(request, { ...actor, role: 'gm', raci: ['vibepro_handoff:adopt'] }))
            .rejects.toMatchObject({ code: 'vibepro_handoff_adoption_denied', status: 403 });
        expect(client.query.mock.calls.map(([text]) => text).join('\n')).not.toContain('INSERT INTO vibepro_handoff_adoptions');
    });

    it('内部呼出でもsymbol付き又はprototypeを持つadoption入力を422で拒否する', async () => {
        const client = clientWith({ caseRow, receiptRow });
        const store = new VibeproHandoffPostgresStore({
            pool: {}, infoSSOTService: { withAccessContext: async (_access, operation) => operation(client) }
        });
        const symbolRequest = { ...request, [Symbol('hidden')]: 'injected' };
        const inheritedRequest = Object.assign(Object.create({ injected: true }), request);

        await expect(store.adopt(symbolRequest, actor)).rejects.toMatchObject({
            code: 'vibepro_handoff_adoption_input_invalid', status: 422
        });
        await expect(store.adopt(inheritedRequest, actor)).rejects.toMatchObject({
            code: 'vibepro_handoff_adoption_input_invalid', status: 422
        });
        expect(client.query).not.toHaveBeenCalled();
    });
});

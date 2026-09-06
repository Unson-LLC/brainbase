import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../../server/services/auth-service.js';
import { createJudgmentReceiptAccessResolver } from '../../../server/services/judgment-receipt/judgment-receipt-access.js';

const PROJECT_CODE = 'techknight';
const CURRENT_ORGANIZATION = 'unson';
const TARGET_ORGANIZATION = 'techknight';

function access(overrides = {}) {
    return {
        personId: 'person_sato',
        role: 'member',
        projectCodes: ['brainbase', PROJECT_CODE],
        clearance: ['internal', 'finance'],
        organizationId: CURRENT_ORGANIZATION,
        tenantId: CURRENT_ORGANIZATION,
        slackUserId: 'U_SATO',
        slackWorkspaceId: 'T_UNSON',
        ...overrides
    };
}

function targetProject() {
    return { rows: [{ organization_id: TARGET_ORGANIZATION }] };
}

function targetGrant(overrides = {}) {
    return {
        organization_id: TARGET_ORGANIZATION,
        person_id: 'person_sato',
        slack_user_id: 'U_SATO',
        slack_workspace_id: 'T_UNSON',
        role: 'ceo',
        project_codes: [PROJECT_CODE],
        clearance: ['internal', 'restricted'],
        ...overrides
    };
}

function harness(responses = []) {
    const query = vi.fn(async (...args) => {
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response || { rows: [] };
    });
    const authService = Object.create(AuthService.prototype);
    authService.pool = { query };
    return {
        query,
        resolve: createJudgmentReceiptAccessResolver({ authService })
    };
}

async function expectDenied(result) {
    await expect(result).rejects.toMatchObject({
        code: 'judgment_receipt_access_denied',
        status: 403
    });
}

describe('createJudgmentReceiptAccessResolver', () => {
    it('同一組織では元のaccessをそのまま返し、bearer以外も変更しない', async () => {
        const original = access({
            organizationId: CURRENT_ORGANIZATION,
            tenantId: CURRENT_ORGANIZATION,
            projectCodes: [PROJECT_CODE],
            role: 'ceo',
            clearance: ['internal', 'finance']
        });
        const { resolve, query } = harness([{ rows: [{ organization_id: CURRENT_ORGANIZATION }] }]);

        const result = await resolve({
            access: original,
            projectCode: PROJECT_CODE,
            authSource: 'service'
        });

        expect(result).toBe(original);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][1]).toEqual([PROJECT_CODE]);
    });

    it('cross-org grantを同一person・Slack・target projectで厳密に選び、権限を広げず元accessを変更しない', async () => {
        const original = access();
        const before = structuredClone(original);
        const { resolve, query } = harness([
            targetProject(),
            { rows: [targetGrant()] }
        ]);

        const result = await resolve({
            access: original,
            projectCode: PROJECT_CODE,
            authSource: 'bearer'
        });

        expect(result).toEqual({
            personId: 'person_sato',
            role: 'member',
            projectCodes: [PROJECT_CODE],
            clearance: ['internal'],
            organizationId: TARGET_ORGANIZATION,
            tenantId: TARGET_ORGANIZATION,
            slackUserId: 'U_SATO',
            slackWorkspaceId: 'T_UNSON'
        });
        expect(result).not.toBe(original);
        expect(original).toEqual(before);
        expect(query).toHaveBeenCalledTimes(2);
        expect(query.mock.calls[1][1]).toEqual([
            TARGET_ORGANIZATION,
            'U_SATO',
            'T_UNSON',
            'person_sato',
            PROJECT_CODE
        ]);
    });

    it('target grantのroleが現在より低い場合も、grant以上のroleを返さない', async () => {
        const { resolve } = harness([
            targetProject(),
            { rows: [targetGrant({ role: 'member', clearance: ['internal'] })] }
        ]);

        const result = await resolve({
            access: access({ role: 'ceo' }),
            projectCode: PROJECT_CODE,
            authSource: 'bearer'
        });

        expect(result.role).toBe('member');
        expect(result.clearance).toEqual(['internal']);
    });

    it.each([
        ['authSourceがbearerでない', { authSource: 'service', access: access() }],
        ['Slack userがない', { authSource: 'bearer', access: access({ slackUserId: '' }) }],
        ['Slack workspaceがない', { authSource: 'bearer', access: access({ slackWorkspaceId: '' }) }]
    ])('cross-orgで%s場合はgrant lookupを許可しない', async (_label, input) => {
        const { resolve, query } = harness([targetProject()]);

        await expectDenied(resolve({
            access: input.access,
            projectCode: PROJECT_CODE,
            authSource: input.authSource
        }));

        expect(query).toHaveBeenCalledTimes(1);
    });

    it('scope外projectはDBを参照せず拒否する', async () => {
        const { resolve, query } = harness();

        await expectDenied(resolve({
            access: access({ projectCodes: ['brainbase'] }),
            projectCode: PROJECT_CODE,
            authSource: 'bearer'
        }));

        expect(query).not.toHaveBeenCalled();
    });

    it('projectがない、またはcanonical organizationがない場合は拒否する', async () => {
        const missingProject = harness([{ rows: [] }]);
        await expectDenied(missingProject.resolve({
            access: access(),
            projectCode: PROJECT_CODE,
            authSource: 'bearer'
        }));
        expect(missingProject.query).toHaveBeenCalledTimes(1);

        const missingOrganization = harness([{ rows: [{ organization_id: null }] }]);
        await expectDenied(missingOrganization.resolve({
            access: access(),
            projectCode: PROJECT_CODE,
            authSource: 'bearer'
        }));
        expect(missingOrganization.query).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['grantがない', []],
        ['grantが複数ある', [targetGrant(), targetGrant({ role: 'gm' })]]
    ])('対象projectの%s場合は拒否する', async (_label, grants) => {
        const { resolve, query } = harness([
            targetProject(),
            { rows: grants }
        ]);

        await expectDenied(resolve({
            access: access(),
            projectCode: PROJECT_CODE,
            authSource: 'bearer'
        }));

        expect(query).toHaveBeenCalledTimes(2);
        expect(query.mock.calls[1][1]).toEqual([
            TARGET_ORGANIZATION,
            'U_SATO',
            'T_UNSON',
            'person_sato',
            PROJECT_CODE
        ]);
    });

    it('DB failureはaccess deniedへ変換せず呼び出し元へ伝播する', async () => {
        const dbError = new Error('db down');
        const { resolve, query } = harness([targetProject(), dbError]);

        await expect(resolve({
            access: access(),
            projectCode: PROJECT_CODE,
            authSource: 'bearer'
        })).rejects.toBe(dbError);
        expect(query).toHaveBeenCalledTimes(2);
    });

    it('organizationIdとtenantIdが衝突するaccessはDB前に拒否する', async () => {
        const { resolve, query } = harness();

        await expect(resolve({
            access: access({ tenantId: 'another-tenant' }),
            projectCode: PROJECT_CODE,
            authSource: 'bearer'
        })).rejects.toMatchObject({
            code: 'canonical_tenant_identity_invalid',
            identityState: 'ambiguous',
            status: 403
        });
        expect(query).not.toHaveBeenCalled();
    });
});

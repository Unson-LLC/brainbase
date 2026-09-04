import { describe, expect, it, vi } from 'vitest';

import { createVibeproManagedHandoff } from '../../../../server/services/outcome-case/vibepro-managed-handoff.js';
import { createVibeproHandoffIssuer } from '../../../../server/services/outcome-case/vibepro-handoff-issuer.js';

const SIGNING_KEY = 'brainbase-vibepro-handoff-issuer-test-key-at-least-32-characters';
const KEY_ID = 'brainbase-vibepro-handoff-hmac-v1';
const NOW = new Date('2026-09-04T00:00:00.000Z');

function actor(overrides = {}) {
    return { person_id: 'per_owner', organizationId: 'org_unson', projectCodes: ['brainbase'], ...overrides };
}

function outcomeCase(overrides = {}) {
    return {
        case_id: 'outcome-case-001',
        organization_id: 'org_unson',
        project_code: 'brainbase',
        revision: 4,
        user_observable_outcome: '利用者が採用済み成果と技術受入を同じ案件として確認できる。',
        ...overrides
    };
}

function adoptedSource(overrides = {}) {
    return {
        status: 'adopted',
        organization_id: 'org_unson',
        project_code: 'brainbase',
        case_id: 'outcome-case-001',
        resolution_id: 'resolution-001',
        outcome_case_revision: 4,
        decision: {
            turn_id: 'turn-001',
            resolution_id: 'resolution-001',
            project_code: 'brainbase',
            case_id: 'outcome-case-001',
            selected_path: ['implementation']
        },
        target: {
            repository: 'https://github.com/Unson-LLC/example.git',
            repository_root: '.',
            project_code: 'brainbase',
            case_id: 'outcome-case-001',
            base_sha: 'a'.repeat(40),
            story_id: null
        },
        technicalAcceptance: [{ id: 'TA-1', criterion: 'VibeProが成果ケースを技術受入として投影できる。' }],
        productionProbe: { id: 'probe-001', procedure: '保存済み成果ケースを再読込する。' },
        ...overrides
    };
}

function createDependencies({ returnedCase = outcomeCase(), source = adoptedSource(), loader } = {}) {
    const outcomeCaseService = {
        read: vi.fn(async () => returnedCase)
    };
    const readAdoptedHandoff = loader || vi.fn(async () => source);
    return { outcomeCaseService, readAdoptedHandoff };
}

function createIssuer(dependencies, overrides = {}) {
    return createVibeproHandoffIssuer({
        ...dependencies,
        signingKey: SIGNING_KEY,
        keyId: KEY_ID,
        clock: () => new Date(NOW),
        ttlMs: 300_000,
        ...overrides
    });
}

describe('createVibeproHandoffIssuer', () => {
    it('鍵の構築時設定ミスを取得元の不正と混同しない', () => {
        for (const overrides of [{ signingKey: '' }, { signingKey: 'short' }, { keyId: '' }, { keyId: 'invalid/key' }]) {
            expect(() => createIssuer(createDependencies(), overrides)).toThrow(expect.objectContaining({
                code: 'vibepro_handoff_configuration_invalid', status: 500
            }));
        }
    });

    it('時計の例外・不正値を内部情報なしの設定エラーにする', async () => {
        for (const clock of [() => { throw new Error('private-clock-detail'); }, () => new Date(NaN)]) {
            const issuer = createIssuer(createDependencies(), { clock });
            await expect(issuer.issue({ caseId: 'outcome-case-001', resolutionId: 'resolution-001' }, actor()))
                .rejects.toMatchObject({
                    code: 'vibepro_handoff_configuration_invalid', status: 500,
                    message: 'VibePro handoff configuration is invalid'
                });
        }
    });

    it('認証済みcaseと採用済みsnapshotだけを既存producerへ渡し、署名済みwireを返す', async () => {
        const returnedCase = outcomeCase();
        const source = adoptedSource();
        const dependencies = createDependencies({ returnedCase, source });
        const issuer = createIssuer(dependencies);
        const beforeCase = structuredClone(returnedCase);
        const beforeSource = structuredClone(source);

        const receipt = await issuer.issue({ caseId: 'outcome-case-001', resolutionId: 'resolution-001' }, actor());

        const expected = createVibeproManagedHandoff({
            outcomeCase: beforeCase,
            decision: beforeSource.decision,
            target: beforeSource.target,
            technicalAcceptance: beforeSource.technicalAcceptance,
            productionProbe: beforeSource.productionProbe,
            signingKey: SIGNING_KEY,
            keyId: KEY_ID,
            issuedAt: NOW.toISOString(),
            expiresAt: '2026-09-04T00:05:00.000Z'
        });
        expect(receipt).toEqual(expected);
        expect(receipt).toMatchObject({ authorized: false, graph_promotion_allowed: false });
        expect(dependencies.outcomeCaseService.read).toHaveBeenCalledWith('outcome-case-001', actor());
        expect(dependencies.readAdoptedHandoff).toHaveBeenCalledWith(expect.objectContaining({
            caseId: 'outcome-case-001', resolutionId: 'resolution-001', organizationId: 'org_unson', projectCode: 'brainbase'
        }));
        expect(returnedCase).toEqual(beforeCase);
        expect(source).toEqual(beforeSource);
    });

    it.each([
        ['organizationなし', actor({ organizationId: undefined })],
        ['tenant claim競合', actor({ tenantId: 'org_other' })]
    ])('canonical tenantが%sactorではcase/sourceを読まない', async (_name, untrustedActor) => {
        const dependencies = createDependencies();
        const issuer = createIssuer(dependencies);

        await expect(issuer.issue({ caseId: 'outcome-case-001', resolutionId: 'resolution-001' }, untrustedActor))
            .rejects.toMatchObject({ code: 'vibepro_handoff_actor_denied', status: 403 });
        expect(dependencies.outcomeCaseService.read).not.toHaveBeenCalled();
        expect(dependencies.readAdoptedHandoff).not.toHaveBeenCalled();
    });

    it.each([
        ['別organizationのcase', outcomeCase({ organization_id: 'org_other' }), adoptedSource(), 403],
        ['別projectのcase', outcomeCase({ project_code: 'other-project' }), adoptedSource(), 403],
        ['別organizationのsource', outcomeCase(), adoptedSource({ organization_id: 'org_other' }), 409],
        ['別projectのsource', outcomeCase(), adoptedSource({ project_code: 'other-project' }), 409],
        ['古いcase revisionのsource', outcomeCase(), adoptedSource({ outcome_case_revision: 3 }), 409]
    ])('%sを発行しない', async (_name, returnedCase, source, status) => {
        const dependencies = createDependencies({ returnedCase, source });
        const issuer = createIssuer(dependencies);

        await expect(issuer.issue({ caseId: 'outcome-case-001', resolutionId: 'resolution-001' }, actor()))
            .rejects.toMatchObject({ status });
        if (status === 403) expect(dependencies.readAdoptedHandoff).not.toHaveBeenCalled();
    });

    it.each([
        ['通常Turn receipt（adoptionなし）', { decision: adoptedSource().decision }, 'vibepro_handoff_source_invalid'],
        ['未採用source', adoptedSource({ status: 'pending' }), 'vibepro_handoff_source_invalid'],
        ['decisionのresolution不一致', adoptedSource({ decision: { ...adoptedSource().decision, resolution_id: 'resolution-other' } }), 'vibepro_handoff_source_incoherent'],
        ['decisionのcase不一致', adoptedSource({ decision: { ...adoptedSource().decision, case_id: 'case-other' } }), 'vibepro_handoff_source_incoherent'],
        ['targetのcase不一致', adoptedSource({ target: { ...adoptedSource().target, case_id: 'case-other' } }), 'vibepro_handoff_source_incoherent'],
        ['technical acceptance欠落', adoptedSource({ technicalAcceptance: undefined }), 'vibepro_handoff_source_invalid'],
        ['production probe欠落', adoptedSource({ productionProbe: undefined }), 'vibepro_handoff_source_invalid']
    ])('%sを採用snapshotとして扱わない', async (_name, source, code) => {
        const dependencies = createDependencies({ source });
        const issuer = createIssuer(dependencies);

        await expect(issuer.issue({ caseId: 'outcome-case-001', resolutionId: 'resolution-001' }, actor()))
            .rejects.toMatchObject({ code, status: 409 });
    });

    it('未設定・未取得・loader例外を成功にせず、例外本文を露出しない', async () => {
        const dependencies = createDependencies();
        const unavailable = createIssuer({ ...dependencies, readAdoptedHandoff: undefined });
        await expect(unavailable.issue({ caseId: 'outcome-case-001', resolutionId: 'resolution-001' }, actor()))
            .rejects.toMatchObject({ code: 'vibepro_handoff_source_unavailable', status: 503 });

        const missing = createIssuer(createDependencies({ source: null }));
        await expect(missing.issue({ caseId: 'outcome-case-001', resolutionId: 'resolution-001' }, actor()))
            .rejects.toMatchObject({ code: 'vibepro_handoff_source_not_found', status: 404 });

        const throwingLoader = vi.fn(async () => { throw new Error('secret-source-value'); });
        const throwing = createIssuer(createDependencies({ loader: throwingLoader }));
        await expect(throwing.issue({ caseId: 'outcome-case-001', resolutionId: 'resolution-001' }, actor()))
            .rejects.toMatchObject({ code: 'vibepro_handoff_source_unavailable', status: 503, message: 'VibePro handoff source is unavailable' });
    });

    it('公開inputのkey/time/body上書きとTTL外設定を拒否する', async () => {
        const dependencies = createDependencies();
        const issuer = createIssuer(dependencies);

        await expect(issuer.issue({
            caseId: 'outcome-case-001', resolutionId: 'resolution-001', signingKey: 'attacker-key', expiresAt: '2099-01-01T00:00:00.000Z'
        }, actor())).rejects.toMatchObject({ code: 'vibepro_handoff_input_invalid', status: 422 });
        expect(dependencies.readAdoptedHandoff).not.toHaveBeenCalled();
        expect(() => createIssuer(createDependencies(), { ttlMs: 3_600_001 })).toThrow(/ttlMs/u);
    });
});

import { describe, expect, it, vi } from 'vitest';

import {
    createManaOutcomeAuthorityReadbackProvider,
    createManaOutcomeAuthorityReadbackProviderFromEnv,
    MANA_OUTCOME_AUTHORITY_READBACK_PATH,
    MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE_ENV,
    MANA_OUTCOME_AUTHORITY_READBACK_URL_ENV
} from '../../../server/services/knowledge-retrieve-binding-provider.js';

const EXPECTED = {
    project_code: 'alpha',
    outcome_contract_id: 'oc_1',
    run_id: 'run_1'
};

const TOKEN_CONTEXT = {
    serviceIdentity: { subject: 'svc_mana' },
    verifiedToken: {
        sub: 'svc_mana',
        subject: 'svc_mana',
        organizationId: 'org_1',
        delegatedActorPersonId: 'person_1',
        projectCodes: ['alpha'],
        capabilities: ['knowledge.retrieve'],
        outcomeContractId: 'oc_1',
        runId: 'run_1',
        contractVersion: 3
    }
};

function readback(overrides = {}) {
    return {
        principal: {
            tenant_id: 'org_1',
            project_id: 'alpha',
            actor_principal_id: 'person_1'
        },
        persisted: {
            contract_id: 'oc_1',
            contract_version: '3',
            run_id: 'run_1',
            resource_ref: 'meeting-minutes:github'
        },
        authority_revision: 'rev_1',
        profile_id: 'meeting_minutes_github_v1',
        run_mode: 'normal',
        contract_status: 'active',
        ...overrides
    };
}

function response(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

describe('Mana outcome authority readback binding provider', () => {
    it('posts the canonical readback identity and returns only persisted binding fields', async () => {
        const fetchImpl = vi.fn(async () => response(readback()));
        const provider = createManaOutcomeAuthorityReadbackProvider({
            endpoint: 'https://mana.internal',
            resource: 'meeting-minutes:github',
            fetchImpl
        });

        await expect(provider.verifyBinding(EXPECTED, TOKEN_CONTEXT)).resolves.toMatchObject({
            organization_id: 'org_1',
            delegated_actor_person_id: 'person_1',
            authorized_project_codes: ['alpha'],
            capability: 'knowledge.retrieve',
            outcome_contract_id: 'oc_1',
            run_id: 'run_1',
            service_subject: 'svc_mana',
            contract_version: 3
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe(`https://mana.internal${MANA_OUTCOME_AUTHORITY_READBACK_PATH}`);
        expect(init.method).toBe('POST');
        expect(init.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json' });
        expect(JSON.parse(init.body)).toEqual({
            tenant: 'org_1',
            project: 'alpha',
            actor: 'person_1',
            contract: 'oc_1',
            version: 3,
            run: 'run_1',
            resource: 'meeting-minutes:github'
        });
    });

    it.each([
        ['tenant', { principal: { ...readback().principal, tenant_id: 'org_other' } }],
        ['actor', { principal: { ...readback().principal, actor_principal_id: 'person_other' } }],
        ['project', { principal: { ...readback().principal, project_id: 'beta' } }],
        ['contract', { persisted: { ...readback().persisted, contract_id: 'oc_other' } }],
        ['run', { persisted: { ...readback().persisted, run_id: 'run_other' } }]
    ])('fails closed on persisted %s mismatch', async (_name, override) => {
        const fetchImpl = vi.fn(async () => response(readback(override)));
        const provider = createManaOutcomeAuthorityReadbackProvider({
            endpoint: 'https://mana.internal/v1/outcome-authority:readback',
            resource: 'meeting-minutes:github',
            fetchImpl
        });

        await expect(provider.verifyBinding(EXPECTED, TOKEN_CONTEXT)).rejects.toThrow();
    });

    it.each([
        ['organization', { organizationId: 'org_other' }],
        ['delegated actor', { delegatedActorPersonId: 'person_other' }],
        ['project', { projectCodes: ['beta'] }],
        ['contract', { outcomeContractId: 'oc_other' }],
        ['run', { runId: 'run_other' }]
    ])('does not read Mana when verified token %s is mismatched', async (_name, claim) => {
        const fetchImpl = vi.fn(async () => response(readback()));
        const provider = createManaOutcomeAuthorityReadbackProvider({
            endpoint: 'https://mana.internal',
            resource: 'meeting-minutes:github',
            fetchImpl
        });
        const expected = (_name === 'organization' || _name === 'delegated actor')
            ? { ...EXPECTED, organization_id: 'org_1', delegated_actor_person_id: 'person_1' }
            : EXPECTED;

        await expect(provider.verifyBinding(expected, {
            ...TOKEN_CONTEXT,
            verifiedToken: { ...TOKEN_CONTEXT.verifiedToken, ...claim }
        })).rejects.toThrow();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('fails closed when endpoint, resource or fetch implementation is absent', () => {
        expect(createManaOutcomeAuthorityReadbackProvider({
            resource: 'meeting-minutes:github',
            fetchImpl: vi.fn()
        })).toBeNull();
        expect(createManaOutcomeAuthorityReadbackProvider({
            endpoint: 'https://mana.internal',
            fetchImpl: vi.fn()
        })).toBeNull();
        expect(createManaOutcomeAuthorityReadbackProvider({
            endpoint: 'file:///tmp/mana',
            resource: 'meeting-minutes:github',
            fetchImpl: vi.fn()
        })).toBeNull();
        expect(createManaOutcomeAuthorityReadbackProviderFromEnv({
            env: {},
            fetchImpl: vi.fn()
        })).toBeNull();
    });

    it('loads endpoint and resource only from the explicit deployment configuration', () => {
        const env = {
            [MANA_OUTCOME_AUTHORITY_READBACK_URL_ENV]: 'https://mana.internal',
            [MANA_OUTCOME_AUTHORITY_READBACK_RESOURCE_ENV]: 'meeting-minutes:github'
        };
        expect(createManaOutcomeAuthorityReadbackProviderFromEnv({
            env,
            fetchImpl: vi.fn()
        })).not.toBeNull();
    });
});

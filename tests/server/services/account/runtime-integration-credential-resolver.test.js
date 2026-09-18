import { describe, expect, it } from 'vitest';

import { InMemoryAccountRepository } from '../../../../server/services/account/account-repository.js';
import {
    resolveRuntimeIntegrationCredential,
    RuntimeIntegrationCredentialError
} from '../../../../server/services/account/runtime-integration-credential-resolver.js';

async function createFreeeAccount(repo, input = {}) {
    const account = repo.create({
        id: input.id ?? 'acc_freee',
        service: 'freee',
        scope_type: input.scope_type ?? 'org',
        owner_person_id: input.owner_person_id,
        org_id: input.org_id ?? 'org_unson',
        project_id: input.project_id,
        display_name: input.display_name ?? '雲孫 freee',
        external_account_id: input.external_account_id ?? '123456',
        credential_ref: input.credential_ref ?? {
            provider: 'brainbase-credential-store',
            path: 'credref://bbcs/freee-unson'
        },
        capabilities: input.capabilities ?? ['read'],
        status: input.status ?? 'connected',
        created_by_person_id: 'per_admin'
    });
    if (input.bindTenant !== false) {
        await repo.bindTenant({
            tenant_id: input.tenant_id ?? 'tenant_unson',
            account_id: account.id,
            created_by_person_id: 'per_admin'
        });
    }
    return account;
}

async function expectCode(promise, code) {
    await expect(promise).rejects.toMatchObject({
        name: RuntimeIntegrationCredentialError.name,
        code
    });
}

describe('runtime integration credential resolver', () => {
    it('resolves an organization-scoped freee read credential without secret or unverified provider material', async () => {
        const repo = new InMemoryAccountRepository();
        const account = await createFreeeAccount(repo);
        repo.setDefault({
            subject_type: 'org', subject_id: 'org_unson', service: 'freee', purpose: 'runtime_read',
            account_id: account.id, created_by_person_id: 'per_admin'
        });

        const resolved = await resolveRuntimeIntegrationCredential({
            accountRepository: repo,
            context: { tenant_id: 'tenant_unson', actor_person_id: 'per_haru', organization_ids: ['org_unson'], project_ids: [] }
        });

        expect(resolved).toEqual(expect.objectContaining({
            service: 'freee', tenant_id: 'tenant_unson', account_id: account.id, company_id: 123456,
            default_subject_type: 'org', default_subject_id: 'org_unson',
            account_scope_type: 'org', account_scope_id: 'org_unson',
            credential_ref: 'credref://bbcs/freee-unson', credential_mode: 'customer_oauth',
            capabilities: ['read']
        }));
        expect(resolved).not.toHaveProperty('provider');
        expect(resolved).not.toHaveProperty('subject_type');
        expect(resolved).not.toHaveProperty('subject_id');
        expect(JSON.stringify(resolved)).not.toMatch(/access_token|refresh_token|secret/i);
    });

    it('prefers a project default over organization and personal defaults', async () => {
        const repo = new InMemoryAccountRepository();
        const personal = await createFreeeAccount(repo, {
            id: 'acc_personal', scope_type: 'personal', owner_person_id: 'per_haru', org_id: undefined,
            credential_ref: { provider: 'brainbase-credential-store', path: 'credref://bbcs/freee-personal' }
        });
        const org = await createFreeeAccount(repo, {
            id: 'acc_org', credential_ref: { provider: 'brainbase-credential-store', path: 'credref://bbcs/freee-org' }
        });
        const project = await createFreeeAccount(repo, {
            id: 'acc_project', scope_type: 'project', org_id: undefined, project_id: 'prj_backoffice',
            credential_ref: { provider: 'brainbase-credential-store', path: 'credref://bbcs/freee-project' }
        });
        repo.setDefault({ subject_type: 'personal', subject_id: 'per_haru', service: 'freee', purpose: 'runtime_read', account_id: personal.id, created_by_person_id: 'per_admin' });
        repo.setDefault({ subject_type: 'org', subject_id: 'org_unson', service: 'freee', purpose: 'runtime_read', account_id: org.id, created_by_person_id: 'per_admin' });
        repo.setDefault({ subject_type: 'project', subject_id: 'prj_backoffice', service: 'freee', purpose: 'runtime_read', account_id: project.id, created_by_person_id: 'per_admin' });

        const resolved = await resolveRuntimeIntegrationCredential({
            accountRepository: repo,
            context: { tenant_id: 'tenant_unson', actor_person_id: 'per_haru', organization_ids: ['org_unson'], project_ids: ['prj_backoffice'] }
        });
        expect(resolved).toEqual(expect.objectContaining({
            account_id: project.id,
            default_subject_type: 'project',
            default_subject_id: 'prj_backoffice',
            account_scope_type: 'project',
            account_scope_id: 'prj_backoffice'
        }));
    });

    it('fails closed when two authorized projects resolve to different accounts', async () => {
        const repo = new InMemoryAccountRepository();
        const a = await createFreeeAccount(repo, {
            id: 'acc_project_a', scope_type: 'project', org_id: undefined, project_id: 'prj_a',
            credential_ref: { provider: 'brainbase-credential-store', path: 'credref://bbcs/project-a' }
        });
        const b = await createFreeeAccount(repo, {
            id: 'acc_project_b', scope_type: 'project', org_id: undefined, project_id: 'prj_b',
            credential_ref: { provider: 'brainbase-credential-store', path: 'credref://bbcs/project-b' }
        });
        repo.setDefault({ subject_type: 'project', subject_id: 'prj_a', service: 'freee', purpose: 'runtime_read', account_id: a.id, created_by_person_id: 'per_admin' });
        repo.setDefault({ subject_type: 'project', subject_id: 'prj_b', service: 'freee', purpose: 'runtime_read', account_id: b.id, created_by_person_id: 'per_admin' });

        await expectCode(resolveRuntimeIntegrationCredential({
            accountRepository: repo,
            context: { tenant_id: 'tenant_unson', actor_person_id: 'per_haru', project_ids: ['prj_a', 'prj_b'] }
        }), 'INTEGRATION_ACCOUNT_AMBIGUOUS');
    });

    it('dedupes the same organization account selected by multiple projects without misreporting credential scope', async () => {
        const repo = new InMemoryAccountRepository();
        const shared = await createFreeeAccount(repo, { id: 'acc_shared_org' });
        repo.setDefault({ subject_type: 'project', subject_id: 'prj_b', service: 'freee', purpose: 'runtime_read', account_id: shared.id, created_by_person_id: 'per_admin' });
        repo.setDefault({ subject_type: 'project', subject_id: 'prj_a', service: 'freee', purpose: 'runtime_read', account_id: shared.id, created_by_person_id: 'per_admin' });

        const resolved = await resolveRuntimeIntegrationCredential({
            accountRepository: repo,
            context: {
                tenant_id: 'tenant_unson',
                actor_person_id: 'per_haru',
                organization_ids: ['org_unson'],
                project_ids: ['prj_b', 'prj_a']
            }
        });

        expect(resolved).toEqual(expect.objectContaining({
            account_id: shared.id,
            default_subject_type: 'project',
            default_subject_id: 'prj_a',
            account_scope_type: 'org',
            account_scope_id: 'org_unson'
        }));
    });

    it('filters other-tenant defaults before ambiguity resolution', async () => {
        const repo = new InMemoryAccountRepository();
        const own = await createFreeeAccount(repo, {
            id: 'acc_own', scope_type: 'project', org_id: undefined, project_id: 'prj_own'
        });
        const other = await createFreeeAccount(repo, {
            id: 'acc_other_tenant', tenant_id: 'tenant_other',
            scope_type: 'project', org_id: undefined, project_id: 'prj_other'
        });
        repo.setDefault({
            subject_type: 'project', subject_id: 'prj_own', service: 'freee', purpose: 'runtime_read',
            account_id: own.id, created_by_person_id: 'per_admin'
        });
        repo.setDefault({
            subject_type: 'project', subject_id: 'prj_other', service: 'freee', purpose: 'runtime_read',
            account_id: other.id, created_by_person_id: 'per_admin'
        });

        const resolved = await resolveRuntimeIntegrationCredential({
            accountRepository: repo,
            context: {
                tenant_id: 'tenant_unson',
                actor_person_id: 'per_haru',
                project_ids: ['prj_own', 'prj_other']
            }
        });
        expect(resolved.account_id).toBe(own.id);
    });

    it('does not resolve a default that is bound only to another tenant', async () => {
        const repo = new InMemoryAccountRepository();
        const account = await createFreeeAccount(repo, { id: 'acc_other_tenant', tenant_id: 'tenant_other' });
        repo.setDefault({
            subject_type: 'org', subject_id: 'org_unson', service: 'freee', purpose: 'runtime_read',
            account_id: account.id, created_by_person_id: 'per_admin'
        });

        await expectCode(resolveRuntimeIntegrationCredential({
            accountRepository: repo,
            context: {
                tenant_id: 'tenant_unson',
                actor_person_id: 'per_haru',
                organization_ids: ['org_unson'],
                project_ids: []
            }
        }), 'INTEGRATION_ACCOUNT_NOT_CONNECTED');
    });

    it('rejects an account whose own scope is outside the authorized context', async () => {
        const repo = new InMemoryAccountRepository();
        const account = await createFreeeAccount(repo, { id: 'acc_other_org', org_id: 'org_other' });
        repo.setDefault({ subject_type: 'project', subject_id: 'prj_a', service: 'freee', purpose: 'runtime_read', account_id: account.id, created_by_person_id: 'per_admin' });

        await expectCode(resolveRuntimeIntegrationCredential({
            accountRepository: repo,
            context: { tenant_id: 'tenant_unson', actor_person_id: 'per_haru', organization_ids: ['org_unson'], project_ids: ['prj_a'] }
        }), 'INTEGRATION_ACCOUNT_SCOPE_MISMATCH');
    });

    it('requires an authoritative numeric freee company id on the selected integration account', async () => {
        const repo = new InMemoryAccountRepository();
        const account = await createFreeeAccount(repo, { external_account_id: 'not-a-company' });
        repo.setDefault({
            subject_type: 'org', subject_id: 'org_unson', service: 'freee', purpose: 'runtime_read',
            account_id: account.id, created_by_person_id: 'per_admin'
        });

        await expectCode(resolveRuntimeIntegrationCredential({
            accountRepository: repo,
            context: { tenant_id: 'tenant_unson', actor_person_id: 'per_haru', organization_ids: ['org_unson'] }
        }), 'INTEGRATION_COMPANY_BINDING_INVALID');
    });

    it('fails closed when the selected account lacks read capability', async () => {
        const repo = new InMemoryAccountRepository();
        const account = await createFreeeAccount(repo, { capabilities: ['write'] });
        repo.setDefault({ subject_type: 'org', subject_id: 'org_unson', service: 'freee', purpose: 'runtime_read', account_id: account.id, created_by_person_id: 'per_admin' });
        await expectCode(resolveRuntimeIntegrationCredential({
            accountRepository: repo,
            context: { tenant_id: 'tenant_unson', actor_person_id: 'per_haru', organization_ids: ['org_unson'] }
        }), 'INTEGRATION_CAPABILITY_SCOPE_MISMATCH');
    });

    it('surfaces reauthentication instead of falling back to another credential', async () => {
        const repo = new InMemoryAccountRepository();
        const account = await createFreeeAccount(repo, { status: 'reauth_required' });
        repo.setDefault({ subject_type: 'org', subject_id: 'org_unson', service: 'freee', purpose: 'runtime_read', account_id: account.id, created_by_person_id: 'per_admin' });
        await expectCode(resolveRuntimeIntegrationCredential({
            accountRepository: repo,
            context: { tenant_id: 'tenant_unson', actor_person_id: 'per_haru', organization_ids: ['org_unson'] }
        }), 'INTEGRATION_REAUTH_REQUIRED');
    });

    it('rejects refs that are not backed by the canonical credential store namespace', async () => {
        const badRefs = [
            { provider: 'infisical', path: '/integrations/freee/unson' },
            { provider: 'brainbase-credential-store', path: 'credref://a/../slack/bot-token' },
            { provider: 'brainbase-credential-store', path: 'credref://bbcs/freee/../slack' },
            { provider: 'brainbase-credential-store', path: 'credref://bbcs/freee/nested' }
        ];
        for (const credential_ref of badRefs) {
            const repo = new InMemoryAccountRepository();
            const account = await createFreeeAccount(repo, { credential_ref });
            repo.setDefault({ subject_type: 'org', subject_id: 'org_unson', service: 'freee', purpose: 'runtime_read', account_id: account.id, created_by_person_id: 'per_admin' });
            await expectCode(resolveRuntimeIntegrationCredential({
                accountRepository: repo,
                context: { tenant_id: 'tenant_unson', actor_person_id: 'per_haru', organization_ids: ['org_unson'] }
            }), 'INTEGRATION_CREDENTIAL_REF_INVALID');
        }
    });
});

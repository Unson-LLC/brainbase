import { describe, expect, it, vi } from 'vitest';

import {
    parseManaAutonomyAuthorityRolloutArgs,
    runManaAutonomyAuthorityRollout
} from '../../scripts/rollout-mana-autonomy-service-authority.js';

const env = {
    BRAINBASE_TENANT_KEY: 'unson-business',
    BRAINBASE_ORGANIZATION_ID: 'unson',
    BRAINBASE_PROJECT_CODE: 'brainbase',
    BRAINBASE_SERVICE_ACTOR_ID: 'mana_autonomy_v0',
    BRAINBASE_WORKSPACE_ID: 'T_UNSON',
    BRAINBASE_APP_ID: 'A_MANA',
    BRAINBASE_SERVICE_PLACEMENT_ID: 'mana-autonomy',
    BRAINBASE_ACCOUNTABLE_PERSON_ID: 'person_keigo',
    BRAINBASE_DELEGATED_BY_PERSON_ID: 'person_keigo',
    BRAINBASE_RESOURCE_REVISION: '1',
    BRAINBASE_POLICY_REVISION: '1',
    BRAINBASE_RACI_REVISION: '1',
    MANA_AUTONOMY_VALID_FROM: '2026-08-28T03:00:00.000Z',
    MANA_AUTONOMY_VALID_UNTIL: '2026-08-29T03:00:00.000Z'
};

function manifest() {
    return {
        version: 'service-company-authority.v1',
        tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        organization_id: 'unson',
        project: { project_id: 'proj_brainbase', project_code: 'brainbase' },
        transport: { workspace_id: 'T_UNSON', app_id: 'A_MANA' },
        service_actor: {
            actor_id: 'mana_autonomy_v0',
            placement_id: 'mana-autonomy',
            bindings: [{
                registry_capability: 'create_task',
                resource_ref: 'project:brainbase',
                capability_id: 'task.create',
                decision: 'auto',
                allowed_effects: ['write'],
                responsible_person_id: null,
                accountable_person_id: 'person_keigo',
                approver_person_id: null,
                delegated_by_person_id: 'person_keigo',
                resource_revision: '1',
                policy_revision: '1',
                raci_revision: '1',
                stop_conditions: ['autonomy_kill_switch_active'],
                valid_from: '2026-08-28T03:00:00.000Z',
                valid_until: '2026-08-29T03:00:00.000Z'
            }]
        }
    };
}

function foundation({ applied = false } = {}) {
    return {
        ok: true,
        mode: 'read-only',
        tenant: {
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            tenant_key: 'unson-business',
            tenant_revision: '7',
            status: 'active'
        },
        organization: { organization_id: 'unson' },
        project: { project_id: 'proj_brainbase', project_code: 'brainbase' },
        workspace_connection: {
            connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW',
            connection_revision: '11',
            installation_id: 'installation-unson',
            workspace_id: 'T_UNSON',
            app_id: 'A_MANA',
            granted_scopes: ['chat:write'],
            status: 'active'
        },
        service_actor: {
            actor_id: 'mana_autonomy_v0',
            canonical_project_id: 'proj_brainbase',
            placement_id: 'mana-autonomy',
            status: 'active',
            registration_status: 'active',
            capabilities: ['create_task']
        },
        company_identity: applied ? {
            identity_id: 'svc_identity_1',
            identity_revision: '1',
            membership_id: 'svc_membership_1',
            project_id: 'proj_brainbase',
            placement_id: 'mana-autonomy',
            principal_type: 'service',
            status: 'active'
        } : null,
        company_authority_bindings: applied ? [{
            binding_id: 'svc_binding_1',
            binding_revision: '1',
            membership_id: 'svc_membership_1',
            resource_ref: 'project:brainbase',
            capability_id: 'task.create',
            decision: 'auto',
            allowed_effects: ['write'],
            policy_revision: '1',
            raci_revision: '1',
            status: 'active',
            valid_from: '2026-08-28T03:00:00.000Z',
            valid_until: '2026-08-29T03:00:00.000Z'
        }] : []
    };
}

function pool() {
    const client = { release: vi.fn() };
    return {
        client,
        pool: {
            connect: vi.fn(async () => client),
            end: vi.fn(async () => undefined)
        }
    };
}

describe('Mana autonomy authority rollout', () => {
    it('requires explicit apply approval and actor', () => {
        expect(() => parseManaAutonomyAuthorityRolloutArgs(['--apply'], {
            BRAINBASE_PROVISIONING_ACTOR: 'operator'
        })).toThrowError(expect.objectContaining({ code: 'APPLY_APPROVAL_REQUIRED' }));
        expect(() => parseManaAutonomyAuthorityRolloutArgs(['--apply', '--approve-apply'], {}))
            .toThrowError(expect.objectContaining({ code: 'PROVISIONING_ACTOR_REQUIRED' }));
        expect(parseManaAutonomyAuthorityRolloutArgs(['--dry-run'], {})).toEqual({
            mode: 'dry-run',
            actor: 'dry-run'
        });
    });

    it('executes the real provisioner path with commit=false for dry-run', async () => {
        const current = pool();
        const readFoundation = vi.fn(async () => foundation());
        const buildManifest = vi.fn(() => manifest());
        const provision = vi.fn(async () => ({
            plan: [{ operation: 'create', entity: 'company_external_identity' }],
            snapshot_after: { identity: { identity_id: 'transactional-only' }, bindings: [] }
        }));
        const result = await runManaAutonomyAuthorityRollout({
            argv: ['--dry-run'],
            env,
            pool: current.pool,
            dependencies: { readFoundation, buildManifest, provision }
        });
        expect(provision).toHaveBeenCalledWith(expect.objectContaining({
            client: current.client,
            actorId: 'dry-run',
            commit: false
        }));
        expect(readFoundation).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            ok: true,
            mode: 'dry-run',
            persisted: false,
            actor_id: 'mana_autonomy_v0',
            accountable_person_id: 'person_keigo',
            plan: [{ operation: 'create', entity: 'company_external_identity' }]
        });
        expect(current.client.release).toHaveBeenCalledOnce();
    });

    it('applies only with explicit approval and verifies persisted identity and authority', async () => {
        const current = pool();
        const readFoundation = vi.fn()
            .mockResolvedValueOnce(foundation())
            .mockResolvedValueOnce(foundation({ applied: true }));
        const provision = vi.fn(async () => ({
            plan: [
                { operation: 'create', entity: 'company_external_identity' },
                { operation: 'create', entity: 'company_authority_binding' }
            ],
            snapshot_after: { identity: { identity_id: 'svc_identity_1' }, bindings: [] }
        }));
        const result = await runManaAutonomyAuthorityRollout({
            argv: ['--apply', '--approve-apply'],
            env: { ...env, BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' },
            pool: current.pool,
            dependencies: {
                readFoundation,
                buildManifest: () => manifest(),
                provision
            }
        });
        expect(provision).toHaveBeenCalledWith(expect.objectContaining({
            actorId: 'operator-keigo',
            commit: true
        }));
        expect(result.persisted).toBe(true);
        expect(result.persisted_readback.company_identity.identity_id).toBe('svc_identity_1');
    });

    it('fails after apply when persisted readback does not prove the exact authority', async () => {
        const current = pool();
        const mismatched = foundation({ applied: true });
        mismatched.company_authority_bindings[0].allowed_effects = ['read'];
        const readFoundation = vi.fn()
            .mockResolvedValueOnce(foundation())
            .mockResolvedValueOnce(mismatched);
        await expect(runManaAutonomyAuthorityRollout({
            argv: ['--apply', '--approve-apply'],
            env: { ...env, BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' },
            pool: current.pool,
            dependencies: {
                readFoundation,
                buildManifest: () => manifest(),
                provision: vi.fn(async () => ({ plan: [], snapshot_after: {} }))
            }
        })).rejects.toMatchObject({ code: 'APPLY_READBACK_AUTHORITY_MISMATCH' });
        expect(current.client.release).toHaveBeenCalledOnce();
    });
});

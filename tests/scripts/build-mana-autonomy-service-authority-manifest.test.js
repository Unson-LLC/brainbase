import { describe, expect, it } from 'vitest';

import {
    buildManaAutonomyServiceAuthorityManifest
} from '../../scripts/build-mana-autonomy-service-authority-manifest.js';
import {
    normalizeServiceCompanyAuthorityManifest
} from '../../server/services/multitenant/service-company-authority-provisioner.js';

function foundation(overrides = {}) {
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
        project: {
            project_id: 'proj_brainbase',
            project_code: 'brainbase'
        },
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
            tenant_key: 'unson-business',
            canonical_project_id: 'proj_brainbase',
            status: 'active',
            placement_id: 'mana-autonomy',
            registration_revision: '1',
            registration_status: 'active',
            capabilities: ['create_task', 'read_graph']
        },
        company_identity: null,
        company_authority_bindings: [],
        ...overrides
    };
}

function build(overrides = {}) {
    return buildManaAutonomyServiceAuthorityManifest({
        foundation: foundation(),
        placementId: 'mana-autonomy',
        accountablePersonId: 'person_keigo',
        delegatedByPersonId: 'person_keigo',
        validFrom: '2026-08-28T03:00:00.000Z',
        validUntil: '2026-08-29T03:00:00.000Z',
        resourceRevision: '1',
        policyRevision: '1',
        raciRevision: '1',
        ...overrides
    });
}

describe('Mana autonomy service authority manifest', () => {
    it('builds a provisioner-compatible least-privilege manifest with human delegation', () => {
        const manifest = build();
        expect(() => normalizeServiceCompanyAuthorityManifest(manifest)).not.toThrow();
        expect(manifest).toMatchObject({
            version: 'service-company-authority.v1',
            tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            organization_id: 'unson',
            project: {
                project_id: 'proj_brainbase',
                project_code: 'brainbase'
            },
            transport: {
                workspace_id: 'T_UNSON',
                app_id: 'A_MANA'
            },
            service_actor: {
                actor_id: 'mana_autonomy_v0',
                placement_id: 'mana-autonomy',
                bindings: [expect.objectContaining({
                    registry_capability: 'create_task',
                    resource_ref: 'project:brainbase',
                    capability_id: 'task.create',
                    decision: 'auto',
                    allowed_effects: ['write'],
                    accountable_person_id: 'person_keigo',
                    delegated_by_person_id: 'person_keigo'
                })]
            }
        });
        expect(manifest.service_actor.bindings[0].stop_conditions).toEqual([
            'autonomy_kill_switch_active',
            'experiment_window_closed',
            'task_write_budget_exhausted'
        ]);
    });

    it('rejects an absent or mismatched canonical actor and registry capability', () => {
        for (const service_actor of [
            null,
            { ...foundation().service_actor, actor_id: 'other_service' },
            { ...foundation().service_actor, canonical_project_id: 'other_project' },
            { ...foundation().service_actor, placement_id: 'other-placement' },
            { ...foundation().service_actor, capabilities: ['read_graph'] }
        ]) {
            expect(() => build({
                foundation: foundation({ service_actor })
            })).toThrow();
        }
    });

    it('rejects missing human delegation and an authority window longer than the experiment', () => {
        expect(() => build({ accountablePersonId: '' })).toThrow();
        expect(() => build({ delegatedByPersonId: '' })).toThrow();
        expect(() => build({
            validUntil: '2026-08-30T06:00:00.000Z'
        })).toThrowError(expect.objectContaining({ code: 'AUTHORITY_WINDOW_INVALID' }));
    });

    it('rejects inactive tenant, connection, actor and registration', () => {
        const foundations = [
            foundation({ tenant: { ...foundation().tenant, status: 'suspended' } }),
            foundation({ workspace_connection: {
                ...foundation().workspace_connection,
                status: 'revoked'
            } }),
            foundation({ service_actor: {
                ...foundation().service_actor,
                status: 'suspended'
            } }),
            foundation({ service_actor: {
                ...foundation().service_actor,
                registration_status: 'revoked'
            } })
        ];
        for (const value of foundations) {
            expect(() => build({ foundation: value })).toThrow();
        }
    });
});

import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
    normalizeHumanActionAuthorityManifest,
    provisionHumanActionAuthority
} from '../../../../server/services/multitenant/human-action-authority-provisioner.js';
import {
    parseProvisionHumanActionAuthorityArgs,
    runProvisionHumanActionAuthority
} from '../../../../scripts/provision-human-action-authority.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const personId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';
const satoManifestPath = fileURLToPath(new NodeURL(
    '../../../../config/manifests/human-action-authority-sato-brainbase.json', import.meta.url
));

function manifest(overrides = {}) {
    return {
        version: 'human-company-action-authority.v1',
        tenant_id: tenantId,
        organization_id: 'org_techknight_business',
        project: { project_id: 'prj_techknight', project_code: 'techknight' },
        transport: { provider: 'slack', workspace_id: 'T_TECHKNIGHT', app_id: 'A_TECHKNIGHT' },
        humans: [{
            person_id: personId,
            slack_user_id: 'U_KEIGO',
            membership_id: 'human_membership_keigo',
            membership_revision: '1',
            identity_id: 'human_identity_keigo',
            identity_revision: '1',
            placement_id: 'techknight-slack-admin',
            membership_placement_id: 'techknight-slack-admin',
            membership_principal_type: 'person',
            expected_project_codes: ['techknight'],
            bindings: [{
                resource_ref: 'project:techknight',
                capability_id: 'task.read',
                decision: 'auto',
                allowed_effects: ['read'],
                responsible_person_id: personId,
                accountable_person_id: personId,
                approver_person_id: null,
                delegated_by_person_id: personId,
                resource_revision: '1',
                policy_revision: '1',
                raci_revision: '1',
                stop_conditions: [],
                valid_from: '2026-09-06T00:00:00.000Z',
                valid_until: null
            }]
        }],
        ...overrides
    };
}

function baseState() {
    return {
        tenant: { tenant_id: tenantId, tenant_key: 'techknight-business', tenant_revision: 1, status: 'active' },
        organization: {
            organization_id: 'org_techknight_business',
            organization_payload: { status: 'active' }
        },
        project: { project_id: 'prj_techknight', project_code: 'techknight' },
        connections: [{
            connection_id: 'wsc_techknight', connection_revision: 1, provider: 'slack',
            workspace_id: 'T_TECHKNIGHT', app_id: 'A_TECHKNIGHT', status: 'active'
        }],
        memberships: [{
            membership_id: 'human_membership_keigo', organization_id: 'org_techknight_business',
            principal_id: personId,
            membership_payload: {
                status: 'active', revision: '1', principal_type: 'person',
                slack_user_id: 'U_KEIGO', slack_workspace_id: 'T_TECHKNIGHT',
                project_codes: ['techknight'], placement_id: 'techknight-slack-admin'
            }
        }],
        identities: [{
            identity_id: 'human_identity_keigo', identity_revision: 1, provider: 'slack',
            authenticated_subject_id: 'U_KEIGO', workspace_id: 'T_TECHKNIGHT', app_id: 'A_TECHKNIGHT',
            membership_id: 'human_membership_keigo', project_id: 'prj_techknight',
            placement_id: 'techknight-slack-admin', principal_type: 'person', status: 'active'
        }],
        bindings: []
    };
}

function fakeClient(sharedState = baseState()) {
    const state = sharedState;
    const queries = [];
    let snapshot = null;
    const query = async (sql, parameters = []) => {
        const compact = String(sql).replace(/\s+/gu, ' ').trim();
        queries.push({ sql: compact, parameters: structuredClone(parameters) });
        if (compact === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] }; }
        if (compact === 'ROLLBACK') {
            if (snapshot) Object.assign(state, snapshot);
            snapshot = null;
            return { rows: [] };
        }
        if (compact === 'COMMIT') { snapshot = null; return { rows: [] }; }
        if (compact.includes("set_config('brainbase.tenant_id'")) return { rows: [{ set_config: tenantId }] };
        if (compact.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: null }] };
        if (compact.includes('FROM brainbase_tenants')) {
            return { rows: state.tenant.tenant_id === parameters[0] ? [state.tenant] : [] };
        }
        if (compact.includes('FROM tenant_organizations')) {
            return { rows: state.organization.organization_id === parameters[1] ? [state.organization] : [] };
        }
        if (compact.includes('FROM tenant_projects')) {
            return { rows: state.project.project_id === parameters[1]
                && state.project.project_code === parameters[2] ? [state.project] : [] };
        }
        if (compact.includes('FROM workspace_connections')) {
            return { rows: state.connections.filter((row) => row.workspace_id === parameters[1]
                && row.app_id === parameters[2] && row.status === 'active').slice(0, 2) };
        }
        if (compact.includes('FROM tenant_memberships')) {
            return { rows: state.memberships.filter((row) => row.membership_id === parameters[1]
                && row.organization_id === parameters[2]).slice(0, 2) };
        }
        if (compact.includes('FROM company_external_identities')) {
            return { rows: state.identities.filter((row) => row.authenticated_subject_id === parameters[1]
                && row.workspace_id === parameters[2] && row.app_id === parameters[3]
                && row.project_id === parameters[4] && row.status === 'active').slice(0, 2) };
        }
        if (compact.startsWith('SELECT COALESCE(MAX(binding_revision)')) {
            const revisions = state.bindings.filter((row) => row.membership_id === parameters[1]
                && row.organization_id === parameters[2] && row.project_id === parameters[3]
                && row.resource_ref === parameters[4] && row.capability_id === parameters[5])
                .map((row) => Number(row.binding_revision));
            return { rows: [{ max_revision: String(revisions.length ? Math.max(...revisions) : 0) }] };
        }
        if (compact.startsWith('SELECT binding_id') && compact.includes('FROM company_authority_bindings')) {
            return { rows: state.bindings.filter((row) => row.membership_id === parameters[1]
                && row.organization_id === parameters[2] && row.project_id === parameters[3]
                && row.resource_ref === parameters[4] && row.capability_id === parameters[5]
                && row.status === 'active')
                .sort((left, right) => Number(right.binding_revision) - Number(left.binding_revision)).slice(0, 2) };
        }
        if (compact.startsWith('INSERT INTO company_authority_bindings')) {
            state.bindings.push({
                binding_id: parameters[0], binding_revision: parameters[1], membership_id: parameters[4],
                organization_id: parameters[5], project_id: parameters[6], resource_ref: parameters[7],
                resource_revision: parameters[8], capability_id: parameters[9], decision: parameters[10],
                allowed_effects: structuredClone(parameters[11]), responsible_person_id: parameters[12],
                accountable_person_id: parameters[13], approver_person_id: parameters[14],
                delegated_by_person_id: parameters[15], policy_revision: parameters[16],
                raci_revision: parameters[17], stop_conditions: structuredClone(parameters[18]),
                status: 'active', valid_from: parameters[19], valid_until: parameters[20]
            });
            return { rows: [] };
        }
        throw new Error(`unexpected query: ${compact}`);
    };
    return { query, state, queries };
}

describe('human action authority provisioning', () => {
    it('pins the production canary to Sato and excludes Umeda authority', async () => {
        const satoManifest = JSON.parse(await readFile(satoManifestPath, 'utf8'));
        const normalized = normalizeHumanActionAuthorityManifest(satoManifest);
        expect(normalized).toMatchObject({
            tenant_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
            organization_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
            project: {
                project_id: 'prj_01KGCS8CAJKKDWACPNK1E5WX8H', project_code: 'brainbase'
            },
            transport: { provider: 'slack', workspace_id: 'T0882T8N9UH', app_id: 'A0BPM2J33SN' }
        });
        expect(normalized.humans).toHaveLength(1);
        expect(normalized.humans[0]).toMatchObject({
            person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
            slack_user_id: 'U088D1HBY6L',
            membership_id: 'membership:unson-business:U088D1HBY6L',
            membership_revision: '1',
            identity_id: 'human_identity_1e27b72ca1ed8efa5a5d855dccbe8a18',
            identity_revision: '1',
            placement_id: 'unson-sato',
            membership_placement_id: null,
            membership_principal_type: null,
            expected_project_codes: ['brainbase', 'mana']
        });
        expect(normalized.humans[0].bindings).toEqual([expect.objectContaining({
            resource_ref: 'project:prj_01KGCS8CAJKKDWACPNK1E5WX8H',
            capability_id: 'runtime.execute',
            decision: 'auto',
            allowed_effects: ['external_side_effect'],
            responsible_person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
            accountable_person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
            approver_person_id: null,
            delegated_by_person_id: null,
            resource_revision: '1',
            policy_revision: '1',
            raci_revision: '1',
            stop_conditions: [],
            valid_from: '2026-09-05T00:00:00.000Z',
            valid_until: null
        })]);
        expect(normalized.humans.some((human) => human.slack_user_id === 'U0BKP8D3KPD')).toBe(false);
        expect(normalized.humans.some((human) => human.person_id === 'per_01KGYC7NPPE3FTW6SF3K5MCVWK')).toBe(false);
    });

    it('normalizes an exact manifest and rejects duplicate bindings, unknown fields, and secrets', () => {
        const normalized = normalizeHumanActionAuthorityManifest(manifest());
        expect(normalized.humans[0].bindings[0]).toMatchObject({
            capability_id: 'task.read', decision: 'auto', allowed_effects: ['read']
        });
        expect(() => normalizeHumanActionAuthorityManifest({ ...manifest(), unexpected: true }))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_FIELD_FORBIDDEN' }));
        expect(() => normalizeHumanActionAuthorityManifest({ ...manifest(), client_secret: 'hidden' }))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_SECRET_FORBIDDEN' }));
        const duplicated = manifest();
        duplicated.humans[0].bindings.push(structuredClone(duplicated.humans[0].bindings[0]));
        expect(() => normalizeHumanActionAuthorityManifest(duplicated))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
        const reordered = manifest();
        reordered.humans[0].expected_project_codes = ['zeta', 'alpha'];
        expect(normalizeHumanActionAuthorityManifest(reordered).humans[0].expected_project_codes)
            .toEqual(['alpha', 'zeta']);
        const duplicateProjectCode = manifest();
        duplicateProjectCode.humans[0].expected_project_codes = ['techknight', 'techknight'];
        expect(() => normalizeHumanActionAuthorityManifest(duplicateProjectCode))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
        const missingProjectCodes = manifest();
        delete missingProjectCodes.humans[0].expected_project_codes;
        expect(() => normalizeHumanActionAuthorityManifest(missingProjectCodes))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
        const unboundedProjectCodes = manifest();
        unboundedProjectCodes.humans[0].expected_project_codes = Array.from(
            { length: 33 }, (_, index) => `project-${index}`
        );
        expect(() => normalizeHumanActionAuthorityManifest(unboundedProjectCodes))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
        const missingMembershipPlacement = manifest();
        delete missingMembershipPlacement.humans[0].membership_placement_id;
        expect(() => normalizeHumanActionAuthorityManifest(missingMembershipPlacement))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
        const undefinedMembershipPlacement = manifest();
        undefinedMembershipPlacement.humans[0].membership_placement_id = undefined;
        expect(() => normalizeHumanActionAuthorityManifest(undefinedMembershipPlacement))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
        const missingMembershipPrincipalType = manifest();
        delete missingMembershipPrincipalType.humans[0].membership_principal_type;
        expect(() => normalizeHumanActionAuthorityManifest(missingMembershipPrincipalType))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
        const undefinedMembershipPrincipalType = manifest();
        undefinedMembershipPrincipalType.humans[0].membership_principal_type = undefined;
        expect(() => normalizeHumanActionAuthorityManifest(undefinedMembershipPrincipalType))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
        const serviceMembershipPrincipalType = manifest();
        serviceMembershipPrincipalType.humans[0].membership_principal_type = 'service';
        expect(() => normalizeHumanActionAuthorityManifest(serviceMembershipPrincipalType))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
    });

    it('creates and reads back the exact binding during dry-run, then rolls the write back', async () => {
        const client = fakeClient();
        client.state.memberships[0].membership_payload.access_token = 'must-not-appear';
        const result = await provisionHumanActionAuthority({
            client, manifest: manifest(), actorId: 'operator-keigo', commit: false
        });
        expect(result.persisted).toBe(false);
        expect(result.plan).toEqual([expect.objectContaining({
            operation: 'create', entity: 'company_authority_binding', capability_id: 'task.read'
        })]);
        expect(result.snapshot_after.humans[0].bindings).toHaveLength(1);
        expect(JSON.stringify(result)).not.toContain('must-not-appear');
        expect(result.snapshot_after.humans[0].membership.membership_payload).toEqual({
            status: 'active', revision: '1', principal_type: 'person',
            slack_user_id: 'U_KEIGO', slack_workspace_id: 'T_TECHKNIGHT',
            project_codes: ['techknight'], placement_id: 'techknight-slack-admin'
        });
        expect(client.state.bindings).toHaveLength(0);
        expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
    });

    it('commits once, uses a fresh client for post-commit readback, and reruns as noop', async () => {
        const state = baseState();
        let checkouts = 0;
        const pool = {
            connect: vi.fn(async () => {
                checkouts += 1;
                return { ...fakeClient(state), release: vi.fn() };
            })
        };
        const first = await runProvisionHumanActionAuthority({
            argv: ['--apply', '--approve-apply', '--manifest', 'manifest.json'],
            env: { BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' },
            pool,
            readManifest: async () => JSON.stringify(manifest())
        });
        expect(first.persisted).toBe(true);
        expect(first.post_commit_readback.humans[0].bindings).toHaveLength(1);
        expect(checkouts).toBe(2);
        const second = await provisionHumanActionAuthority({
            client: fakeClient(state), manifest: manifest(), actorId: 'operator-keigo', commit: true
        });
        expect(second.plan.every((entry) => entry.operation === 'noop')).toBe(true);
        expect(state.bindings).toHaveLength(1);
    });

    it('fails closed when membership or an existing binding differs from the declaration', async () => {
        const membershipConflict = fakeClient();
        membershipConflict.state.memberships[0].membership_payload.revision = '2';
        await expect(provisionHumanActionAuthority({
            client: membershipConflict, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'MEMBERSHIP_CONFLICT' });
        expect(membershipConflict.state.bindings).toHaveLength(0);

        const bindingConflict = fakeClient();
        await provisionHumanActionAuthority({
            client: bindingConflict, manifest: manifest(), actorId: 'operator-keigo', commit: true
        });
        bindingConflict.state.bindings[0].decision = 'deny';
        await expect(provisionHumanActionAuthority({
            client: bindingConflict, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'HUMAN_AUTHORITY_CONFLICT' });
        expect(bindingConflict.state.bindings).toHaveLength(1);
    });

    it('canonicalizes membership project codes while requiring an exact set', async () => {
        const reordered = manifest();
        reordered.humans[0].expected_project_codes = ['techknight', 'mana'];
        const matching = fakeClient();
        matching.state.memberships[0].membership_payload.project_codes = ['mana', 'techknight'];
        await expect(provisionHumanActionAuthority({
            client: matching, manifest: reordered, actorId: 'operator-keigo', commit: false
        })).resolves.toMatchObject({ persisted: false });

        const mismatch = manifest();
        mismatch.humans[0].expected_project_codes = ['techknight', 'mana'];
        const conflicting = fakeClient();
        conflicting.state.memberships[0].membership_payload.project_codes = ['brainbase', 'techknight'];
        await expect(provisionHumanActionAuthority({
            client: conflicting, manifest: mismatch, actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'MEMBERSHIP_CONFLICT' });
        expect(conflicting.state.bindings).toHaveLength(0);

        const duplicate = fakeClient();
        duplicate.state.memberships[0].membership_payload.project_codes = ['techknight', 'techknight'];
        await expect(provisionHumanActionAuthority({
            client: duplicate, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'MEMBERSHIP_CONFLICT' });
        expect(duplicate.state.bindings).toHaveLength(0);
    });

    it('requires an explicit membership placement contract while preserving identity placement checks', async () => {
        const absentManifest = manifest();
        absentManifest.humans[0].membership_placement_id = null;
        const absentMembership = fakeClient();
        delete absentMembership.state.memberships[0].membership_payload.placement_id;
        const absentResult = await provisionHumanActionAuthority({
            client: absentMembership, manifest: absentManifest, actorId: 'operator-keigo', commit: false
        });
        expect(absentResult).toMatchObject({ persisted: false });
        expect(absentResult.snapshot_after.humans[0].membership.membership_payload.placement_id).toBeNull();
        expect(absentResult.snapshot_after.humans[0].identity.placement_id).toBe('techknight-slack-admin');

        const unexpectedMembershipPlacement = fakeClient();
        unexpectedMembershipPlacement.state.memberships[0].membership_payload.placement_id =
            'unexpected-membership-placement';
        await expect(provisionHumanActionAuthority({
            client: unexpectedMembershipPlacement,
            manifest: absentManifest,
            actorId: 'operator-keigo',
            commit: true
        })).rejects.toMatchObject({ code: 'MEMBERSHIP_CONFLICT' });

        const identityConflict = fakeClient();
        delete identityConflict.state.memberships[0].membership_payload.placement_id;
        identityConflict.state.identities[0].placement_id = 'unexpected-identity-placement';
        await expect(provisionHumanActionAuthority({
            client: identityConflict, manifest: absentManifest, actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'EXTERNAL_IDENTITY_CONFLICT' });
    });

    it('requires an explicit membership principal type while allowing only a declared legacy null', async () => {
        const legacyManifest = manifest();
        legacyManifest.humans[0].membership_principal_type = null;
        const legacyMembership = fakeClient();
        delete legacyMembership.state.memberships[0].membership_payload.principal_type;
        const legacyResult = await provisionHumanActionAuthority({
            client: legacyMembership, manifest: legacyManifest, actorId: 'operator-keigo', commit: false
        });
        expect(legacyResult.snapshot_after.humans[0].membership.membership_payload.principal_type).toBeNull();

        const unexpectedPrincipalType = fakeClient();
        await expect(provisionHumanActionAuthority({
            client: unexpectedPrincipalType, manifest: legacyManifest, actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'MEMBERSHIP_CONFLICT' });
        expect(unexpectedPrincipalType.state.bindings).toHaveLength(0);
    });

    it('fails closed when more than one active binding matches the natural key', async () => {
        const client = fakeClient();
        client.state.bindings.push(
            {
                binding_id: 'human_binding_duplicate_a', binding_revision: '1', membership_id: 'human_membership_keigo',
                organization_id: 'org_techknight_business', project_id: 'prj_techknight', resource_ref: 'project:techknight',
                resource_revision: '1', capability_id: 'task.read', decision: 'auto', allowed_effects: ['read'],
                responsible_person_id: personId, accountable_person_id: personId, approver_person_id: null,
                delegated_by_person_id: personId, policy_revision: '1', raci_revision: '1', stop_conditions: [],
                status: 'active', valid_from: '2026-09-06T00:00:00.000Z', valid_until: null
            },
            {
                binding_id: 'human_binding_duplicate_b', binding_revision: '2', membership_id: 'human_membership_keigo',
                organization_id: 'org_techknight_business', project_id: 'prj_techknight', resource_ref: 'project:techknight',
                resource_revision: '1', capability_id: 'task.read', decision: 'auto', allowed_effects: ['read'],
                responsible_person_id: personId, accountable_person_id: personId, approver_person_id: null,
                delegated_by_person_id: personId, policy_revision: '1', raci_revision: '1', stop_conditions: [],
                status: 'active', valid_from: '2026-09-06T00:00:00.000Z', valid_until: null
            }
        );
        await expect(provisionHumanActionAuthority({
            client, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'HUMAN_AUTHORITY_AMBIGUOUS' });
        expect(client.state.bindings).toHaveLength(2);
        expect(client.queries.map(({ sql }) => sql)).toContain('ROLLBACK');
    });

    it('fails closed when a stored binding revision cannot be incremented safely', async () => {
        const revisionRow = {
            membership_id: 'human_membership_keigo', organization_id: 'org_techknight_business',
            project_id: 'prj_techknight', resource_ref: 'project:techknight', capability_id: 'task.read',
            status: 'inactive'
        };
        const unsafe = fakeClient();
        unsafe.state.bindings.push({ ...revisionRow, binding_revision: '9007199254740992' });
        await expect(provisionHumanActionAuthority({
            client: unsafe, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'AUTHORITY_REVISION_INVALID' });

        const maxed = fakeClient();
        maxed.state.bindings.push({ ...revisionRow, binding_revision: String(Number.MAX_SAFE_INTEGER) });
        await expect(provisionHumanActionAuthority({
            client: maxed, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'AUTHORITY_REVISION_INVALID' });
    });

    it('rejects an inactive organization before planning a binding', async () => {
        const client = fakeClient();
        client.state.organization.organization_payload.status = 'inactive';
        await expect(provisionHumanActionAuthority({
            client, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'ORGANIZATION_INACTIVE' });
        expect(client.state.bindings).toHaveLength(0);
    });

    it('requires one mode, explicit apply approval, and an apply actor', () => {
        expect(() => parseProvisionHumanActionAuthorityArgs(['--check', '--dry-run', '--manifest', 'm.json']))
            .toThrowError(expect.objectContaining({ code: 'ARGUMENT_INVALID' }));
        expect(() => parseProvisionHumanActionAuthorityArgs(['--apply', '--manifest', 'm.json'], {}))
            .toThrowError(expect.objectContaining({ code: 'APPLY_APPROVAL_REQUIRED' }));
        expect(() => parseProvisionHumanActionAuthorityArgs(
            ['--apply', '--approve-apply', '--manifest', 'm.json'], {}
        )).toThrowError(expect.objectContaining({ code: 'ACTOR_REQUIRED' }));
        expect(parseProvisionHumanActionAuthorityArgs(
            ['--apply', '--approve-apply', '--manifest', 'm.json'],
            { BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' }
        )).toMatchObject({ mode: 'apply', actorId: 'operator-keigo' });
    });
});

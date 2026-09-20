import { describe, expect, it } from 'vitest';
import {
    normalizeLegacyOrganizationAuthorityBridgeManifest,
    provisionLegacyOrganizationAuthorityBridge,
    readbackLegacyOrganizationAuthorityBridge
} from '../../../../server/services/multitenant/legacy-organization-authority-bridge.js';

const manifest = {
    version: 'legacy-organization-authority-bridge.v1', tenant_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
    organization_id: 'unson', tenant_organization_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
    project_id: 'prj_01KGCS8BC76XRHFCHRRQ8G25MY', project_code: 'baao',
    person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5', slack_user_id: 'U07LNUP582X', slack_workspace_id: 'T07LL5WV7N1'
};

function client({ grantProjects = ['baao', 'brainbase'], grantClearance = ['internal'], existingProjectPayload = null, existingOrganizationPayload = null, existingLegacyAlias = false, legacyAliasTenantId = manifest.tenant_id, existingMembership = null } = {}) {
    const inserted = { project: false, organization: false, membership: false };
    const queries = [];
    const stored = {
        project: existingProjectPayload ? {
            project_id: manifest.project_id,
            tenant_id: manifest.tenant_id,
            project_code: manifest.project_code,
            project_payload: existingProjectPayload
        } : null,
        organization: existingOrganizationPayload ? {
            organization_id: manifest.tenant_organization_id,
            tenant_id: manifest.tenant_id,
            organization_payload: existingOrganizationPayload
        } : null,
        legacyAlias: existingLegacyAlias ? {
            organization_id: manifest.organization_id,
            tenant_id: legacyAliasTenantId,
            organization_payload: { status: 'active', project_code: 'unson' }
        } : null,
        membership: existingMembership
    };
    const query = async (sql, params = []) => {
        const compact = sql.replace(/\s+/gu, ' ').trim();
        queries.push({ compact, params });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact) || compact.includes('set_config') || compact.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (compact.includes('FROM brainbase_tenants')) return { rows: [{ tenant_id: manifest.tenant_id, tenant_key: 'unson-business', tenant_revision: 1, status: 'active' }] };
        if (compact.includes('FROM organizations')) return { rows: [{ id: 'unson' }] };
        if (compact.includes('FROM projects')) return { rows: [{ id: manifest.project_id, code: 'baao' }] };
        if (compact.includes('FROM people')) return { rows: [{ id: manifest.person_id }] };
        if (compact.includes('FROM auth_grants')) return { rows: [{ id: 'grant_1', person_id: manifest.person_id, role: 'ceo', project_codes: grantProjects, clearance: grantClearance }] };
        if (compact.startsWith('INSERT INTO tenant_projects')) { inserted.project = true; stored.project = { project_id: params[0], tenant_id: params[1], project_code: params[3], project_payload: JSON.parse(params[4]) }; return { rows: [] }; }
        if (compact.startsWith('INSERT INTO tenant_organizations')) { inserted.organization = true; stored.organization = { organization_id: params[0], tenant_id: params[1], organization_payload: JSON.parse(params[3]) }; return { rows: [] }; }
        if (compact.startsWith('UPDATE tenant_organizations')) { stored.organization.organization_payload = { ...stored.organization.organization_payload, ...JSON.parse(params[1]) }; return { rows: [] }; }
        if (compact.startsWith('INSERT INTO tenant_memberships')) { inserted.membership = true; stored.membership = { membership_id: params[0], tenant_id: params[1], organization_id: params[3], principal_id: params[4], membership_payload: JSON.parse(params[5]) }; return { rows: [] }; }
        if (compact.includes('FROM tenant_projects') && compact.includes(' OR ')) return { rows: stored.project ? [stored.project] : [] };
        if (compact.includes('FROM tenant_organizations')) return { rows: [stored.organization, stored.legacyAlias].filter(Boolean) };
        if (compact.includes('FROM tenant_memberships') && compact.includes('FOR UPDATE')) return { rows: stored.membership ? [stored.membership] : [] };
        if (compact.includes('resolve_active_tenant_for_organization')) return { rows: [{ tenant_id: manifest.tenant_id, organization_id: 'unson' }] };
        if (compact.includes('FROM tenant_projects')) return { rows: stored.project ? [{ project_id: stored.project.project_id, project_code: stored.project.project_code }] : [] };
        if (compact.includes('FROM tenant_memberships')) return { rows: stored.membership ? [{ membership_id: stored.membership.membership_id, principal_id: stored.membership.principal_id, membership_payload: stored.membership.membership_payload }] : [] };
        throw new Error(`Unexpected query: ${compact} ${JSON.stringify(params)}`);
    };
    return { query, inserted, queries };
}

describe('legacy organization authority bridge', () => {
    it('rejects secret-like fields and invalid canonical tenant ids', () => {
        expect(() => normalizeLegacyOrganizationAuthorityBridgeManifest({ ...manifest, access_token: 'x' })).toThrowError(expect.objectContaining({ code: 'MANIFEST_SECRET_FORBIDDEN' }));
        expect(() => normalizeLegacyOrganizationAuthorityBridgeManifest({ ...manifest, tenant_id: 'unson' })).toThrowError(expect.objectContaining({ code: 'MANIFEST_INVALID' }));
    });

    it('preserves the existing grant scope while creating only tenant projections', async () => {
        const db = client();
        const result = await provisionLegacyOrganizationAuthorityBridge({ client: db, manifest, actorId: 'operator-keigo', commit: false });
        expect(result.persisted).toBe(false);
        expect(result.plan.map((entry) => entry.entity)).toEqual(['tenant_project', 'tenant_organization', 'tenant_membership']);
        expect(db.inserted).toEqual({ project: true, organization: true, membership: true });
    });

    it('stops when the existing grant does not include the requested project', async () => {
        await expect(provisionLegacyOrganizationAuthorityBridge({ client: client({ grantProjects: ['brainbase'] }), manifest, actorId: 'operator-keigo' }))
            .rejects.toMatchObject({ code: 'AUTH_GRANT_SCOPE_MISMATCH' });
    });

    it('is idempotent when the exact projection already exists', async () => {
        const db = client();
        await provisionLegacyOrganizationAuthorityBridge({ client: db, manifest, actorId: 'operator-keigo', commit: true });
        const repeated = await provisionLegacyOrganizationAuthorityBridge({ client: db, manifest, actorId: 'operator-keigo', commit: true });
        expect(repeated.plan).toEqual([
            { operation: 'noop', entity: 'tenant_project', id: manifest.project_id },
            { operation: 'noop', entity: 'tenant_organization', id: manifest.tenant_organization_id },
            expect.objectContaining({ operation: 'noop', entity: 'tenant_membership' })
        ]);
    });

    it('reuses an existing canonical project projection without rewriting its provenance', async () => {
        const db = client({ existingProjectPayload: { source: 'approved_meeting_minutes_projection', project_code: 'baao' } });
        const result = await provisionLegacyOrganizationAuthorityBridge({ client: db, manifest, actorId: 'operator-keigo', commit: true });
        expect(result.plan[0]).toEqual({ operation: 'noop', entity: 'tenant_project', id: manifest.project_id });
        expect(db.inserted.project).toBe(false);
    });

    it('rejects an existing project projection whose payload points to another project code', async () => {
        const db = client({ existingProjectPayload: { source: 'approved_meeting_minutes_projection', project_code: 'other' } });
        await expect(provisionLegacyOrganizationAuthorityBridge({ client: db, manifest, actorId: 'operator-keigo', commit: true }))
            .rejects.toMatchObject({ code: 'TENANT_PROJECT_CONFLICT' });
    });

    it('enriches an existing tenant organization with the legacy Graph organization mapping', async () => {
        const db = client({ existingOrganizationPayload: { status: 'active', display_name: 'Unson Business' } });
        const result = await provisionLegacyOrganizationAuthorityBridge({ client: db, manifest, actorId: 'operator-keigo', commit: true });
        expect(result.plan[1]).toEqual({ operation: 'update', entity: 'tenant_organization', id: manifest.tenant_organization_id });
        expect(result.readback.resolved_tenant).toEqual({ tenant_id: manifest.tenant_id, organization_id: 'unson' });
    });

    it('reuses an existing legacy organization alias instead of creating a duplicate Graph mapping', async () => {
        const db = client({
            existingOrganizationPayload: { status: 'active', display_name: 'Unson Business' },
            existingLegacyAlias: true
        });
        const result = await provisionLegacyOrganizationAuthorityBridge({ client: db, manifest, actorId: 'operator-keigo', commit: true });
        expect(result.plan[1]).toEqual({ operation: 'noop', entity: 'tenant_organization', id: manifest.tenant_organization_id });
        expect(result.readback.resolved_tenant).toEqual({ tenant_id: manifest.tenant_id, organization_id: 'unson' });
        expect(db.inserted.organization).toBe(false);
    });

    it('creates a canonical organization without a duplicate Graph mapping when the legacy alias already exists', async () => {
        const db = client({ existingLegacyAlias: true });
        const result = await provisionLegacyOrganizationAuthorityBridge({ client: db, manifest, actorId: 'operator-keigo', commit: true });
        expect(result.plan[1]).toEqual({ operation: 'create', entity: 'tenant_organization', id: manifest.tenant_organization_id });
        expect(db.inserted.organization).toBe(true);
    });

    it('rejects a legacy organization alias owned by another tenant', async () => {
        await expect(provisionLegacyOrganizationAuthorityBridge({
            client: client({ existingOrganizationPayload: { status: 'active' }, existingLegacyAlias: true, legacyAliasTenantId: 'ten_01M0HMA228ES64N4TFX846V8T9' }),
            manifest,
            actorId: 'operator-keigo',
            commit: true
        })).rejects.toMatchObject({ code: 'TENANT_ORGANIZATION_CONFLICT' });
    });

    it('rejects a tenant organization already mapped to another Graph organization', async () => {
        const db = client({ existingOrganizationPayload: { status: 'active', graph_organization_id: 'other' } });
        await expect(provisionLegacyOrganizationAuthorityBridge({ client: db, manifest, actorId: 'operator-keigo', commit: true }))
            .rejects.toMatchObject({ code: 'TENANT_ORGANIZATION_CONFLICT' });
    });

    it('reuses an active canonical membership for the same person and project without replacing its Slack identity', async () => {
        const canonicalMembership = {
            membership_id: 'membership:unson-business:U088D1HBY6L',
            tenant_id: manifest.tenant_id,
            organization_id: manifest.tenant_organization_id,
            principal_id: manifest.person_id,
            membership_payload: {
                status: 'active', principal_type: 'person', tenant_role: 'tenant_admin',
                project_codes: ['brainbase', 'baao'], clearance: ['internal'],
                slack_user_id: 'U088D1HBY6L', slack_workspace_id: 'T0882T8N9UH'
            }
        };
        const db = client({
            grantClearance: ['internal', 'restricted', 'finance', 'hr', 'contract'],
            existingMembership: canonicalMembership
        });
        const result = await provisionLegacyOrganizationAuthorityBridge({ client: db, manifest, actorId: 'operator-keigo', commit: true });
        expect(result.plan[2]).toEqual({ operation: 'noop', entity: 'tenant_membership', id: canonicalMembership.membership_id });
        expect(db.inserted.membership).toBe(false);
    });

    it('rejects a canonical membership whose clearance exceeds the legacy grant', async () => {
        const existingMembership = {
            membership_id: 'membership:unson-business:U088D1HBY6L',
            tenant_id: manifest.tenant_id,
            organization_id: manifest.tenant_organization_id,
            principal_id: manifest.person_id,
            membership_payload: {
                status: 'active', principal_type: 'person', tenant_role: 'tenant_admin',
                project_codes: ['brainbase', 'baao'], clearance: ['internal', 'finance']
            }
        };
        await expect(provisionLegacyOrganizationAuthorityBridge({ client: client({ existingMembership }), manifest, actorId: 'operator-keigo', commit: true }))
            .rejects.toMatchObject({ code: 'TENANT_MEMBERSHIP_CONFLICT' });
    });

    it('rejects an existing membership that does not authorize the requested project', async () => {
        const existingMembership = {
            membership_id: 'membership:unson-business:U088D1HBY6L',
            tenant_id: manifest.tenant_id,
            organization_id: manifest.tenant_organization_id,
            principal_id: manifest.person_id,
            membership_payload: {
                status: 'active', principal_type: 'person', tenant_role: 'tenant_admin',
                project_codes: ['brainbase'], clearance: ['internal']
            }
        };
        await expect(provisionLegacyOrganizationAuthorityBridge({ client: client({ existingMembership }), manifest, actorId: 'operator-keigo', commit: true }))
            .rejects.toMatchObject({ code: 'TENANT_MEMBERSHIP_CONFLICT' });
    });

    it('sets tenant context in a transaction before independent post-commit readback', async () => {
        const canonicalMembership = {
            membership_id: 'membership:unson-business:U088D1HBY6L',
            tenant_id: manifest.tenant_id,
            organization_id: manifest.tenant_organization_id,
            principal_id: manifest.person_id,
            membership_payload: {
                status: 'active', principal_type: 'person', tenant_role: 'tenant_admin',
                project_codes: ['brainbase', 'baao'], clearance: ['internal']
            }
        };
        const db = client({
            existingProjectPayload: { source: 'approved_meeting_minutes_projection', project_code: 'baao' },
            existingOrganizationPayload: { status: 'active' },
            existingLegacyAlias: true,
            existingMembership: canonicalMembership
        });

        const result = await readbackLegacyOrganizationAuthorityBridge({ client: db, manifest });

        expect(result.resolved_tenant).toEqual({ tenant_id: manifest.tenant_id, organization_id: 'unson' });
        expect(db.queries[0]).toEqual({ compact: 'BEGIN', params: [] });
        expect(db.queries[1]).toEqual({
            compact: "SELECT set_config('brainbase.tenant_id',$1,true)",
            params: [manifest.tenant_id]
        });
        expect(db.queries.at(-1)).toEqual({ compact: 'COMMIT', params: [] });
    });
});

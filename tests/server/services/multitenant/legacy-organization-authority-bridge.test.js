import { describe, expect, it } from 'vitest';
import {
    normalizeLegacyOrganizationAuthorityBridgeManifest,
    provisionLegacyOrganizationAuthorityBridge
} from '../../../../server/services/multitenant/legacy-organization-authority-bridge.js';

const manifest = {
    version: 'legacy-organization-authority-bridge.v1', tenant_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
    organization_id: 'unson', tenant_organization_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
    project_id: 'prj_01KGCS8BC76XRHFCHRRQ8G25MY', project_code: 'baao',
    person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5', slack_user_id: 'U07LNUP582X', slack_workspace_id: 'T07LL5WV7N1'
};

function client({ grantProjects = ['baao', 'brainbase'] } = {}) {
    const inserted = { project: false, organization: false, membership: false };
    const stored = { project: null, organization: null, membership: null };
    const query = async (sql, params = []) => {
        const compact = sql.replace(/\s+/gu, ' ').trim();
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact) || compact.includes('set_config') || compact.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (compact.includes('FROM brainbase_tenants')) return { rows: [{ tenant_id: manifest.tenant_id, tenant_key: 'unson-business', tenant_revision: 1, status: 'active' }] };
        if (compact.includes('FROM organizations')) return { rows: [{ id: 'unson' }] };
        if (compact.includes('FROM projects')) return { rows: [{ id: manifest.project_id, code: 'baao' }] };
        if (compact.includes('FROM people')) return { rows: [{ id: manifest.person_id }] };
        if (compact.includes('FROM auth_grants')) return { rows: [{ id: 'grant_1', person_id: manifest.person_id, role: 'ceo', project_codes: grantProjects, clearance: ['internal'] }] };
        if (compact.startsWith('INSERT INTO tenant_projects')) { inserted.project = true; stored.project = { project_id: params[0], tenant_id: params[1], project_code: params[3], project_payload: JSON.parse(params[4]) }; return { rows: [] }; }
        if (compact.startsWith('INSERT INTO tenant_organizations')) { inserted.organization = true; stored.organization = { organization_id: params[0], tenant_id: params[1], organization_payload: JSON.parse(params[3]) }; return { rows: [] }; }
        if (compact.startsWith('INSERT INTO tenant_memberships')) { inserted.membership = true; stored.membership = { membership_id: params[0], tenant_id: params[1], organization_id: params[3], principal_id: params[4], membership_payload: JSON.parse(params[5]) }; return { rows: [] }; }
        if (compact.includes('FROM tenant_projects') && compact.includes(' OR ')) return { rows: stored.project ? [stored.project] : [] };
        if (compact.includes('FROM tenant_organizations')) return { rows: stored.organization ? [stored.organization] : [] };
        if (compact.includes('FROM tenant_memberships') && compact.includes('FOR UPDATE')) return { rows: stored.membership ? [stored.membership] : [] };
        if (compact.includes('resolve_active_tenant_for_organization')) return { rows: [{ tenant_id: manifest.tenant_id, organization_id: 'unson' }] };
        if (compact.includes('FROM tenant_projects')) return { rows: stored.project ? [{ project_id: stored.project.project_id, project_code: stored.project.project_code }] : [] };
        if (compact.includes('FROM tenant_memberships')) return { rows: stored.membership ? [{ membership_id: stored.membership.membership_id, principal_id: stored.membership.principal_id, membership_payload: stored.membership.membership_payload }] : [] };
        throw new Error(`Unexpected query: ${compact} ${JSON.stringify(params)}`);
    };
    return { query, inserted };
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
});

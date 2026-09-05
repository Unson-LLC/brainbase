import { describe, expect, it, vi } from 'vitest';
import { PgProjectProvisioningRepository } from '../../../server/services/project-provisioning/project-provisioning-repository.js';

describe('PgProjectProvisioningRepository', () => {
    it('read-only project check does not execute schema DDL', async () => {
        const query = vi.fn(async () => ({ rows: [] }));
        const repository = new PgProjectProvisioningRepository({ pool: { query } });

        await expect(repository.getProject('growin-ai', 'org_a')).resolves.toBeNull();

        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toMatch(/^SELECT /u);
        expect(query.mock.calls[0][1]).toEqual(['growin-ai', 'org_a']);
    });

    it('run lookup is scoped by organization', async () => {
        const query = vi.fn(async () => ({ rows: [] }));
        const repository = new PgProjectProvisioningRepository({ pool: { query } });

        await repository.getRun('ppr_1', 'org_a');

        expect(query.mock.calls[0][0]).toContain('r.organization_id = $2');
        expect(query.mock.calls[0][1]).toEqual(['ppr_1', 'org_a']);
    });

    it('cross-organization code collision uses the sanitized global claim function', async () => {
        const query = vi.fn(async () => ({ rows: [{ source: 'project_code_claim', code: 'growin-ai' }] }));
        const repository = new PgProjectProvisioningRepository({ pool: { query } });

        await expect(repository.findProjectCodeCollision('growin-ai', 'org_a')).resolves.toEqual([
            { source: 'project_code_claim', code: 'growin-ai' }
        ]);

        expect(query.mock.calls[0][0]).toBe('SELECT source, code FROM project_code_collision_sources($1,$2)');
        expect(query.mock.calls[0][1]).toEqual(['growin-ai', 'org_a']);
    });

    it('Graph同一ID probeはstandaloneでも明示Graph accessでInfoSSOT contextを設定する', async () => {
        const row = {
            scope_relation: 'same_organization', entity_id: 'growin-ai',
            entity_type: 'project', project_code: 'brainbase'
        };
        const poolQuery = vi.fn(async () => ({ rows: [] }));
        const scopedQuery = vi.fn(async () => ({ rows: [row] }));
        const withAccessContext = vi.fn(async (_access, handler) => handler({ query: scopedQuery }));
        const repository = new PgProjectProvisioningRepository({
            pool: { query: poolQuery }, infoSSOTService: { withAccessContext }
        });
        const access = {
            role: 'gm', projectCodes: ['brainbase', 'growin-ai'],
            clearance: ['internal'], organizationId: 'org_a'
        };

        await expect(repository.findProjectSubjectIdentity('growin-ai', 'org_a', { access }))
            .resolves.toEqual(row);

        expect(withAccessContext).toHaveBeenCalledWith(access, expect.any(Function));
        expect(scopedQuery.mock.calls[0][0]).toBe('SELECT * FROM project_graph_identity_probe($1)');
        expect(scopedQuery.mock.calls[0][1]).toEqual(['growin-ai']);
        expect(poolQuery).not.toHaveBeenCalled();
    });

    it('Graph同一ID probeはshared clientでも同じclientへ明示Graph contextを設定する', async () => {
        const row = {
            scope_relation: 'same_organization', entity_id: 'growin-ai',
            entity_type: 'project', project_code: 'brainbase'
        };
        const poolQuery = vi.fn(async () => ({ rows: [] }));
        const sharedQuery = vi.fn(async () => ({ rows: [row] }));
        const sharedClient = { query: sharedQuery };
        const withAccessContext = vi.fn(async (_access, handler, { client } = {}) => handler(client));
        const repository = new PgProjectProvisioningRepository({
            pool: { query: poolQuery }, infoSSOTService: { withAccessContext }
        });
        const access = {
            role: 'gm', projectCodes: ['brainbase', 'growin-ai'],
            clearance: ['internal'], organizationId: 'org_a'
        };

        await expect(repository.findProjectSubjectIdentity('growin-ai', 'org_a', {
            access, client: sharedClient
        })).resolves.toEqual(row);

        expect(withAccessContext).toHaveBeenCalledWith(access, expect.any(Function), { client: sharedClient });
        expect(sharedQuery.mock.calls[0][0]).toBe('SELECT * FROM project_graph_identity_probe($1)');
        expect(sharedQuery.mock.calls[0][1]).toEqual(['growin-ai']);
        expect(poolQuery).not.toHaveBeenCalled();
    });

    it('organization entity authority readback is joined to the authenticated organization', async () => {
        const query = vi.fn(async (sql) => {
            if (sql.includes('FROM organizations WHERE')) return { rows: [{ id: 'org_a' }] };
            if (sql.includes('FROM people WHERE')) return { rows: [{ id: 'person_owner' }] };
            if (sql.includes('JOIN projects p')) return { rows: [{ id: 'org_entity' }] };
            if (sql.includes('FROM auth_grants')) return { rows: [{ id: 'grant_1' }] };
            return { rows: [] };
        });
        const repository = new PgProjectProvisioningRepository({ pool: { query } });

        await expect(repository.verifyManifestAuthority({
            organization_entity_id: 'org_entity', owner_person_id: 'person_owner'
        }, { organizationId: 'org_a' })).resolves.toEqual({
            organization_exists: true,
            owner_person_exists: true,
            organization_entity_exists: true,
            owner_has_organization_grant: true
        });

        const graphCall = query.mock.calls.find(([sql]) => sql.includes('JOIN projects p'));
        expect(graphCall[0]).toContain('JOIN organizations o ON o.id=p.organization_id');
        expect(graphCall[0]).toContain('p.organization_id=$2');
        expect(graphCall[0]).toContain('o.id=$2');
        expect(graphCall[1]).toEqual(['org_entity', 'org_a']);
    });

    it('cross-organization graph entity is not accepted as organization authority', async () => {
        const query = vi.fn(async (sql) => {
            if (sql.includes('JOIN projects p')) return { rows: [] };
            if (sql.includes('FROM organizations WHERE')) return { rows: [{ id: 'org_a' }] };
            if (sql.includes('FROM people WHERE')) return { rows: [{ id: 'person_owner' }] };
            if (sql.includes('FROM auth_grants')) return { rows: [{ id: 'grant_1' }] };
            return { rows: [] };
        });
        const repository = new PgProjectProvisioningRepository({ pool: { query } });

        await expect(repository.verifyManifestAuthority({
            organization_entity_id: 'org_from_other_org', owner_person_id: 'person_owner'
        }, { organizationId: 'org_a' })).resolves.toMatchObject({
            organization_exists: true,
            owner_person_exists: true,
            organization_entity_exists: false,
            owner_has_organization_grant: true
        });
    });

    it('organization entity authority readback keeps the authenticated Graph scope', async () => {
        const query = vi.fn(async (sql) => {
            if (sql.includes('JOIN projects p')) return { rows: [{ id: 'org_entity' }] };
            if (sql.includes('FROM organizations WHERE')) return { rows: [{ id: 'org_a' }] };
            if (sql.includes('FROM people WHERE')) return { rows: [{ id: 'person_owner' }] };
            if (sql.includes('FROM auth_grants')) return { rows: [{ id: 'grant_1' }] };
            return { rows: [] };
        });
        const withAccessContext = vi.fn(async (_access, handler) => handler({ query }));
        const repository = new PgProjectProvisioningRepository({
            pool: { query }, infoSSOTService: { withAccessContext }
        });

        await expect(repository.verifyManifestAuthority({
            organization_entity_id: 'org_entity', owner_person_id: 'person_owner'
        }, {
            organizationId: 'org_a', role: 'gm', projectCodes: ['brainbase'], clearance: ['internal']
        })).resolves.toMatchObject({ organization_entity_exists: true });

        expect(withAccessContext).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'org_a', role: 'gm', projectCodes: ['brainbase'], clearance: ['internal']
        }), expect.any(Function));
    });

    it('Graph access contextがない場合は同名衝突を生DBで照会しない', async () => {
        const query = vi.fn(async () => ({ rows: [] }));
        const repository = new PgProjectProvisioningRepository({ pool: { query } });

        await expect(repository.findIdentityCollisions({
            project_code: 'growin-ai', display_name: 'Growin AI'
        }, { organizationId: 'org_a' })).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_GRAPH_CONTEXT_REQUIRED',
            statusCode: 409
        });
        expect(query).not.toHaveBeenCalled();
    });

    it('resumeだけが5分以上staleなapplying runを原子的に再claimできる', async () => {
        const query = vi.fn(async (sql) => ({
            rows: sql.startsWith('UPDATE project_provisioning_runs') ? [{ run_id: 'ppr_1' }] : []
        }));
        const repository = new PgProjectProvisioningRepository({ pool: { query } });
        repository.getRun = vi.fn(async () => ({ run_id: 'ppr_1', state: 'applying' }));

        await repository.claimRun('ppr_1', 'org_a', { recoverStaleApplying: true });

        expect(query.mock.calls[0][0]).toContain("state='applying' AND updated_at < now() - interval '5 minutes'");
        expect(query.mock.calls[0][1]).toEqual(['ppr_1', 'org_a', true]);
    });

    it('古いexecution tokenではstepとrun stateを更新できない', async () => {
        const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
        const repository = new PgProjectProvisioningRepository({ pool: { query } });

        await expect(repository.setStep('ppr_1', 'org_a', 'graph', 'completed', {
            executionToken: 'stale-token'
        })).rejects.toMatchObject({ code: 'PROJECT_PROVISIONING_EXECUTION_LEASE_LOST' });
        await expect(repository.setRunState('ppr_1', 'org_a', 'active', {
            executionToken: 'stale-token'
        })).rejects.toMatchObject({ code: 'PROJECT_PROVISIONING_EXECUTION_LEASE_LOST' });
    });

    it('heartbeatは現在のexecution tokenだけを延長する', async () => {
        const query = vi.fn(async () => ({ rows: [{ run_id: 'ppr_1' }], rowCount: 1 }));
        const repository = new PgProjectProvisioningRepository({ pool: { query } });

        await repository.heartbeatRun('ppr_1', 'org_a', 'current-token');

        expect(query.mock.calls[0][0]).toContain("state='applying' AND execution_token=$3");
        expect(query.mock.calls[0][1]).toEqual(['ppr_1', 'org_a', 'current-token']);
    });
});

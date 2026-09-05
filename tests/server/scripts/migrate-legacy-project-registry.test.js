import { describe, expect, it, vi } from 'vitest';

import {
    parseLegacyProjectRegistryArgs,
    runLegacyProjectRegistryMigration
} from '../../../scripts/migrate-legacy-project-registry.js';

const entry = (overrides = {}) => ({
    project_code: 'legacy-app',
    organization_id: 'unson',
    kind: 'product',
    session_select: true,
    organization_entity_id: 'unson',
    owner_person_id: 'per_owner',
    repository: { mode: 'none' },
    ...overrides
});

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createPool({
    projects = [{ id: 'project_legacy_app', code: 'legacy-app', name: 'Legacy App', organization_id: null }],
    claims = [{ project_code: 'legacy-app', organization_id: '__unassigned__' }],
    registries = [],
    authority = {}
} = {}) {
    const state = { projects: clone(projects), claims: clone(claims), registries: clone(registries) };
    const missingAuthority = new Set(authority.missing || []);
    let transactionSnapshot = null;
    const queries = [];
    const query = vi.fn(async (text, values = []) => {
        const sql = String(text).replaceAll(/\s+/gu, ' ').trim();
        queries.push({ sql, values });
        if (sql === 'BEGIN') {
            transactionSnapshot = clone(state);
            return { rows: [] };
        }
        if (sql === 'COMMIT') {
            transactionSnapshot = null;
            return { rows: [] };
        }
        if (sql === 'ROLLBACK') {
            if (transactionSnapshot) {
                state.projects = transactionSnapshot.projects;
                state.claims = transactionSnapshot.claims;
                state.registries = transactionSnapshot.registries;
            }
            transactionSnapshot = null;
            return { rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (sql.startsWith("SELECT set_config('app.role'")) return { rows: [] };
        if (sql.startsWith("SELECT set_config('app.project_codes'")) return { rows: [] };
        if (sql.startsWith("SELECT set_config('app.clearance'")) return { rows: [] };
        if (sql === "SELECT set_config('app.organization_id',$1,true)") return { rows: [{ set_config: values[0] }] };
        if (sql.startsWith('SELECT id FROM organizations WHERE id=')) {
            return { rows: missingAuthority.has('organization') ? [] : [{ id: values[0] }] };
        }
        if (sql.startsWith("SELECT id FROM people WHERE id=")) {
            return { rows: missingAuthority.has('owner') ? [] : [{ id: values[0] }] };
        }
        if (sql.startsWith('SELECT ge.id FROM graph_entities ge JOIN projects p')) {
            return { rows: missingAuthority.has('organization_entity') ? [] : [{ id: values[0] }] };
        }
        if (sql.startsWith('SELECT ag.id FROM auth_grants ag JOIN organizations o')) {
            return { rows: missingAuthority.has('grant') ? [] : [{ id: 'grant_1' }] };
        }
        if (sql.startsWith('SELECT id, code, name, organization_id FROM projects')) {
            return { rows: state.projects.filter((project) => project.code === values[0]).map(clone) };
        }
        if (sql.startsWith('SELECT project_code, organization_id FROM project_code_claims')) {
            return { rows: state.claims.filter((claim) => claim.project_code === values[0]).map(clone) };
        }
        if (sql.startsWith('SELECT project_code, organization_id, display_name, kind, catalog_version')) {
            return { rows: state.registries.filter((registry) => registry.project_code === values[0]).map(clone) };
        }
        if (sql.startsWith('UPDATE projects SET organization_id=')) {
            const project = state.projects.find((candidate) => candidate.code === values[0]);
            if (!project || (project.organization_id !== null && project.organization_id !== '')) return { rows: [], rowCount: 0 };
            project.organization_id = values[1];
            return { rows: [{ code: project.code, organization_id: project.organization_id }], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE project_code_claims SET organization_id=')) {
            const claim = state.claims.find((candidate) => candidate.project_code === values[0]);
            if (!claim || claim.organization_id !== '__unassigned__') return { rows: [], rowCount: 0 };
            claim.organization_id = values[1];
            return { rows: [{ project_code: claim.project_code, organization_id: claim.organization_id }], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO project_registry')) {
            const [project_code, organization_id, display_name, kind, catalog_version,
                lifecycle_status, session_select, organization_entity_id, owner_person_id, repository] = values;
            state.registries.push({ project_code, organization_id, display_name, kind, catalog_version,
                lifecycle_status, session_select, organization_entity_id, owner_person_id,
                repository: JSON.parse(repository) });
            return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('SELECT p.code, p.organization_id AS project_organization_id')) {
            const project = state.projects.find((candidate) => candidate.code === values[0]);
            const claim = state.claims.find((candidate) => candidate.project_code === values[0]);
            const registry = state.registries.find((candidate) => candidate.project_code === values[0]);
            return {
                rows: project ? [{
                    code: project.code,
                    project_organization_id: project.organization_id,
                    claim_organization_id: claim?.organization_id || null,
                    ...(registry || {
                        project_code: null,
                        organization_id: null,
                        display_name: null,
                        kind: null,
                        catalog_version: null,
                        lifecycle_status: null,
                        session_select: null,
                        organization_entity_id: null,
                        owner_person_id: null,
                        repository: null
                    })
                }] : []
            };
        }
        throw new Error(`Unexpected SQL in fake pool: ${sql}`);
    });
    const client = { query, release: vi.fn() };
    return {
        pool: { connect: vi.fn(async () => client), end: vi.fn() },
        queries,
        state
    };
}

describe('legacy project registry migration', () => {
    it('defaults to dry-run and requires an input file; execute requires an operator', () => {
        expect(parseLegacyProjectRegistryArgs(['--input', './projects.json'])).toMatchObject({ mode: 'dry-run' });
        expect(() => parseLegacyProjectRegistryArgs(['--execute', '--input', './projects.json'], {}))
            .toThrow(/BRAINBASE_MIGRATION_ACTOR/u);
        expect(parseLegacyProjectRegistryArgs(
            ['--execute', '--input', './projects.json'],
            { BRAINBASE_MIGRATION_ACTOR: 'operator@example.test' }
        )).toMatchObject({ mode: 'execute', actor: 'operator@example.test' });
    });

    it('dry-run plans registry, claim, and NULL project organization changes without writing', async () => {
        const { pool, queries, state } = createPool();
        const result = await runLegacyProjectRegistryMigration({ entries: [entry()], pool });

        expect(result).toMatchObject({
            mode: 'dry-run',
            planned_count: 1,
            applied_count: 0,
            readback_count: 1,
            graph_writes: 0,
            planned: {
                project_organization_assignments: 1,
                claim_reassignments: 1,
                registry_inserts: 1
            }
        });
        expect(result.per_code).toEqual([expect.objectContaining({
            project_code: 'legacy-app',
            status: 'planned',
            registry: 'planned',
            project_organization_assignment: 'planned',
            claim_reassignment: 'planned'
        })]);
        expect(state.projects[0].organization_id).toBeNull();
        expect(state.claims[0].organization_id).toBe('__unassigned__');
        expect(state.registries).toHaveLength(0);
        expect(queries.map(({ sql }) => sql)).toContain('ROLLBACK');
        expect(queries.map(({ sql }) => sql)).not.toContain('COMMIT');
        expect(queries.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE)\b[^;]*(?:graph_entities|graph_edges)/iu.test(sql))).toBe(true);
        expect(queries.filter(({ sql }) => sql === "SELECT set_config('app.organization_id',$1,true)")
            .map(({ values }) => values[0])).toEqual(['unson', 'unson', 'unson']);
    });

    it('execute adopts the existing project, assigns its NULL organization, and readbacks all writes', async () => {
        const { pool, queries, state } = createPool();
        const result = await runLegacyProjectRegistryMigration({
            entries: [entry({ display_name: 'Legacy Product' })],
            mode: 'execute',
            actor: 'operator@example.test',
            pool
        });

        expect(result).toMatchObject({ mode: 'execute', applied_count: 3, readback_count: 1 });
        expect(result.applied).toEqual({
            project_organization_assignments: 1,
            claim_reassignments: 1,
            registry_inserts: 1
        });
        expect(state.projects[0].organization_id).toBe('unson');
        expect(state.claims[0].organization_id).toBe('unson');
        expect(state.registries[0]).toMatchObject({
            project_code: 'legacy-app',
            display_name: 'Legacy Product',
            organization_id: 'unson'
        });
        expect(queries.map(({ sql }) => sql)).toContain('COMMIT');
        expect(queries.map(({ sql }) => sql)).not.toContain('ROLLBACK');
        expect(queries.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE)\b[^;]*(?:graph_entities|graph_edges)/iu.test(sql))).toBe(true);
        expect(queries.filter(({ sql }) => sql === "SELECT set_config('app.organization_id',$1,true)")
            .map(({ values }) => values[0])).toEqual(['unson', 'unson', 'unson']);
    });

    it('replays an exact registry row idempotently without writes', async () => {
        const existing = {
            project_code: 'legacy-app', organization_id: 'unson', display_name: 'Legacy App', kind: 'product',
            catalog_version: 1, lifecycle_status: 'active', session_select: true,
            organization_entity_id: 'unson', owner_person_id: 'per_owner', repository: { mode: 'none' }
        };
        const { pool, queries } = createPool({
            projects: [{ id: 'project_legacy_app', code: 'legacy-app', name: 'Legacy App', organization_id: 'unson' }],
            claims: [{ project_code: 'legacy-app', organization_id: 'unson' }],
            registries: [existing]
        });
        const result = await runLegacyProjectRegistryMigration({
            entries: [entry()], mode: 'execute', actor: 'operator@example.test', pool
        });

        expect(result).toMatchObject({ applied_count: 0, readback_count: 1 });
        expect(result.per_code[0]).toMatchObject({ status: 'already_registered', registry: 'already_registered' });
        expect(queries.every(({ sql }) => !sql.startsWith('INSERT INTO project_registry'))).toBe(true);
        expect(queries.every(({ sql }) => !sql.startsWith('UPDATE projects SET'))).toBe(true);
        expect(queries.every(({ sql }) => !sql.startsWith('UPDATE project_code_claims SET'))).toBe(true);
    });

    it('rejects a differing registry row and cross-organization claim before commit', async () => {
        const conflict = createPool({
            projects: [{ id: 'project_legacy_app', code: 'legacy-app', name: 'Legacy App', organization_id: 'unson' }],
            claims: [{ project_code: 'legacy-app', organization_id: 'unson' }],
            registries: [{
                project_code: 'legacy-app', organization_id: 'unson', display_name: 'Different', kind: 'product',
                catalog_version: 1, lifecycle_status: 'active', session_select: true,
                organization_entity_id: 'unson', owner_person_id: 'per_owner', repository: { mode: 'none' }
            }]
        });
        await expect(runLegacyProjectRegistryMigration({ entries: [entry()], pool: conflict.pool }))
            .rejects.toMatchObject({ code: 'REGISTRY_CONFLICT' });
        expect(conflict.queries.map(({ sql }) => sql)).toContain('ROLLBACK');
        expect(conflict.queries.map(({ sql }) => sql)).not.toContain('COMMIT');

        const crossOrg = createPool({ claims: [{ project_code: 'legacy-app', organization_id: 'other-org' }] });
        await expect(runLegacyProjectRegistryMigration({ entries: [entry()], pool: crossOrg.pool }))
            .rejects.toMatchObject({ code: 'PROJECT_CODE_CLAIM_CONFLICT' });
        expect(crossOrg.queries.map(({ sql }) => sql)).toContain('ROLLBACK');
        expect(crossOrg.queries.map(({ sql }) => sql)).not.toContain('COMMIT');
    });

    it('switches the RLS organization context for every entry read, write, and readback', async () => {
        const { pool, queries } = createPool({
            projects: [
                { id: 'project_legacy_app', code: 'legacy-app', name: 'Legacy App', organization_id: 'unson' },
                { id: 'project_other_app', code: 'other-app', name: 'Other App', organization_id: 'other-org' }
            ],
            claims: [
                { project_code: 'legacy-app', organization_id: 'unson' },
                { project_code: 'other-app', organization_id: 'other-org' }
            ]
        });

        await runLegacyProjectRegistryMigration({
            entries: [
                entry(),
                entry({
                    project_code: 'other-app',
                    organization_id: 'other-org',
                    organization_entity_id: 'other-org',
                    owner_person_id: 'per_other'
                })
            ],
            mode: 'execute',
            actor: 'operator@example.test',
            pool
        });

        expect(queries.filter(({ sql }) => sql === "SELECT set_config('app.organization_id',$1,true)")
            .map(({ values }) => values[0])).toEqual([
                'unson', 'other-org',
                'unson', 'other-org',
                'unson', 'other-org'
            ]);
        expect(queries.filter(({ sql }) => sql === "SELECT set_config('app.project_codes',$1,true)")
            .map(({ values }) => values[0])).toEqual([
                'legacy-app', 'other-app',
                'legacy-app', 'other-app',
                'legacy-app', 'other-app'
            ]);
    });

    it('rejects missing organization/person/graph/grant authority before any write', async () => {
        const { pool, queries } = createPool({ authority: { missing: ['owner'] } });

        await expect(runLegacyProjectRegistryMigration({ entries: [entry()], pool }))
            .rejects.toMatchObject({
                code: 'AUTHORITY_INVALID',
                details: { missing_fields: ['owner_person_exists'] }
            });
        expect(queries.map(({ sql }) => sql)).toContain('ROLLBACK');
        expect(queries.every(({ sql }) => !sql.startsWith('INSERT INTO project_registry'))).toBe(true);
    });
});

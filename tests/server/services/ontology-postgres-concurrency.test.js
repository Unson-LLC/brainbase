import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';
import { createProposedOntologyFixture } from '../../helpers/ontology-test-fixtures.js';

const databaseUrl = process.env.ONTOLOGY_POSTGRES_CONCURRENCY_URL || '';
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describeWithPostgres('Ontology canonical commit PostgreSQL concurrency', () => {
    const fixture = createProposedOntologyFixture(sourceRoot);
    const schema = `ontology_concurrency_${process.pid}_${Date.now()}`;
    const connectionString = `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-csearch_path=${schema}`)}`;
    let adminPool;
    let pool;
    let service;

    beforeAll(async () => {
        adminPool = new Pool({ connectionString: databaseUrl });
        await adminPool.query(`CREATE SCHEMA ${schema}`);
        pool = new Pool({ connectionString, max: 4 });
        await pool.query(`
            CREATE TABLE projects (
                id text PRIMARY KEY,
                code text NOT NULL UNIQUE,
                name text NOT NULL
            );
            CREATE TABLE graph_entities (
                id text PRIMARY KEY,
                entity_type text NOT NULL,
                project_id text NOT NULL,
                payload jsonb NOT NULL DEFAULT '{}'::jsonb,
                role_min text NOT NULL,
                sensitivity text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TABLE graph_edges (
                id text PRIMARY KEY,
                from_id text NOT NULL,
                to_id text NOT NULL,
                rel_type text NOT NULL,
                project_id text NOT NULL,
                payload jsonb NOT NULL DEFAULT '{}'::jsonb,
                role_min text NOT NULL,
                sensitivity text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                UNIQUE (from_id, to_id, rel_type)
            );
        `);
        await pool.query(
            `INSERT INTO projects (id, code, name) VALUES ('project:brainbase', 'brainbase', 'Brainbase');
             INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity)
             VALUES
               ('project:brainbase', 'project', 'project:brainbase', '{}', 'member', 'internal'),
               ('org:owner-a', 'org', 'project:brainbase', '{}', 'member', 'internal'),
               ('org:owner-b', 'org', 'project:brainbase', '{}', 'member', 'internal');`
        );
        const registry = new OntologyRegistry({ rootDir: fixture.rootDir });
        const activeRegistry = {
            hasCurrent: () => true,
            resolve: (options = {}) => {
                const release = registry.resolve({ version: options.version || '1.0.0', asOf: options.asOf });
                release.kernel.status = 'active';
                return release;
            }
        };
        service = new InfoSSOTService({ ontologyRegistry: activeRegistry, pool });
    });

    afterAll(async () => {
        await pool?.end();
        await adminPool?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await adminPool?.end();
        fixture.cleanup();
    });

    it('serializes conflicting owners for the same new app and rolls back the later commit', async () => {
        const access = { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };
        const commit = (ownerId) => service.commitOntologyGraph(access, {
            projectCode: 'brainbase',
            roleMin: 'member',
            sensitivity: 'internal',
            entity: { id: 'app:concurrent-new', type: 'app', payload: {} },
            contextEntities: [{ id: ownerId, type: 'org' }],
            edges: [{ from_id: 'app:concurrent-new', to_id: ownerId, relation: 'owned_by' }]
        });

        const results = await Promise.allSettled([commit('org:owner-a'), commit('org:owner-b')]);
        expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find(({ status }) => status === 'rejected');
        expect(rejected?.reason).toMatchObject({ code: 'ONTOLOGY_VALIDATION_FAILED' });

        const { rows } = await pool.query(
            `SELECT from_id, to_id, rel_type
             FROM graph_edges
             WHERE from_id = 'app:concurrent-new' AND rel_type = 'owned_by'`
        );
        expect(rows).toHaveLength(1);
    });
});

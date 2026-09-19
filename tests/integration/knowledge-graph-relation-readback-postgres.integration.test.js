/*
 * Explicit local Docker run:
 * BRAINBASE_RUN_DOCKER_INTEGRATION=1 npm run test:run -- --maxWorkers=1 \
 *   tests/integration/knowledge-graph-relation-readback-postgres.integration.test.js
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const { Pool } = pg;

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const POSTGRES_IMAGE = 'postgres:17-alpine';
const POSTGRES_PASSWORD = 'knowledge-graph-relation-local-test-password';
const POSTGRES_DATABASE = 'knowledge_graph_relation_test';
const ORGANIZATION_ID = 'knowledge-graph-relation-org-a';
const PERSON_ID = 'knowledge-graph-relation-person-a';
const PROJECT_CODE = 'knowledge-graph-relation-alpha';
const PROJECT_ID = 'project-knowledge-graph-relation-alpha';
const PROJECT_ENTITY_ID = 'graph-project-knowledge-graph-relation-alpha';
const SOURCE_ID = 'decision-knowledge-graph-relation-source';
const TARGET_ID = 'decision-knowledge-graph-relation-target';
const REPOSITORY_OWNER = 'unson';
const REPOSITORY_NAME = 'knowledge-graph-relation-alpha';
const APP_PASSWORD = 'knowledge-graph-relation-app-password';
const DOCKER_BIN = [
    '/usr/local/bin/docker',
    '/Applications/Docker.app/Contents/Resources/bin/docker',
    'docker'
].find((candidate) => candidate === 'docker' || existsSync(candidate));

function inspectDockerReadiness() {
    if (!DOCKER_BIN) {
        return { available: false, reason: 'Docker CLI was not found in the supported local paths' };
    }
    try {
        execFileSync(DOCKER_BIN, ['version'], { stdio: 'ignore', timeout: 5_000 });
    } catch {
        return { available: false, reason: 'Docker daemon is not reachable' };
    }
    try {
        execFileSync(DOCKER_BIN, ['image', 'inspect', POSTGRES_IMAGE], { stdio: 'ignore', timeout: 5_000 });
    } catch {
        return { available: false, reason: `${POSTGRES_IMAGE} is not available locally (the fixture never pulls images)` };
    }
    return { available: true, reason: '' };
}

const access = {
    organizationId: ORGANIZATION_ID,
    tenantId: ORGANIZATION_ID,
    personId: PERSON_ID,
    role: 'member',
    projectCodes: [PROJECT_CODE],
    clearance: ['internal']
};

const schemaFiles = [
    'server/sql/info-ssot-schema.sql',
    'server/sql/permission-schema.sql',
    'server/sql/project-provisioning-schema.sql',
    'server/sql/outcome-case-schema.sql',
    'server/sql/info-ssot-rls.sql',
    'server/sql/knowledge-document-schema.sql'
];

const execDocker = async (args, options = {}) => execFileAsync(DOCKER_BIN || 'docker', args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 15_000,
    maxBuffer: 4 * 1024 * 1024
});

async function getBackendCommit() {
    const { stdout } = await execFileAsync('git', ['-C', BACKEND, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 1024
    });
    const commit = stdout.trim();
    assert.match(commit, /^[0-9a-f]{40}$/, 'backend HEAD must be a full commit SHA');
    return commit;
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findFreePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (!port) throw new Error('could not reserve a local port for the temporary Postgres container');
    return port;
}

async function waitForPostgres(pool, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
        try {
            await pool.query('SELECT 1');
            return;
        } catch (error) {
            lastError = error;
            await delay(250);
        }
    }
    throw new Error(`temporary Postgres did not become ready: ${lastError?.message || 'timeout'}`);
}

async function removeContainer(containerName) {
    try {
        await execDocker(['rm', '--force', containerName], { timeout: 10_000 });
    } catch (error) {
        const stderr = String(error?.stderr || '');
        if (!stderr.includes('No such container')) throw error;
    }
}

async function applySchemas(pool) {
    for (const relativePath of schemaFiles) {
        const sql = await fs.readFile(`${BACKEND}/${relativePath}`, 'utf8');
        await pool.query(sql);
    }
}

async function createApplicationRole(adminPool, appRole) {
    await adminPool.query(`CREATE ROLE "${appRole}" LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO "${appRole}"`);
    // validateGraphMutation locks entity and edge rows with FOR UPDATE. Keep
    // the role non-superuser/non-BYPASSRLS while granting only the table-level
    // privilege that PostgreSQL requires for those row locks; RLS still
    // determines which rows are visible and writable.
    await adminPool.query(`GRANT SELECT, UPDATE ON graph_entities, graph_edges TO "${appRole}"`);
    await adminPool.query(`GRANT SELECT ON projects, people, project_registry TO "${appRole}"`);
    await adminPool.query(`GRANT INSERT, UPDATE ON graph_edges TO "${appRole}"`);
}

async function seedGraphFixture(adminPool) {
    await adminPool.query(
        `INSERT INTO people (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [PERSON_ID, 'Knowledge Graph relation fixture owner']
    );
    await adminPool.query(
        `INSERT INTO projects (id, code, name, organization_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [PROJECT_ID, PROJECT_CODE, PROJECT_CODE, ORGANIZATION_ID]
    );
    await adminPool.query(
        `INSERT INTO graph_entities (
             id, entity_type, project_id, payload, role_min, sensitivity,
             lifecycle_status, version
         ) VALUES ($1, 'project', $2, $3::jsonb, 'member', 'internal', 'active', 1)
         ON CONFLICT (id) DO NOTHING`,
        [
            PROJECT_ENTITY_ID,
            PROJECT_ID,
            JSON.stringify({
                name: PROJECT_CODE,
                catalog_project_id: PROJECT_CODE,
                catalog_version: 1,
                source_ref: `test:${PROJECT_CODE}`
            })
        ]
    );
    await adminPool.query(
        `INSERT INTO project_registry (
             project_code, organization_id, display_name, kind,
             catalog_version, lifecycle_status, session_select,
             organization_entity_id, owner_person_id, repository,
             graph_entity_id, graph_binding_status, graph_binding_reason,
             graph_binding_evidence
         ) VALUES ($1, $2, $3, 'project', 1, 'active', true, $4, $5, $6::jsonb,
                   $7, 'linked', 'postgres graph relation integration fixture', $8::jsonb)
         ON CONFLICT (project_code) DO NOTHING`,
        [
            PROJECT_CODE,
            ORGANIZATION_ID,
            PROJECT_CODE,
            `org:${ORGANIZATION_ID}`,
            PERSON_ID,
            JSON.stringify({ mode: 'link_existing', owner: REPOSITORY_OWNER, repo: REPOSITORY_NAME }),
            PROJECT_ENTITY_ID,
            JSON.stringify({ source: 'check-knowledge-graph-relation-readback-postgres' })
        ]
    );

    const entities = [
        {
            id: SOURCE_ID,
            type: 'decision',
            payload: { statement: 'Graph relation readback source', version: '7', status: 'active' }
        },
        {
            id: TARGET_ID,
            type: 'decision',
            payload: { statement: 'Graph relation readback target', version: '1', status: 'active' }
        },
        {
            id: PERSON_ID,
            type: 'person',
            payload: { name: 'Knowledge Graph relation fixture owner' }
        }
    ];
    for (const entity of entities) {
        await adminPool.query(
            `INSERT INTO graph_entities (
                 id, entity_type, project_id, payload, role_min, sensitivity,
                 lifecycle_status, version
             ) VALUES ($1, $2, $3, $4::jsonb, 'member', 'internal', 'active', 1)
             ON CONFLICT (id) DO NOTHING`,
            [entity.id, entity.type, PROJECT_ID, JSON.stringify(entity.payload)]
        );
    }
}

function wrapClientForReadbackFault(client, faultMode) {
    return new Proxy(client, {
        get(target, property, receiver) {
            if (property === 'query') {
                return async (sql, params) => {
                    const result = await target.query(sql, params);
                    const queryText = String(sql);
                    if (!queryText.includes('SELECT from_id, to_id, rel_type, payload')
                        || !queryText.includes('WHERE project_id = $1 AND from_id = $2')) {
                        return result;
                    }
                    const rows = result.rows || [];
                    if (faultMode === 'missing') {
                        return { ...result, rows: rows.filter((edge) => edge.rel_type !== 'references') };
                    }
                    if (faultMode === 'wrong_target') {
                        return {
                            ...result,
                            rows: rows.map((edge) => edge.rel_type === 'references'
                                ? { ...edge, to_id: 'fault-injected-target' }
                                : edge)
                        };
                    }
                    if (faultMode === 'wrong_payload') {
                        return {
                            ...result,
                            rows: rows.map((edge) => edge.rel_type === 'references'
                                ? { ...edge, payload: { reason: 'fault-injected-payload' } }
                                : edge)
                        };
                    }
                    return result;
                };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

class ReadbackFaultInfoSSOTService {
    constructor(base, faultMode) {
        this.base = base;
        this.faultMode = faultMode;
    }

    withAccessContext(accessContext, handler, options) {
        return this.base.withAccessContext(
            accessContext,
            (client) => handler(wrapClientForReadbackFault(client, this.faultMode)),
            options
        );
    }

    validateOntology(...args) {
        return this.base.validateOntology(...args);
    }

    validateGraphMutation(...args) {
        return this.base.validateGraphMutation(...args);
    }

    upsertGraphEdge(...args) {
        return this.base.upsertGraphEdge(...args);
    }

    assertWriteAccess(...args) {
        return this.base.assertWriteAccess(...args);
    }
}

async function countEdges(adminPool) {
    const result = await adminPool.query(
        `SELECT count(*)::integer AS count
         FROM graph_edges
         WHERE project_id = $1 AND from_id = $2`,
        [PROJECT_ID, SOURCE_ID]
    );
    return result.rows[0].count;
}

async function readEdges(adminPool) {
    const result = await adminPool.query(
        `SELECT from_id, to_id, rel_type, payload
         FROM graph_edges
         WHERE project_id = $1 AND from_id = $2
         ORDER BY rel_type, to_id`,
        [PROJECT_ID, SOURCE_ID]
    );
    return result.rows;
}

async function expectReadbackMismatch(repository, label) {
    let error;
    try {
        await repository.persistAuthoringRelations({
            project_code: PROJECT_CODE,
            entity_type: 'decision',
            entity_id: SOURCE_ID,
            owner_person_id: PERSON_ID,
            expected_version: '7',
            relations: [{ relation: 'references', to_id: TARGET_ID, payload: { reason: 'evidence' } }]
        }, { access });
    } catch (caught) {
        error = caught;
    }
    assert.ok(error, `${label} must reject`);
    assert.equal(error.code, 'knowledge_relations_readback_mismatch', `${label} error code`);
    assert.equal(error.status, 409, `${label} error status`);
}

async function run() {
    const containerName = `brainbase-knowledge-graph-relation-pg-${process.pid}-${randomBytes(5).toString('hex')}`;
    const appRole = `knowledge_graph_relation_app_${process.pid}`;
    const targetCommit = await getBackendCommit();
    const port = await findFreePort();
    let containerStarted = false;
    let adminPool;
    let appPool;

    try {
        // Inspect first so this verifier never pulls an image or changes the
        // user's Docker state beyond its own explicitly named container.
        await execDocker(['image', 'inspect', POSTGRES_IMAGE]);
        await execDocker([
            'run', '--rm', '--detach', '--name', containerName,
            '--env', 'POSTGRES_USER=postgres',
            '--env', `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
            '--env', `POSTGRES_DB=${POSTGRES_DATABASE}`,
            '--publish', `127.0.0.1:${port}:5432`,
            POSTGRES_IMAGE
        ]);
        containerStarted = true;

        adminPool = new Pool({
            host: '127.0.0.1',
            port,
            user: 'postgres',
            password: POSTGRES_PASSWORD,
            database: POSTGRES_DATABASE,
            max: 4,
            connectionTimeoutMillis: 2_000,
            idleTimeoutMillis: 2_000
        });
        await waitForPostgres(adminPool);
        await applySchemas(adminPool);
        await seedGraphFixture(adminPool);
        await createApplicationRole(adminPool, appRole);

        appPool = new Pool({
            host: '127.0.0.1',
            port,
            user: appRole,
            password: APP_PASSWORD,
            database: POSTGRES_DATABASE,
            max: 4,
            connectionTimeoutMillis: 2_000,
            idleTimeoutMillis: 2_000
        });
        await waitForPostgres(appPool);

        const roleResult = await adminPool.query(
            `SELECT rolsuper, rolbypassrls
             FROM pg_roles
             WHERE rolname = $1`,
            [appRole]
        );
        assert.equal(roleResult.rowCount, 1, 'application role must exist');
        assert.equal(roleResult.rows[0].rolsuper, false, 'application role must be non-superuser');
        assert.equal(roleResult.rows[0].rolbypassrls, false, 'application role must not bypass RLS');

        const { InfoSSOTService } = await import(pathToFileURL(
            `${BACKEND}/server/services/info-ssot-service.js`
        ));
        const { OntologyRegistry } = await import(pathToFileURL(
            `${BACKEND}/server/services/ontology-registry.js`
        ));
        const { InfoSSOTKnowledgeGraphRepository } = await import(pathToFileURL(
            `${BACKEND}/server/services/knowledge-event/info-ssot-knowledge-graph-repository.js`
        ));

        const ontologyRegistry = new OntologyRegistry({ rootDir: BACKEND });
        const infoSSOTService = new InfoSSOTService({ pool: appPool, ontologyRegistry });
        const relationInput = {
            project_code: PROJECT_CODE,
            entity_type: 'decision',
            entity_id: SOURCE_ID,
            owner_person_id: PERSON_ID,
            expected_version: '7',
            relations: [{ relation: 'references', to_id: TARGET_ID, payload: { reason: 'evidence' } }]
        };

        const successfulRepository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        const success = await successfulRepository.persistAuthoringRelations(relationInput, { access });
        assert.equal(success.graph_saved, true, 'successful relation save must report graph_saved');
        assert.equal(success.readback_verified, true, 'successful relation save must report readback_verified');
        assert.equal(success.relation_count, 3, 'owner, project, and requested relation must be persisted');
        assert.deepEqual(success.relations, [
            { from_id: SOURCE_ID, to_id: PERSON_ID, relation: 'owned_by', payload: {} },
            { from_id: SOURCE_ID, to_id: PROJECT_ENTITY_ID, relation: 'belongs_to_project', payload: {} },
            { from_id: SOURCE_ID, to_id: TARGET_ID, relation: 'references', payload: { reason: 'evidence' } }
        ]);
        const persistedEdges = await readEdges(adminPool);
        assert.equal(persistedEdges.length, 3, 'admin readback must observe all three committed edges');
        assert.deepEqual(
            persistedEdges.map((edge) => [edge.from_id, edge.to_id, edge.rel_type, edge.payload]),
            [
                [SOURCE_ID, PROJECT_ENTITY_ID, 'belongs_to_project', {}],
                [SOURCE_ID, PERSON_ID, 'owned_by', {}],
                [SOURCE_ID, TARGET_ID, 'references', { reason: 'evidence' }]
            ]
        );

        const rollbackCases = [];
        for (const faultMode of ['missing', 'wrong_target', 'wrong_payload']) {
            const faultService = new ReadbackFaultInfoSSOTService(infoSSOTService, faultMode);
            const faultRepository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService: faultService });
            // Remove the successful aggregate so every fault case proves that
            // the three writes made before readback are rolled back together.
            await adminPool.query(
                'DELETE FROM graph_edges WHERE project_id = $1 AND from_id = $2',
                [PROJECT_ID, SOURCE_ID]
            );
            assert.equal(await countEdges(adminPool), 0, `${faultMode} precondition must be clean`);
            await expectReadbackMismatch(faultRepository, faultMode);
            const edgeCountAfterFailure = await countEdges(adminPool);
            assert.equal(edgeCountAfterFailure, 0, `${faultMode} readback mismatch must roll back all relation writes`);
            rollbackCases.push({ fault: faultMode, error_code: 'knowledge_relations_readback_mismatch', edge_count_after_failure: edgeCountAfterFailure });
        }

        // Re-run the real repository after the fault injections. This proves
        // the failed transactions did not poison the connection or aggregate.
        const retry = await successfulRepository.persistAuthoringRelations(relationInput, { access });
        assert.equal(retry.readback_verified, true, 'a later real save must succeed after rollback cases');
        assert.equal(await countEdges(adminPool), 3, 'retry must leave exactly three committed edges');

        return {
            ok: true,
            contract: 'knowledge-graph-relation-readback.postgres',
            target_commit: targetCommit,
            database: 'temporary postgres:17-alpine',
            ontology_version: ontologyRegistry.resolve().kernel.version,
            application_role: {
                superuser: roleResult.rows[0].rolsuper,
                bypass_rls: roleResult.rows[0].rolbypassrls
            },
            success: {
                relation_count: success.relation_count,
                readback_verified: success.readback_verified,
                committed_edge_count: persistedEdges.length
            },
            rollback_cases: rollbackCases,
            retry: { readback_verified: retry.readback_verified, committed_edge_count: await countEdges(adminPool) },
            cleanup: 'completed'
        };
    } finally {
        try {
            if (appPool) await appPool.end();
        } finally {
            try {
                if (adminPool) await adminPool.end();
            } finally {
                if (containerStarted) await removeContainer(containerName);
            }
        }
    }
}

const dockerIntegrationRequested = process.env.BRAINBASE_RUN_DOCKER_INTEGRATION === '1';
const dockerReadiness = dockerIntegrationRequested
    ? inspectDockerReadiness()
    : { available: false, reason: 'set BRAINBASE_RUN_DOCKER_INTEGRATION=1 to run the disposable PostgreSQL fixture' };
const describeWithDocker = dockerIntegrationRequested && dockerReadiness.available ? describe : describe.skip;

if (!dockerReadiness.available) {
    console.warn(`[SKIP] knowledge-graph relation readback PostgreSQL integration: ${dockerReadiness.reason}`);
}

describeWithDocker.sequential('knowledge-graph relation readback PostgreSQL contract', () => {
    it('persists three Graph edges, verifies readback, and rolls back mismatches', async () => {
        const result = await run();
        expect(result).toMatchObject({
            ok: true,
            contract: 'knowledge-graph-relation-readback.postgres',
            application_role: { superuser: false, bypass_rls: false },
            success: { relation_count: 3, readback_verified: true, committed_edge_count: 3 },
            retry: { readback_verified: true, committed_edge_count: 3 },
            cleanup: 'completed'
        });
        expect(result.rollback_cases).toEqual([
            { fault: 'missing', error_code: 'knowledge_relations_readback_mismatch', edge_count_after_failure: 0 },
            { fault: 'wrong_target', error_code: 'knowledge_relations_readback_mismatch', edge_count_after_failure: 0 },
            { fault: 'wrong_payload', error_code: 'knowledge_relations_readback_mismatch', edge_count_after_failure: 0 }
        ]);
    }, 120_000);
});

export { run as checkKnowledgeGraphRelationReadbackPostgres };

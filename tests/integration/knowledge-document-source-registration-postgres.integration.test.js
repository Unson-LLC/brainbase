/*
 * Explicit local Docker run:
 * BRAINBASE_RUN_DOCKER_INTEGRATION=1 npm run test:run -- --maxWorkers=1 \
 *   tests/integration/knowledge-document-source-registration-postgres.integration.test.js
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
const POSTGRES_PASSWORD = 'knowledge-document-source-local-test-password';
const POSTGRES_DATABASE = 'knowledge_document_source_test';
const ORGANIZATION_ID = 'knowledge-document-source-org-a';
const OTHER_ORGANIZATION_ID = 'knowledge-document-source-org-b';
const PERSON_ID = 'knowledge-document-source-person-a';
const OTHER_PERSON_ID = 'knowledge-document-source-person-b';
const PROJECT_CODE = 'knowledge-document-source-alpha';
const OTHER_PROJECT_CODE = 'knowledge-document-source-beta';
const INITIAL_RACE_PROJECT_CODE = 'knowledge-document-source-initial-race';
const PROJECT_ID = 'project-knowledge-document-source-alpha';
const OTHER_PROJECT_ID = 'project-knowledge-document-source-beta';
const INITIAL_RACE_PROJECT_ID = 'project-knowledge-document-source-initial-race';
const GRAPH_ENTITY_ID = 'graph-project-knowledge-document-source-alpha';
const OTHER_GRAPH_ENTITY_ID = 'graph-project-knowledge-document-source-beta';
const INITIAL_RACE_GRAPH_ENTITY_ID = 'graph-project-knowledge-document-source-initial-race';
const REPOSITORY_OWNER = 'unson';
const REPOSITORY_NAME = 'knowledge-document-source-alpha';
const INITIAL_RACE_REPOSITORY_NAME = 'knowledge-document-source-initial-race';
const APP_PASSWORD = 'knowledge-document-source-app-password';
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
    projectCodes: [PROJECT_CODE, INITIAL_RACE_PROJECT_CODE],
    clearance: ['internal']
};

const otherOrganizationAccess = {
    organizationId: OTHER_ORGANIZATION_ID,
    tenantId: OTHER_ORGANIZATION_ID,
    personId: OTHER_PERSON_ID,
    role: 'member',
    projectCodes: [PROJECT_CODE],
    clearance: ['internal']
};

const sameOrganizationOtherProjectAccess = {
    ...access,
    projectCodes: [OTHER_PROJECT_CODE]
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
    await adminPool.query(`GRANT SELECT ON projects, people, project_registry, graph_entities, graph_edges, knowledge_document_source_registrations, knowledge_document_source_registration_receipts TO "${appRole}"`);
    await adminPool.query(`GRANT INSERT, UPDATE ON knowledge_document_source_registrations TO "${appRole}"`);
    await adminPool.query(`GRANT INSERT ON knowledge_document_source_registration_receipts TO "${appRole}"`);
}

async function seedGraphProject(adminPool, {
    organizationId,
    personId,
    projectCode,
    projectId,
    graphEntityId,
    repositoryOwner,
    repositoryName
}) {
    await adminPool.query(
        `INSERT INTO people (id, name)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [personId, personId]
    );
    await adminPool.query(
        `INSERT INTO projects (id, code, name, organization_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [projectId, projectCode, projectCode, organizationId]
    );
    await adminPool.query(
        `INSERT INTO graph_entities (
             id, entity_type, project_id, payload, role_min, sensitivity,
             lifecycle_status, version
         ) VALUES ($1, 'project', $2, $3::jsonb, 'member', 'internal', 'active', 1)
         ON CONFLICT (id) DO NOTHING`,
        [
            graphEntityId,
            projectId,
            JSON.stringify({
                name: projectCode,
                catalog_project_id: projectCode,
                catalog_version: 1,
                source_ref: `test:${projectCode}`
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
                   $7, 'linked', 'postgres integration fixture', $8::jsonb)
         ON CONFLICT (project_code) DO NOTHING`,
        [
            projectCode,
            organizationId,
            projectCode,
            `org:${organizationId}`,
            personId,
            JSON.stringify({ mode: 'link_existing', owner: repositoryOwner, repo: repositoryName }),
            graphEntityId,
            JSON.stringify({ source: 'check-knowledge-document-source-postgres' })
        ]
    );
}

async function seedSourceRegistration(adminPool) {
    await adminPool.query(
        `INSERT INTO knowledge_document_source_registrations (
             organization_id, tenant_id, project_code,
             source_class, content_type,
             repository_owner, repository_name, branch, path_scope,
             graph_project_id, graph_entity_id, registration_status,
             registered_by, registry_repository
         ) VALUES ($1, $1, $2, 'owning_repo', 'team_document', $3, $4, 'main', 'docs',
                   $5, $6, 'active', $7, $8::jsonb)
         ON CONFLICT (organization_id, project_code) DO NOTHING`,
        [
            OTHER_ORGANIZATION_ID,
            OTHER_PROJECT_CODE,
            REPOSITORY_OWNER,
            OTHER_PROJECT_CODE,
            OTHER_PROJECT_ID,
            OTHER_GRAPH_ENTITY_ID,
            OTHER_PERSON_ID,
            JSON.stringify({ mode: 'link_existing', owner: REPOSITORY_OWNER, repo: OTHER_PROJECT_CODE })
        ]
    );
}

async function expectRejected(action, code, status, label) {
    let error;
    try {
        await action();
    } catch (caught) {
        error = caught;
    }
    assert.ok(error, `${label} must reject`);
    assert.equal(error.code, code, `${label} error code`);
    assert.equal(error.status, status, `${label} error status`);
    return error;
}

async function countVisibleSourceRegistrations(infoSSOTService, scopedAccess, projectCode) {
    return infoSSOTService.withAccessContext(scopedAccess, async (client) => {
        const result = await client.query(
            `SELECT count(*)::integer AS count
             FROM knowledge_document_source_registrations
             WHERE project_code = $1`,
            [projectCode]
        );
        return result.rows[0].count;
    });
}

async function run() {
    const containerName = `brainbase-knowledge-document-source-pg-${process.pid}-${randomBytes(5).toString('hex')}`;
    const appRole = `knowledge_document_app_${process.pid}`;
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
        await seedGraphProject(adminPool, {
            organizationId: ORGANIZATION_ID,
            personId: PERSON_ID,
            projectCode: PROJECT_CODE,
            projectId: PROJECT_ID,
            graphEntityId: GRAPH_ENTITY_ID,
            repositoryOwner: REPOSITORY_OWNER,
            repositoryName: REPOSITORY_NAME
        });
        await seedGraphProject(adminPool, {
            organizationId: OTHER_ORGANIZATION_ID,
            personId: OTHER_PERSON_ID,
            projectCode: OTHER_PROJECT_CODE,
            projectId: OTHER_PROJECT_ID,
            graphEntityId: OTHER_GRAPH_ENTITY_ID,
            repositoryOwner: REPOSITORY_OWNER,
            repositoryName: OTHER_PROJECT_CODE
        });
        await seedGraphProject(adminPool, {
            organizationId: ORGANIZATION_ID,
            personId: PERSON_ID,
            projectCode: INITIAL_RACE_PROJECT_CODE,
            projectId: INITIAL_RACE_PROJECT_ID,
            graphEntityId: INITIAL_RACE_GRAPH_ENTITY_ID,
            repositoryOwner: REPOSITORY_OWNER,
            repositoryName: INITIAL_RACE_REPOSITORY_NAME
        });
        await seedSourceRegistration(adminPool);
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
        const { PgKnowledgeDocumentGraphRepository } = await import(pathToFileURL(
            `${BACKEND}/server/services/knowledge-document-graph-repository.js`
        ));
        const { KnowledgeDocumentGraphPointerResolver } = await import(pathToFileURL(
            `${BACKEND}/server/services/knowledge-document-graph-pointer-resolver.js`
        ));

        const infoSSOTService = new InfoSSOTService({ pool: appPool });
        const graphRepository = new PgKnowledgeDocumentGraphRepository({ infoSSOTService });
        const resolver = new KnowledgeDocumentGraphPointerResolver({ graphRepository });

        const registrationResult = await graphRepository.registerDocumentSourceRegistration({
            tenant_id: ORGANIZATION_ID,
            project_code: PROJECT_CODE,
            source_class: 'owning_repo',
            content_type: 'team_document',
            repository_owner: REPOSITORY_OWNER,
            repository_name: REPOSITORY_NAME,
            branch: 'main',
            path_scope: 'docs/',
            expected_revision: null,
            idempotency_key: 'registration-initial'
        }, { access });
        assert.equal(registrationResult.idempotent, false, 'initial registration must be a new write');
        const registration = registrationResult.registration;
        assert.equal(registration.organization_id, ORGANIZATION_ID);
        assert.equal(registration.tenant_id, ORGANIZATION_ID);
        assert.equal(registration.project_code, PROJECT_CODE);
        assert.equal(registration.source_class, 'owning_repo');
        assert.equal(registration.content_type, 'team_document');
        assert.equal(registration.repository_owner, REPOSITORY_OWNER);
        assert.equal(registration.repository_name, REPOSITORY_NAME);
        assert.equal(registration.branch, 'main');
        assert.equal(registration.path_scope, 'docs');
        assert.equal(registration.graph_project_id, PROJECT_ID);
        assert.equal(registration.graph_entity_id, GRAPH_ENTITY_ID);
        assert.equal(registration.registration_status, 'active');
        assert.deepEqual(registration.registry_repository, {
            mode: 'link_existing',
            owner: REPOSITORY_OWNER,
            repo: REPOSITORY_NAME
        });

        const readback = await graphRepository.readDocumentSourceRegistration({
            project_code: PROJECT_CODE
        }, { access });
        assert.deepEqual(readback, registration, 'repository readback must match registration');
        const directReadbackCount = await countVisibleSourceRegistrations(infoSSOTService, access, PROJECT_CODE);
        assert.equal(directReadbackCount, 1, 'non-superuser must read the registered source in its project scope');

        const pointer = await resolver.resolve({ access, project_code: PROJECT_CODE });
        assert.equal(pointer.status, 'resolved');
        assert.equal(pointer.schema_version, 'knowledge_document_source_registration.v1');
        assert.equal(pointer.source_class, 'owning_repo');
        assert.equal(pointer.content_type, 'team_document');
        assert.equal(pointer.project_code, PROJECT_CODE);
        assert.deepEqual(pointer.canonical_location, {
            repository: `project:${PROJECT_CODE}`,
            owner: REPOSITORY_OWNER,
            repo: REPOSITORY_NAME,
            tenant_id: ORGANIZATION_ID,
            branch: 'main',
            path: 'docs/'
        });
        assert.deepEqual(pointer.graph_registration, {
            tenant_id: ORGANIZATION_ID,
            project_code: PROJECT_CODE,
            graph_project_id: PROJECT_ID,
            graph_entity_id: GRAPH_ENTITY_ID,
            registration_status: 'active'
        });
        assert.equal(pointer.retrieval_capability, 'repository.read');
        assert.equal(pointer.confidence, 1);

        await expectRejected(
            () => graphRepository.readDocumentSourceRegistration({ project_code: PROJECT_CODE }, {
                access: { ...access, projectCodes: [] }
            }),
            'knowledge_project_not_accessible',
            403,
            'same-organization project outside projectCodes'
        );
        await expectRejected(
            () => resolver.resolve({
                access: { ...access, projectCodes: [] },
                project_code: PROJECT_CODE
            }),
            'knowledge_project_not_accessible',
            403,
            'resolver project outside projectCodes'
        );

        const otherOrganizationReadback = await graphRepository.readDocumentSourceRegistration({
            project_code: PROJECT_CODE
        }, { access: otherOrganizationAccess });
        assert.equal(otherOrganizationReadback, null, 'RLS must hide an organization-owned source from another organization');
        await expectRejected(
            () => resolver.resolve({ access: otherOrganizationAccess, project_code: PROJECT_CODE }),
            'knowledge_document_graph_pointer_required',
            503,
            'resolver cross-organization source access'
        );
        assert.equal(
            await countVisibleSourceRegistrations(infoSSOTService, otherOrganizationAccess, PROJECT_CODE),
            0,
            'RLS must return no source rows for another organization'
        );

        const otherProjectReadback = await graphRepository.readDocumentSourceRegistration({
            project_code: OTHER_PROJECT_CODE
        }, { access: sameOrganizationOtherProjectAccess });
        assert.equal(otherProjectReadback, null, 'RLS must hide another organization project even when the code is supplied');
        assert.equal(
            await countVisibleSourceRegistrations(infoSSOTService, sameOrganizationOtherProjectAccess, OTHER_PROJECT_CODE),
            0,
            'project scope must not expose another project source'
        );

        await expectRejected(
            () => graphRepository.registerDocumentSourceRegistration({
                tenant_id: ORGANIZATION_ID,
                project_code: PROJECT_CODE,
                repository_owner: REPOSITORY_OWNER,
                repository_name: 'wrong-registry-repository',
                branch: 'main',
                path_scope: 'docs',
                expected_revision: 1,
                idempotency_key: 'registration-mismatch'
            }, { access }),
            'knowledge_document_graph_repository_mismatch',
            409,
            'registration repository must match Project Registry'
        );
        assert.equal(
            await countVisibleSourceRegistrations(infoSSOTService, access, PROJECT_CODE),
            1,
            'registry repository mismatch must not overwrite the existing registration'
        );

        await adminPool.query(
            `UPDATE project_registry
             SET repository = $1::jsonb
             WHERE project_code = $2 AND organization_id = $3`,
            [JSON.stringify({ mode: 'link_existing', owner: 'other-owner', repo: 'other-repository' }), PROJECT_CODE, ORGANIZATION_ID]
        );
        await expectRejected(
            () => resolver.resolve({ access, project_code: PROJECT_CODE }),
            'knowledge_document_graph_pointer_mismatch',
            503,
            'resolver must reject registry/source owner-repository drift'
        );
        await adminPool.query(
            `UPDATE project_registry
             SET repository = $1::jsonb
             WHERE project_code = $2 AND organization_id = $3`,
            [JSON.stringify({ mode: 'link_existing', owner: REPOSITORY_OWNER, repo: REPOSITORY_NAME }), PROJECT_CODE, ORGANIZATION_ID]
        );

        const sameKeyRaceInputs = Array.from({ length: 2 }, () => ({
            tenant_id: ORGANIZATION_ID,
            project_code: PROJECT_CODE,
            source_class: 'owning_repo',
            content_type: 'team_document',
            repository_owner: REPOSITORY_OWNER,
            repository_name: REPOSITORY_NAME,
            branch: 'main',
            path_scope: 'docs/',
            expected_revision: 1,
            idempotency_key: 'registration-race-same-key'
        }));
        const sameKeyRace = await Promise.allSettled(sameKeyRaceInputs.map((input) => (
            graphRepository.registerDocumentSourceRegistration(input, { access })
        )));
        assert.ok(sameKeyRace.every((result) => result.status === 'fulfilled'), 'same-key concurrent registrations must both resolve');
        const sameKeyRegistrations = sameKeyRace.map((result) => result.value);
        assert.deepEqual(
            sameKeyRegistrations.map((result) => result.registration.revision),
            [2, 2],
            'same-key concurrent registrations must share the committed revision'
        );
        assert.deepEqual(
            sameKeyRegistrations.map((result) => result.idempotent).sort(),
            [false, true],
            'same-key concurrent registrations must have one write and one idempotent replay'
        );

        const differentKeyRaceInputs = [
            {
                tenant_id: ORGANIZATION_ID,
                project_code: PROJECT_CODE,
                source_class: 'owning_repo',
                content_type: 'team_document',
                repository_owner: REPOSITORY_OWNER,
                repository_name: REPOSITORY_NAME,
                branch: 'race-a',
                path_scope: 'docs/race-a',
                expected_revision: 2,
                idempotency_key: 'registration-race-different-a'
            },
            {
                tenant_id: ORGANIZATION_ID,
                project_code: PROJECT_CODE,
                source_class: 'owning_repo',
                content_type: 'team_document',
                repository_owner: REPOSITORY_OWNER,
                repository_name: REPOSITORY_NAME,
                branch: 'race-b',
                path_scope: 'docs/race-b',
                expected_revision: 2,
                idempotency_key: 'registration-race-different-b'
            }
        ];
        const differentKeyRace = await Promise.allSettled(differentKeyRaceInputs.map((input) => (
            graphRepository.registerDocumentSourceRegistration(input, { access })
        )));
        assert.equal(differentKeyRace.filter((result) => result.status === 'fulfilled').length, 1, 'different-key same-revision race must have one winner');
        assert.equal(differentKeyRace.filter((result) => result.status === 'rejected').length, 1, 'different-key same-revision race must have one conflict');
        const differentKeyWinner = differentKeyRace.find((result) => result.status === 'fulfilled').value;
        const differentKeyConflict = differentKeyRace.find((result) => result.status === 'rejected').reason;
        assert.equal(differentKeyWinner.registration.revision, 3, 'different-key race winner must advance the revision once');
        assert.equal(differentKeyWinner.idempotent, false, 'different-key race winner must be a new write');
        assert.equal(differentKeyConflict.code, 'knowledge_document_graph_revision_conflict');
        assert.equal(differentKeyConflict.status, 409);
        const differentKeyWinnerInput = differentKeyRaceInputs.find((input) => input.idempotency_key === (
            differentKeyWinner.registration.branch === 'race-a'
                ? 'registration-race-different-a'
                : 'registration-race-different-b'
        ));
        assert.equal(differentKeyWinner.registration.path_scope, differentKeyWinnerInput.path_scope);

        const initialInsertRaceInputs = [
            {
                tenant_id: ORGANIZATION_ID,
                project_code: INITIAL_RACE_PROJECT_CODE,
                source_class: 'owning_repo',
                content_type: 'team_document',
                repository_owner: REPOSITORY_OWNER,
                repository_name: INITIAL_RACE_REPOSITORY_NAME,
                branch: 'main',
                path_scope: 'docs/',
                expected_revision: null,
                idempotency_key: 'registration-race-initial-a'
            },
            {
                tenant_id: ORGANIZATION_ID,
                project_code: INITIAL_RACE_PROJECT_CODE,
                source_class: 'owning_repo',
                content_type: 'team_document',
                repository_owner: REPOSITORY_OWNER,
                repository_name: INITIAL_RACE_REPOSITORY_NAME,
                branch: 'main',
                path_scope: 'docs/',
                expected_revision: null,
                idempotency_key: 'registration-race-initial-b'
            }
        ];
        const initialInsertRace = await Promise.allSettled(initialInsertRaceInputs.map((input) => (
            graphRepository.registerDocumentSourceRegistration(input, { access })
        )));
        assert.equal(initialInsertRace.filter((result) => result.status === 'fulfilled').length, 1, 'initial INSERT race must have one winner');
        assert.equal(initialInsertRace.filter((result) => result.status === 'rejected').length, 1, 'initial INSERT race must have one conflict');
        const initialInsertWinner = initialInsertRace.find((result) => result.status === 'fulfilled').value;
        const initialInsertConflict = initialInsertRace.find((result) => result.status === 'rejected').reason;
        assert.equal(initialInsertWinner.registration.revision, 1, 'initial INSERT winner must create revision one');
        assert.equal(initialInsertWinner.idempotent, false, 'initial INSERT winner must be a new write');
        assert.equal(initialInsertConflict.code, 'knowledge_document_graph_revision_conflict');
        assert.equal(initialInsertConflict.status, 409);
        const initialInsertReadback = await graphRepository.readDocumentSourceRegistration({
            project_code: INITIAL_RACE_PROJECT_CODE
        }, { access });
        assert.equal(initialInsertReadback.revision, 1, 'initial INSERT readback must remain at one row and revision one');
        assert.equal(
            await countVisibleSourceRegistrations(infoSSOTService, access, INITIAL_RACE_PROJECT_CODE),
            1,
            'initial INSERT race must leave exactly one visible registration'
        );

        const rlsWriteError = await expectRejected(
            () => infoSSOTService.withAccessContext(otherOrganizationAccess, (client) => client.query(
                `INSERT INTO knowledge_document_source_registrations (
                     organization_id, tenant_id, project_code,
                     source_class, content_type,
                     repository_owner, repository_name, branch, path_scope,
                     graph_project_id, graph_entity_id, registration_status,
                     registered_by, registry_repository
                 ) VALUES ($1, $1, $2, 'owning_repo', 'team_document', $3, $4, 'main', 'docs',
                           $5, $6, 'active', $7, $8::jsonb)`,
                [
                    ORGANIZATION_ID,
                    PROJECT_CODE,
                    REPOSITORY_OWNER,
                    REPOSITORY_NAME,
                    PROJECT_ID,
                    GRAPH_ENTITY_ID,
                    PERSON_ID,
                    JSON.stringify({ mode: 'link_existing', owner: REPOSITORY_OWNER, repo: REPOSITORY_NAME })
                ]
            )),
            '42501',
            undefined,
            'RLS must deny a cross-organization source insert'
        );
        assert.equal(rlsWriteError.code, '42501');

        return {
            ok: true,
            contract: 'knowledge-document-source-registration.postgres',
            target_commit: targetCommit,
            database: 'temporary postgres:17-alpine',
            application_role: { superuser: roleResult.rows[0].rolsuper, bypass_rls: roleResult.rows[0].rolbypassrls },
            cases: [
                'registration',
                'repository-readback',
                'resolver-pointer',
                'same-organization-project-boundary',
                'cross-organization-read-isolation',
                'cross-project-read-isolation',
                'registry-repository-mismatch',
                'registry-source-drift-rejection',
                'cross-organization-write-isolation',
                'same-key-concurrent-registration-replay',
                'different-key-concurrent-revision-conflict',
                'initial-insert-concurrent-revision-conflict'
            ],
            visible_registration_count: directReadbackCount,
            race_results: {
                same_key: {
                    revisions: sameKeyRegistrations.map((result) => result.registration.revision),
                    idempotent: sameKeyRegistrations.map((result) => result.idempotent).sort()
                },
                different_key: {
                    winner_revision: differentKeyWinner.registration.revision,
                    conflict_code: differentKeyConflict.code,
                    conflict_status: differentKeyConflict.status
                },
                initial_insert: {
                    winner_revision: initialInsertWinner.registration.revision,
                    conflict_code: initialInsertConflict.code,
                    conflict_status: initialInsertConflict.status,
                    visible_registration_count: await countVisibleSourceRegistrations(
                        infoSSOTService,
                        access,
                        INITIAL_RACE_PROJECT_CODE
                    )
                }
            },
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
    console.warn(`[SKIP] knowledge-document-source PostgreSQL integration: ${dockerReadiness.reason}`);
}

describeWithDocker.sequential('knowledge-document source registration PostgreSQL contract', () => {
    it('passes all 12 RLS, pointer, isolation, and concurrency cases', async () => {
        const result = await run();
        expect(result).toMatchObject({
            ok: true,
            contract: 'knowledge-document-source-registration.postgres',
            application_role: { superuser: false, bypass_rls: false },
            visible_registration_count: 1,
            cleanup: 'completed'
        });
        expect(result.cases).toHaveLength(12);
        expect(result.race_results).toMatchObject({
            same_key: { revisions: [2, 2], idempotent: [false, true] },
            different_key: {
                winner_revision: 3,
                conflict_code: 'knowledge_document_graph_revision_conflict',
                conflict_status: 409
            },
            initial_insert: {
                winner_revision: 1,
                conflict_code: 'knowledge_document_graph_revision_conflict',
                conflict_status: 409,
                visible_registration_count: 1
            }
        });
    }, 120_000);
});

export { run as checkKnowledgeDocumentSourcePostgres };

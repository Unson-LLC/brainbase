import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOutcomeCaseRouter } from '../../../server/routes/outcome-cases.js';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
import { OutcomeCasePostgresRepository } from '../../../server/services/outcome-case/outcome-case-postgres-repository.js';
import { createOutcomeCaseClosureAuthorityResolver } from '../../../server/services/outcome-case/outcome-case-reference-resolver.js';
import { OutcomeCaseService } from '../../../server/services/outcome-case/outcome-case-service.js';

// VibePro traceability: story-outcome-case-v1:ac:db-rls-api-roundtrip.
// This is opt-in because it applies an isolated schema to a real PostgreSQL
// instance. The local Docker launcher is
// scripts/verify-outcome-case-postgres-rls-integration.sh.
const databaseUrl = process.env.OUTCOME_CASE_DATABASE_URL || '';
const describeWithPostgres = process.env.RUN_OUTCOME_CASE_DB_TESTS === '1' && databaseUrl ? describe : describe.skip;
const { Pool } = pg;
const APP_PASSWORD = 'outcome-case-it';
const projectActor = {
    personId: 'per_owner',
    projectCodes: ['brainbase'],
    clearance: ['internal'],
    role: 'member',
    organizationId: 'org_unson'
};
const createPayload = {
    project_code: 'brainbase', capability_id: 'cap_outcome_control',
    user_observable_outcome: '利用者が外部完了を読戻せる',
    protected_constraints: ['外部読戻しなしで閉鎖しない'], non_goals: ['generic workflow'],
    selected_domain_pack: 'delivery-control/v1', current_external_state: 'processing',
    technical_story_refs: ['story-outcome-case-v1'], run_receipt_refs: ['run-initial'],
    prior_attempt_refs: [], unresolved_failure_boundary: null
};

let adminPool;
let appPool;
let schema;
let appRole;

function connectionUrl({ role, password, searchPath }) {
    const url = new URL(databaseUrl);
    url.username = role;
    url.password = password;
    if (searchPath) url.searchParams.set('options', `-csearch_path=${searchPath}`);
    return url.toString();
}

async function applySql(name) {
    const schemaPool = new Pool({ connectionString: connectionUrl({
        role: new URL(databaseUrl).username || 'postgres',
        password: new URL(databaseUrl).password || 'postgres',
        searchPath: schema
    }) });
    try {
        await schemaPool.query(await readFile(path.resolve('server/sql', name), 'utf8'));
    } finally {
        await schemaPool.end();
    }
}

function serviceFor(actor) {
    const infoSSOTService = new InfoSSOTService({ pool: appPool });
    const repository = new OutcomeCasePostgresRepository({ pool: appPool, infoSSOTService });
    const service = new OutcomeCaseService({
        repository,
        readRunReceipt: async () => ({ evidence_state: 'confirmed' }),
        resolveOutcomeReferences: async ({ projectCode, capabilityId }) => ({
            project: { ref: projectCode, state: 'confirmed' },
            capability: { ref: capabilityId, state: 'confirmed' }
        }),
        resolveClosureAuthority: createOutcomeCaseClosureAuthorityResolver({ infoSSOTService })
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.auth = { sub: actor.personId, role: actor.role };
        req.access = actor;
        next();
    });
    app.use('/api/outcome-cases', createOutcomeCaseRouter({ service }));
    return app;
}

describeWithPostgres('OutcomeCase PostgreSQL FORCE RLS API acceptance', () => {
    beforeAll(async () => {
        adminPool = new Pool({ connectionString: databaseUrl });
        schema = `outcome_case_it_${process.pid}_${Date.now()}`;
        appRole = `outcome_case_it_${process.pid}_${Date.now()}`;
        await adminPool.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${appRole} LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;`);
        await applySql('info-ssot-schema.sql');
        await applySql('outcome-case-schema.sql');
        await applySql('info-ssot-rls.sql');
        await adminPool.query(`
            GRANT USAGE ON SCHEMA ${schema} TO ${appRole};
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${appRole};
            INSERT INTO ${schema}.projects (id, code, name, organization_id)
            VALUES ('project_brainbase', 'brainbase', 'Brainbase', 'org_unson'),
                   ('project_vibepro', 'vibepro', 'VibePro', 'org_unson');
            INSERT INTO ${schema}.people (id, name)
            VALUES ('per_owner', 'OutcomeCase Owner');
            INSERT INTO ${schema}.raci_assignments
              (id, project_id, person_id, role_code, authority_scope, sensitivity_min, sensitivity)
            VALUES
              ('raci_outcome_case_close', 'project_brainbase', 'per_owner', 'outcome_case:close', '', 'member', 'internal');
        `);
        appPool = new Pool({ connectionString: connectionUrl({ role: appRole, password: APP_PASSWORD, searchPath: schema }) });
        const role = await appPool.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
        expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    }, 300_000);

    afterAll(async () => {
        await appPool?.end();
        if (schema) await adminPool?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        if (appRole) await adminPool?.query(`DROP ROLE IF EXISTS ${appRole}`);
        await adminPool?.end();
    }, 300_000);

    it('permits scoped create/read/evaluate and rejects missing, cross-project, and cross-organization API access under FORCE RLS', async () => {
        const authorized = serviceFor(projectActor);
        const created = await request(authorized).post('/api/outcome-cases').send(createPayload).expect(201);
        await request(authorized).get(`/api/outcome-cases/${created.body.case_id}`).expect(200);
        const evaluated = await request(authorized)
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .send({
                technical_evidence: { status: 'confirmed', refs: ['test:postgres-rls'] },
                run_receipt_refs: ['run-evaluation'],
                external_readback: { status: 'confirm', ref: 'external:postgres-rls' },
                constraints_status: 'satisfied', evaluator: 'request-text-is-not-authority',
                observed_at: '2026-09-04T00:00:00.000Z'
            }).expect(200);
        expect(evaluated.body).toMatchObject({ closure_status: 'closed', revision: 2 });
        expect(evaluated.body.evaluation_history).toHaveLength(1);

        const scopedInfoSSOT = new InfoSSOTService({ pool: appPool });
        await expect(scopedInfoSSOT.withAccessContext(projectActor, (client) => client.query(
            `UPDATE outcome_cases SET evaluation_history='[]'::jsonb WHERE case_id=$1`,
            [created.body.case_id]
        ))).rejects.toThrow('OUTCOME_CASE_EVALUATION_HISTORY_APPEND_ONLY');
        await expect(scopedInfoSSOT.withAccessContext(projectActor, (client) => client.query(
            `UPDATE outcome_cases
                SET evaluation_history=jsonb_build_array(jsonb_build_object('rewritten', true))
              WHERE case_id=$1`,
            [created.body.case_id]
        ))).rejects.toThrow('OUTCOME_CASE_EVALUATION_HISTORY_APPEND_ONLY');

        const crossProject = serviceFor({ ...projectActor, projectCodes: ['vibepro'] });
        await request(crossProject).get(`/api/outcome-cases/${created.body.case_id}`).expect(404);
        await request(crossProject)
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .send({ evaluator: 'per_owner' }).expect(404);

        // The globally unique project code is not a tenant boundary. The same
        // project claim in a different authenticated organization must not
        // reveal, evaluate, or insert an OutcomeCase.
        const crossOrganization = serviceFor({ ...projectActor, organizationId: 'org_other' });
        await request(crossOrganization).get(`/api/outcome-cases/${created.body.case_id}`).expect(404);
        await request(crossOrganization)
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .send({ evaluator: 'per_owner' }).expect(404);
        await request(crossOrganization).post('/api/outcome-cases').send({
            ...createPayload,
            run_receipt_refs: ['run-cross-organization']
        }).expect(403);

        const missingOrganization = serviceFor({ ...projectActor, organizationId: '' });
        const missingOrganizationResponse = await request(missingOrganization)
            .post('/api/outcome-cases').send(createPayload).expect(403);
        expect(missingOrganizationResponse.body).toMatchObject({
            error: 'outcome_case_organization_access_denied',
            details: { audit_event: 'outcome_case_unknown_tenant_denied' }
        });
    });

    it('does not derive closure authority from an internal RACI assignment when authenticated clearance is empty', async () => {
        const noClearanceActor = { ...projectActor, clearance: [] };
        const app = serviceFor(noClearanceActor);
        const created = await request(app).post('/api/outcome-cases').send(createPayload).expect(201);
        const evaluated = await request(app)
            .post(`/api/outcome-cases/${created.body.case_id}/evaluations`)
            .send({
                technical_evidence: { status: 'confirmed', refs: ['test:empty-clearance'] },
                run_receipt_refs: ['run-empty-clearance'],
                external_readback: { status: 'confirm', ref: 'external:empty-clearance' },
                constraints_status: 'satisfied', evaluator: 'per_owner',
                observed_at: '2026-09-04T00:00:00.000Z'
            }).expect(200);

        expect(evaluated.body).toMatchObject({
            closure_status: 'waiting_human',
            authority: {
                state: 'unresolved',
                closure_authorized_person_ids: [],
                reason: 'closure_authority_not_found'
            }
        });
        expect(evaluated.body.evaluation_history[0].authority).toMatchObject({
            state: 'unresolved',
            reason: 'closure_authority_not_found'
        });
    });
});

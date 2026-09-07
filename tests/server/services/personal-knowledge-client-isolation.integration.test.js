// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';

import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requirePersonalKnowledgeAccess } from '../../../server/middleware/personal-knowledge-access.js';
import { requirePersonalKnowledgeCompanyAuthority } from '../../../server/middleware/personal-knowledge-company-authority.js';
import { createPersonalKnowledgeRouter } from '../../../server/routes/personal-knowledge.js';
import { PersonalKnowledgeService } from '../../../server/services/personal-knowledge/personal-knowledge-service.js';
import { PgPersonalKnowledgeRepository } from '../../../server/services/personal-knowledge/pg-personal-knowledge-repository.js';
import { createPersonalKnowledgeAuthority } from '../../helpers/personal-knowledge-client-authority.js';

async function availablePort() {
    const socket = net.createServer();
    await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.listen(0, '127.0.0.1', resolve);
    });
    const { port } = socket.address();
    await new Promise((resolve) => socket.close(resolve));
    return port;
}

describe('personal knowledge client PostgreSQL isolation', () => {
    let adminPool;
    let pool;
    let postgresBin;
    let dataDirectory;
    let ownerRole;
    let app;

    beforeAll(async () => {
        let databaseUrl = process.env.PERSONAL_KNOWLEDGE_CLIENT_DATABASE_URL;
        if (!databaseUrl) {
            postgresBin = [process.env.PG_BIN_DIR, '/usr/local/opt/postgresql@16/bin',
                '/opt/homebrew/opt/postgresql@16/bin', '/usr/lib/postgresql/16/bin',
                '/usr/lib/postgresql/15/bin'].filter(Boolean)
                .find((candidate) => fs.existsSync(path.join(candidate, 'initdb')));
            if (!postgresBin) throw new Error('Set PERSONAL_KNOWLEDGE_CLIENT_DATABASE_URL or PG_BIN_DIR for a disposable PostgreSQL instance');
            const root = process.env.PERSONAL_KNOWLEDGE_TEST_TMPDIR || os.tmpdir();
            fs.mkdirSync(root, { recursive: true });
            dataDirectory = fs.mkdtempSync(path.join(root, 'brainbase-pkg-client-'));
            const port = await availablePort();
            execFileSync(path.join(postgresBin, 'initdb'), ['-D', dataDirectory, '--auth=trust', '--no-locale'], { stdio: 'ignore' });
            execFileSync(path.join(postgresBin, 'pg_ctl'), ['-D', dataDirectory,
                '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start'], { stdio: 'ignore' });
            databaseUrl = `postgresql://127.0.0.1:${port}/postgres`;
        }
        adminPool = new pg.Pool({ connectionString: databaseUrl });
        ownerRole = `personal_kg_client_${process.pid}`;
        const password = `test-only-${process.pid}`;
        await adminPool.query(`CREATE ROLE ${ownerRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
        await adminPool.query(`GRANT CREATE ON SCHEMA public TO ${ownerRole}`);
        const url = new URL(databaseUrl);
        url.username = ownerRole;
        url.password = password;
        // One reused connection also verifies that transaction-local identity does not leak.
        pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
        await pool.query(`CREATE OR REPLACE FUNCTION app_project_codes()
            RETURNS TEXT[] LANGUAGE sql STABLE AS $$ SELECT ARRAY[]::TEXT[] $$`);
        for (const file of ['knowledge-event-schema.sql', 'personal-knowledge-schema.sql']) {
            await pool.query(fs.readFileSync(path.resolve('server/sql', file), 'utf8'));
        }
        const service = new PersonalKnowledgeService({ repository: new PgPersonalKnowledgeRepository({ pool }) });
        app = express();
        app.use(express.json());
        // Synthetic authenticated principals; production authentication runs before this guard.
        app.use((req, _res, next) => {
            const principals = {
                alice: { personId: 'person_alice', organizationId: 'org_a' },
                bob: { personId: 'person_bob', organizationId: 'org_a' },
                otherOrg: { personId: 'person_alice', organizationId: 'org_b' }
            };
            const principal = req.get('x-test-principal');
            req.authSource = principal === 'mana' ? 'service-token' : 'jwt';
            req.access = principal === 'mana' ? { projectCodes: ['project-a'] } : { ...principals[principal] };
            next();
        });
        const connectionRegistry = {
            resolveProjectBindingById: async ({ tenant_id, project_id }) => ({
                tenant_id,
                project_id,
                project_code: 'project-a',
                project_status: 'active'
            })
        };
        app.use('/api/personal-knowledge',
            requirePersonalKnowledgeCompanyAuthority({
                env: createPersonalKnowledgeAuthority().env,
                connectionRegistry
            }),
            requirePersonalKnowledgeAccess(),
            createPersonalKnowledgeRouter({ personalKnowledgeService: service, promotionService: {} }));
    }, 60_000);

    afterAll(async () => {
        await pool?.end();
        if (adminPool && ownerRole) {
            await adminPool.query(`DROP OWNED BY ${ownerRole} CASCADE`);
            await adminPool.query(`DROP ROLE ${ownerRole}`);
        }
        await adminPool?.end();
        if (dataDirectory) {
            execFileSync(path.join(postgresBin, 'pg_ctl'), ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
            fs.rmSync(dataDirectory, { recursive: true, force: true });
        }
    });

    it('persists and reads only the authenticated owner and organization through a reused connection', async () => {
        for (const principal of ['alice', 'bob', 'otherOrg']) {
            const body = `private-client-fixture-${principal}`;
            await request(app).post('/api/personal-knowledge/events')
                .set('x-test-principal', principal).send({
                    event_id: `pke_client_${principal}`, body,
                    body_hash: `sha256:${createHash('sha256').update(body).digest('hex')}`,
                    source: { type: 'manual' }, source_pointer: { fixture: principal }
                }).expect(201);
        }
        for (const principal of ['alice', 'bob', 'otherOrg', 'alice']) {
            const response = await request(app).get('/api/personal-knowledge/search')
                .query({ q: 'private-client-fixture' }).set('x-test-principal', principal).expect(200);
            expect(JSON.stringify(response.body)).toContain(`pke_client_${principal}`);
            for (const other of ['alice', 'bob', 'otherOrg'].filter((item) => item !== principal)) {
                expect(JSON.stringify(response.body)).not.toContain(`pke_client_${other}`);
            }
        }
        const contract = await pool.query(`SELECT r.rolsuper, r.rolbypassrls, c.relrowsecurity, c.relforcerowsecurity
            FROM pg_roles r JOIN pg_class c ON c.oid = 'personal_knowledge_events'::regclass
            WHERE r.rolname = current_user`);
        expect(contract.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, relrowsecurity: true, relforcerowsecurity: true });
        await expect(pool.query('SELECT * FROM personal_knowledge_events')).rejects.toMatchObject({ code: '42501' });
    });

    it('rejects model-supplied owner or organization before writing', async () => {
        for (const spoof of [{ owner_person_id: 'person_bob' }, { organization_id: 'org_b' }]) {
            await request(app).post('/api/personal-knowledge/events').set('x-test-principal', 'alice')
                .send({ ...spoof, body: 'must-not-persist', body_hash: 'sha256:spoof' }).expect(403);
        }
        const response = await request(app).get('/api/personal-knowledge/search')
            .query({ q: 'must-not-persist' }).set('x-test-principal', 'alice').expect(200);
        expect(JSON.stringify(response.body)).not.toContain('must-not-persist');
    });

    it('does not report a successful write when an event ID belongs to another owner', async () => {
        await request(app).post('/api/personal-knowledge/events').set('x-test-principal', 'bob')
            .send({ event_id: 'pke_client_alice', body: 'colliding-private-event', body_hash: 'sha256:collision' })
            .expect(400, { error: 'personal_knowledge_event_identity_conflict' });
    });

    it('allows different owners to register identical input and keeps each owner retry idempotent', async () => {
        const payload = { body: 'same-private-input', body_hash: 'sha256:same-input' };
        const ids = [];
        for (const principal of ['alice', 'bob']) {
            const first = await request(app).post('/api/personal-knowledge/events')
                .set('x-test-principal', principal).send(payload).expect(201);
            const retry = await request(app).post('/api/personal-knowledge/events')
                .set('x-test-principal', principal).send(payload).expect(201);
            expect(retry.body.event_id).toBe(first.body.event_id);
            expect(retry.body.idempotent).toBe(true);
            ids.push(first.body.event_id);
        }
        expect(new Set(ids).size).toBe(2);
    });

    it('round-trips signed Mana writes through the real database without disclosing them to another DM owner', async () => {
        const body = 'signed-mana-private-client-fixture';
        const payload = {
            event_id: 'pke_signed_mana', body,
            body_hash: `sha256:${createHash('sha256').update(body).digest('hex')}`,
            source: { type: 'slack' }, source_pointer: { fixture: 'mana-dm' }
        };
        const registered = await request(app).post('/api/personal-knowledge/events')
            .set('x-test-principal', 'mana').send({ ...payload,
                company_authority_response: createPersonalKnowledgeAuthority({
                    effect: 'write', project: 'project-id-a'
                }).response
            }).expect(201);
        expect(registered.body.owner_person_id).toBe('person-sato');
        expect(registered.body).not.toHaveProperty('company_authority_response');
        const read = await request(app).post('/api/personal-knowledge/search')
            .set('x-test-principal', 'mana').send({ query: body,
                company_authority_response: createPersonalKnowledgeAuthority({ project: 'project-id-a' }).response
            }).expect(200);
        expect(read.body).toHaveLength(1);
        expect(read.body[0]).toMatchObject({ ...payload, owner_person_id: 'person-sato', organization_id: 'organization-tenant-a' });
        const other = await request(app).post('/api/personal-knowledge/search')
            .set('x-test-principal', 'mana').send({ query: body,
                company_authority_response: createPersonalKnowledgeAuthority({
                    owner: 'person-other', channel: 'DOTHER', project: 'project-id-a'
                }).response
            }).expect(200);
        expect(other.body).toEqual([]);
        await request(app).post('/api/personal-knowledge/events')
            .set('x-test-principal', 'mana').send({ ...payload, event_id: 'pke_wrong_effect',
                company_authority_response: createPersonalKnowledgeAuthority().response
            }).expect(403);
    });
});

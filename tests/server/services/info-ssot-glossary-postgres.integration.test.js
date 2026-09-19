import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';

const { Pool } = pg;
const runIntegration = ['1', 'true'].includes((process.env.BRAINBASE_RUN_DOCKER_INTEGRATION || '').toLowerCase());
const describeWithDocker = runIntegration ? describe : describe.skip;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describeWithDocker('InfoSSOT glossary PostgreSQL integration', () => {
    let container;
    let pool;

    beforeAll(async () => {
        container = await new PostgreSqlContainer('postgres:16-alpine').start();
        pool = new Pool({ connectionString: container.getConnectionUri() });
        await pool.query(await readFile(path.join(root, 'server/sql/info-ssot-schema.sql'), 'utf8'));
        await pool.query(`
            INSERT INTO projects (id, code, name) VALUES ('prj_brainbase', 'brainbase', 'Brainbase');
            INSERT INTO people (id, name) VALUES ('per_actor', '認証済み利用者');
            INSERT INTO graph_entities (id, entity_type, project_id, payload, role_min, sensitivity)
            VALUES ('prj_brainbase', 'project', 'prj_brainbase', '{"code":"brainbase"}', 'member', 'internal');
        `);
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await container?.stop();
    });

    it('persists the authenticated actor and reads back event, entity, and edge', async () => {
        const service = new InfoSSOTService({ pool });
        const result = await service.createGlossaryTerm({
            personId: 'per_actor',
            role: 'gm',
            projectCodes: ['brainbase'],
            clearance: ['internal']
        }, {
            projectCode: 'brainbase',
            term: 'KI',
            correctForm: '経営AI'
        });

        expect(result.readback_verified).toBe(true);
        const event = await pool.query('SELECT actor_person_id FROM events WHERE id = $1', [result.event_id]);
        const entity = await pool.query('SELECT payload FROM graph_entities WHERE id = $1', [result.glossary_term_id]);
        const edge = await pool.query(
            "SELECT rel_type FROM graph_edges WHERE from_id = $1 AND to_id = 'prj_brainbase'",
            [result.glossary_term_id]
        );
        expect(event.rows).toEqual([{ actor_person_id: 'per_actor' }]);
        expect(entity.rows[0].payload).toMatchObject({ term: 'KI', correct_form: '経営AI' });
        expect(edge.rows).toEqual([{ rel_type: 'belongs_to_project' }]);
    });
});

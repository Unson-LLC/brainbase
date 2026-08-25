import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { Pool } = pg;
const readSql = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('Personal Knowledge promotion migration upgrade path', () => {
    let pool;
    let dataDirectory;
    let postgresBin;
    const port = 55439;

    beforeAll(async () => {
        const externalDatabaseUrl = process.env.PERSONAL_KNOWLEDGE_MIGRATION_DATABASE_URL;
        if (externalDatabaseUrl) {
            // CI supplies a disposable PostgreSQL service. Keeping the test's
            // schema setup below means this still exercises the real migration
            // against PostgreSQL rather than a mocked repository.
            pool = new Pool({ connectionString: externalDatabaseUrl });
        } else {
            const candidates = [
                process.env.PG_BIN_DIR,
                '/usr/local/opt/postgresql@16/bin',
                '/opt/homebrew/opt/postgresql@16/bin',
                '/usr/lib/postgresql/16/bin',
                '/usr/lib/postgresql/15/bin'
            ].filter(Boolean);
            postgresBin = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'initdb')));
            if (!postgresBin) {
                try {
                    postgresBin = path.dirname(execFileSync('which', ['initdb'], { encoding: 'utf8' }).trim());
                } catch {
                    throw new Error('PostgreSQL initdb is required; set PERSONAL_KNOWLEDGE_MIGRATION_DATABASE_URL or PG_BIN_DIR');
                }
            }
            dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-pkg-migration-'));
            execFileSync(path.join(postgresBin, 'initdb'), ['-D', dataDirectory, '--auth=trust', '--no-locale'], { stdio: 'ignore' });
            execFileSync(path.join(postgresBin, 'pg_ctl'), [
                '-D', dataDirectory, '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start'
            ], { stdio: 'ignore' });
            pool = new Pool({ connectionString: `postgresql://127.0.0.1:${port}/postgres` });
        }
        await pool.query(`
          CREATE OR REPLACE FUNCTION app_project_codes()
          RETURNS TEXT[] LANGUAGE sql STABLE AS $$ SELECT ARRAY[]::TEXT[] $$;
        `);
        await pool.query(readSql('server/sql/knowledge-event-schema.sql'));
        await pool.query(readSql('server/sql/personal-knowledge-schema.sql'));

        await pool.query(`
          INSERT INTO personal_knowledge_events
            (event_id, owner_person_id, organization_id, occurred_at, source,
             source_pointer, body, body_hash, sensitivity)
          VALUES
            ('pke_upgrade_1', 'person_owner', 'org_a', NOW(), '{"type":"manual"}',
             '{"fixture":"upgrade"}', 'private fixture', 'sha256:fixture', 'personal');
          ALTER TABLE knowledge_promotion_requests
            DROP CONSTRAINT knowledge_promotion_requests_status_check;
          INSERT INTO knowledge_promotion_requests
            (request_id, personal_event_id, owner_person_id, organization_id,
             project_code, status, sanitized_preview, subject, body_hash, decided_at)
          VALUES
            ('kpr_upgrade_1', 'pke_upgrade_1', 'person_owner', 'org_a',
             'brainbase', 'pending_org_review', 'safe fixture', '{"type":"decision","id":"fixture"}',
             'sha256:fixture', NOW());
        `);

        // Reproduce the guard installed by the previous production release.
        await pool.query(`
          CREATE OR REPLACE FUNCTION enforce_knowledge_promotion_status_transition()
          RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.status = OLD.status THEN RETURN NEW; END IF;
            IF OLD.status = 'pending_owner_approval' AND NEW.status IN ('owner_rejected', 'pending_org_review') THEN RETURN NEW; END IF;
            IF OLD.status = 'pending_org_review' AND NEW.status IN ('org_accepted', 'org_rejected') THEN RETURN NEW; END IF;
            RAISE EXCEPTION 'Invalid knowledge promotion status transition: % -> %', OLD.status, NEW.status;
          END $$;
          DROP TRIGGER IF EXISTS knowledge_promotion_status_guard ON knowledge_promotion_requests;
          CREATE TRIGGER knowledge_promotion_status_guard
            BEFORE UPDATE OF status ON knowledge_promotion_requests
            FOR EACH ROW EXECUTE FUNCTION enforce_knowledge_promotion_status_transition();
        `);
    }, 60_000);

    afterAll(async () => {
        await pool?.end();
        if (dataDirectory) {
            execFileSync(path.join(postgresBin, 'pg_ctl'), ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
            fs.rmSync(dataDirectory, { recursive: true, force: true });
        }
    });

    it('normalizes legacy rows behind an existing guard and is re-applicable', async () => {
        const migration = readSql('server/sql/personal-knowledge-two-stage-promotion.sql');
        await pool.query(`BEGIN; ${migration}; COMMIT;`);
        await pool.query(`BEGIN; ${migration}; COMMIT;`);

        const { rows } = await pool.query(`
          SELECT status, owner_decided_at, owner_consent_receipt_id
          FROM knowledge_promotion_requests WHERE request_id = 'kpr_upgrade_1'
        `);
        expect(rows).toEqual([{
            status: 'pending_owner_approval',
            owner_decided_at: null,
            owner_consent_receipt_id: null
        }]);
    }, 30_000);
});

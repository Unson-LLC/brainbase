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
    let databaseUrl;
    let receiptDirectory;
    const port = 55439;

    beforeAll(async () => {
        const externalDatabaseUrl = process.env.PERSONAL_KNOWLEDGE_MIGRATION_DATABASE_URL;
        if (externalDatabaseUrl) {
            // CI supplies a disposable PostgreSQL service. Keeping the test's
            // schema setup below means this still exercises the real migration
            // against PostgreSQL rather than a mocked repository.
            pool = new Pool({ connectionString: externalDatabaseUrl });
            databaseUrl = externalDatabaseUrl;
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
            databaseUrl = `postgresql://127.0.0.1:${port}/postgres`;
            pool = new Pool({ connectionString: databaseUrl });
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
          ALTER TABLE knowledge_promotion_requests
            ADD COLUMN normalized_payload JSONB,
            ADD COLUMN normalized_payload_hash TEXT,
            ADD COLUMN normalization_contract_version TEXT,
            ADD COLUMN normalized_by_person_id TEXT,
            ADD COLUMN normalized_at TIMESTAMPTZ;
          INSERT INTO knowledge_promotion_requests
            (request_id, personal_event_id, owner_person_id, organization_id,
             project_code, status, sanitized_preview, subject, body_hash, decided_at)
          VALUES
            ('kpr_upgrade_1', 'pke_upgrade_1', 'person_owner', 'org_a',
             'brainbase', 'pending_org_review', 'safe fixture', '{"type":"decision","id":"fixture"}',
             'sha256:fixture', NOW());
          UPDATE knowledge_promotion_requests
          SET normalized_payload_hash = 'sha256:${'a'.repeat(64)}',
              normalization_contract_version = 'personal_knowledge_normalized.v1',
              normalized_by_person_id = 'person_owner',
              normalized_at = NOW()
          WHERE request_id = 'kpr_upgrade_1';
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
        if (receiptDirectory) fs.rmSync(receiptDirectory, { recursive: true, force: true });
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
          SELECT status, owner_decided_at, owner_consent_receipt_id,
                 normalization_contract_version, normalized_payload,
                 normalized_payload_hash, normalized_by_person_id, normalized_at
          FROM knowledge_promotion_requests WHERE request_id = 'kpr_upgrade_1'
        `);
        expect(rows).toEqual([{
            status: 'pending_owner_approval',
            owner_decided_at: null,
            owner_consent_receipt_id: null,
            normalization_contract_version: null,
            normalized_payload: null,
            normalized_payload_hash: null,
            normalized_by_person_id: null,
            normalized_at: null
        }]);
    }, 30_000);

    it('runs preflight and postflight against the real database and writes a passed Receipt', async () => {
        await pool.query(`
          ALTER TABLE knowledge_promotion_requests
            DROP CONSTRAINT knowledge_promotion_normalized_payload_check,
            DROP CONSTRAINT knowledge_promotion_owner_consent_evidence_check,
            DROP CONSTRAINT knowledge_promotion_org_acceptance_evidence_check;
          DROP TRIGGER IF EXISTS knowledge_promotion_status_guard ON knowledge_promotion_requests;
          DROP TRIGGER IF EXISTS knowledge_promotion_evidence_guard ON knowledge_promotion_requests;
          UPDATE knowledge_promotion_requests
          SET status = 'pending_org_review',
              normalized_payload_hash = 'sha256:${'b'.repeat(64)}',
              normalization_contract_version = 'personal_knowledge_normalized.v1',
              normalized_by_person_id = 'person_owner',
              normalized_at = NOW(),
              owner_decided_at = NOW()
          WHERE request_id = 'kpr_upgrade_1';
        `);
        receiptDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-pkg-release-'));
        const receiptPath = path.join(receiptDirectory, 'receipt.json');
        const targetSha = 'c'.repeat(40);
        const gate = path.resolve(process.cwd(), 'scripts/personal-knowledge-migration-release-gate.mjs');
        const env = { ...process.env, TARGET_SHA: targetSha, M5A_DATABASE_URL: databaseUrl };

        execFileSync(process.execPath, [gate, 'preflight', receiptPath], { env, stdio: 'pipe' });
        await pool.query(`BEGIN; ${readSql('server/sql/personal-knowledge-two-stage-promotion.sql')}; COMMIT;`);
        execFileSync(process.execPath, [gate, 'postflight', receiptPath], { env, stdio: 'pipe' });

        const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        expect(receipt).toMatchObject({ status: 'passed', target_sha: targetSha });
        expect(receipt.before.target_request_ids).toEqual(['kpr_upgrade_1']);
        expect(fs.statSync(receiptPath).mode & 0o777).toBe(0o600);
    }, 30_000);
});

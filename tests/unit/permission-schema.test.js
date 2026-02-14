import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * TC-SCHEMA-001, 002, 003, 005, 009, 010
 * DBスキーマテスト（Permission System Phase 1）
 */

const describeWithPermissionDb = process.env.TEST_PERMISSION_DB_URL ? describe : describe.skip;

describeWithPermissionDb('Permission Schema Tests', () => {
    let pool;
    let testDbUrl;

    beforeAll(async () => {
        // テスト用DBの接続情報（環境変数から取得）
        testDbUrl = process.env.TEST_PERMISSION_DB_URL;

        if (!testDbUrl) {
            throw new Error('TEST_PERMISSION_DB_URL is not set');
        }

        pool = new Pool({ connectionString: testDbUrl });

        // テスト前にテーブルをクリーンアップ（外部キー制約の順序考慮）
        await pool.query('DROP TABLE IF EXISTS permission_audit_log CASCADE');
        await pool.query('DROP TABLE IF EXISTS user_organizations CASCADE');
        await pool.query('DROP TABLE IF EXISTS users CASCADE');
        await pool.query('DROP TABLE IF EXISTS people CASCADE');
        await pool.query('DROP TABLE IF EXISTS organizations CASCADE');
    });

    afterAll(async () => {
        if (pool) {
            await pool.end();
        }
    });

    describe('TC-SCHEMA-001: 全テーブル作成成功', () => {
        it('schema.sqlを実行すると5つのテーブルが作成される', async () => {
            // Given: 空のPostgreSQLデータベース
            // When: schema.sqlを実行
            const schemaPath = join(__dirname, '../../server/sql/permission-schema.sql');
            const schemaSql = readFileSync(schemaPath, 'utf-8');
            await pool.query(schemaSql);

            // Then: 5つのテーブル（organizations, people, users, user_organizations, permission_audit_log）が作成される
            const { rows } = await pool.query(`
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_type = 'BASE TABLE'
                ORDER BY table_name
            `);

            const tableNames = rows.map(r => r.table_name);
            expect(tableNames).toContain('organizations');
            expect(tableNames).toContain('people');
            expect(tableNames).toContain('users');
            expect(tableNames).toContain('user_organizations');
            expect(tableNames).toContain('permission_audit_log');
        });
    });

    describe('TC-SCHEMA-002: organizationsテーブルの初期データ投入', () => {
        it('schema.sql実行後にunson, salestailor, techknightの3行が存在する', async () => {
            // Given: schema.sqlで初期データがINSERT
            // When: SELECT * FROM organizations
            const { rows } = await pool.query('SELECT * FROM organizations ORDER BY id');

            // Then: 3行が存在（ORDER BY idでアルファベット順）
            expect(rows).toHaveLength(3);
            expect(rows[0].id).toBe('salestailor');
            expect(rows[1].id).toBe('techknight');
            expect(rows[2].id).toBe('unson');

            // 各organizationにprojects配列が存在することを確認
            expect(Array.isArray(rows[0].projects)).toBe(true);
            expect(Array.isArray(rows[1].projects)).toBe(true);
            expect(Array.isArray(rows[2].projects)).toBe(true);
        });
    });

    describe('TC-SCHEMA-003: usersテーブル UNIQUE制約（slack_user_id重複拒否）', () => {
        it('同じslack_user_idで別のレコードをINSERTすると23505エラー', async () => {
            // Given: slack_user_id='U07LNUP582X'のレコードが存在
            await pool.query(`INSERT INTO people (id, name) VALUES ('test_person_1', 'Test User 1')`);
            await pool.query(`
                INSERT INTO users (slack_user_id, person_id, workspace_id, name, access_level, employment_type, status)
                VALUES ('U07LNUP582X', 'test_person_1', 'unson', 'Test User 1', 1, 'contractor', 'active')
            `);

            // When: 同じslack_user_idで別のレコードをINSERT
            // Then: UNIQUE制約違反エラー（23505）（slack_user_idがPKなので重複不可）
            await pool.query(`INSERT INTO people (id, name) VALUES ('test_person_2', 'Test User 2')`);
            await expect(async () => {
                await pool.query(`
                    INSERT INTO users (slack_user_id, person_id, workspace_id, name, access_level, employment_type, status)
                    VALUES ('U07LNUP582X', 'test_person_2', 'unson', 'Test User 2', 1, 'contractor', 'active')
                `);
            }).rejects.toThrow(/duplicate key value violates unique constraint/);
        });
    });

    describe('TC-SCHEMA-005: user_organizations 外部キー制約（usersへの参照整合性）', () => {
        it('存在しないslack_user_idをINSERTすると外部キー制約違反エラー', async () => {
            // Given: usersテーブルに slack_user_id='nonexistent_user'が存在しない
            // When: user_organizationsに slack_user_id='nonexistent_user'をINSERT
            // Then: 外部キー制約違反エラー
            await expect(async () => {
                await pool.query(`
                    INSERT INTO user_organizations (slack_user_id, organization_id, projects)
                    VALUES ('nonexistent_user', 'unson', ARRAY['zeims'])
                `);
            }).rejects.toThrow(/violates foreign key constraint/);
        });
    });

    describe('TC-SCHEMA-009: usersテーブル デフォルト値の検証', () => {
        it('必須カラムのみ指定してINSERTすると適切なデフォルト値が設定される', async () => {
            // Given: usersテーブルとorganizationsテーブルが存在
            // organizationsデータを確保（workspace_id外部キー制約のため）
            await pool.query(`
                INSERT INTO organizations (id, name, workspace_id, projects) VALUES
                ('unson', 'UNSON', 'T089CNQ4D1A', ARRAY['zeims'])
                ON CONFLICT (id) DO NOTHING
            `);

            // When: 最小限のカラムのみ指定してINSERT
            await pool.query(`INSERT INTO people (id, name) VALUES ('test_default_person', 'Default Test User')`);
            await pool.query(`
                INSERT INTO users (slack_user_id, person_id, workspace_id, name)
                VALUES ('U_DEFAULT_TEST', 'test_default_person', 'unson', 'Default Test User')
            `);

            // Then: デフォルト値が設定される
            const { rows } = await pool.query(`
                SELECT * FROM users WHERE slack_user_id = 'U_DEFAULT_TEST'
            `);

            expect(rows).toHaveLength(1);
            const user = rows[0];

            expect(user.access_level).toBe(1);
            expect(user.employment_type).toBe('contractor');
            expect(user.status).toBe('active');
            expect(user.created_at).toBeDefined();
            expect(user.updated_at).toBeDefined();
        });
    });

    describe('TC-SCHEMA-010: インデックス作成の検証', () => {
        it('schema.sql実行後に必要なインデックスが存在する', async () => {
            // Given: schema.sql実行済み
            // When: pg_indexesからインデックス一覧を取得
            const { rows } = await pool.query(`
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = 'public'
                AND tablename IN ('users', 'user_organizations', 'permission_audit_log')
                ORDER BY indexname
            `);

            const indexNames = rows.map(r => r.indexname);

            // Then: 必要なインデックスが存在（Phase 1スキーマ）
            // usersテーブル
            expect(indexNames).toContain('idx_users_person_id');
            expect(indexNames).toContain('idx_users_workspace_id');
            expect(indexNames).toContain('idx_users_status');
            // user_organizationsテーブル
            expect(indexNames).toContain('idx_user_organizations_slack_user_id');
            expect(indexNames).toContain('idx_user_organizations_organization_id');
            // permission_audit_logテーブル
            expect(indexNames).toContain('idx_permission_audit_log_slack_user_id');
            expect(indexNames).toContain('idx_permission_audit_log_changed_at');
        });
    });
});

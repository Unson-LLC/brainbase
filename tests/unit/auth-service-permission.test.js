import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * TC-AUTH-001, 002, 005, 006
 * 認証テスト（auth-service.js）- Permission System拡張
 */

const describeWithPermissionDb = process.env.TEST_PERMISSION_DB_URL ? describe : describe.skip;

describeWithPermissionDb('Auth Service Permission Tests', () => {
    let pool;
    let testDbUrl;
    let authService;
    const jwtSecret = 'test_jwt_secret';

    beforeAll(async () => {
        testDbUrl = process.env.TEST_PERMISSION_DB_URL;

        if (!testDbUrl) {
            throw new Error('TEST_PERMISSION_DB_URL is not set');
        }

        pool = new Pool({ connectionString: testDbUrl });

        // スキーマ作成（テスト独立性確保）
        const schemaPath = join(__dirname, '../../server/sql/permission-schema.sql');
        const schemaSql = readFileSync(schemaPath, 'utf-8');
        await pool.query(schemaSql);

        // AuthServiceをインポート（動的インポート）
        const { AuthService } = await import('../../server/services/auth-service.js');

        // テスト用の環境変数を設定
        process.env.INFO_SSOT_DATABASE_URL = testDbUrl;
        process.env.BRAINBASE_JWT_SECRET = jwtSecret;
        process.env.SLACK_CLIENT_ID = 'test_client_id';
        process.env.SLACK_CLIENT_SECRET = 'test_client_secret';
        process.env.SLACK_REDIRECT_URI = 'http://localhost:31013/auth/callback';

        authService = new AuthService();
    });

    afterAll(async () => {
        if (pool) {
            await pool.end();
        }
    });

    beforeEach(async () => {
        // テーブルクリーンアップ（外部キー制約を考慮した順序）
        await pool.query('TRUNCATE TABLE permission_audit_log CASCADE');
        await pool.query('TRUNCATE TABLE user_organizations CASCADE');
        await pool.query('TRUNCATE TABLE users CASCADE');
        await pool.query('TRUNCATE TABLE people CASCADE');

        // テスト用organizationsデータを再投入（既存データがあるため）
        await pool.query(`
            INSERT INTO organizations (id, name, workspace_id) VALUES
            ('unson', 'UNSON', 'T089CNQ4D1A'),
            ('salestailor', 'SalesTailor', 'T08FB9S7HUL'),
            ('techknight', 'Tech Knight', 'T07AF0YNSDA')
            ON CONFLICT (id) DO NOTHING
        `);
    });

    describe('TC-AUTH-001: 正常系 - Slack ID → DB検索 → JWT発行', () => {
        it('登録済みユーザーでSlack OAuthコールバックが成功しJWTが発行される', async () => {
            // Given: DBにユーザー test_user (slack_user_id: U07LNUP582X)が登録済み
            // 1. peopleレコード作成
            await pool.query(`
                INSERT INTO people (id, name) VALUES ('test_user', 'テストユーザー')
            `);
            // 2. usersレコード作成
            await pool.query(`
                INSERT INTO users (slack_user_id, person_id, workspace_id, name, access_level, employment_type, status)
                VALUES ('U07LNUP582X', 'test_user', 'unson', 'テストユーザー', 4, 'executive', 'active')
            `);

            // When: Slack OAuthコールバックで slack_user_id='U07LNUP582X'が渡される
            const user = await authService.findUserBySlackId('U07LNUP582X');

            // Then: ユーザーが見つかる
            expect(user).toBeDefined();
            expect(user.person_id).toBe('test_user');
            expect(user.slack_user_id).toBe('U07LNUP582X');
            expect(user.access_level).toBe(4);

            // JWTが発行される
            const token = authService.issueToken({
                sub: user.person_id,
                slackUserId: user.slack_user_id,
                level: user.access_level,
                employmentType: user.employment_type,
                tenantId: null
            });

            expect(token).toBeDefined();
            expect(typeof token).toBe('string');
        });
    });

    describe('TC-AUTH-002: JWT Payloadの内容検証（Level 4ユーザー）', () => {
        it('JWT発行後にペイロードをデコードすると正しい内容が含まれる', async () => {
            // Given: DBにユーザー test_user が access_level=4, employment_type='executive'で登録済み
            await pool.query(`
                INSERT INTO people (id, name) VALUES ('test_user', 'テストユーザー')
            `);
            await pool.query(`
                INSERT INTO users (slack_user_id, person_id, workspace_id, name, access_level, employment_type, status)
                VALUES ('U07LNUP582X', 'test_user', 'unson', 'テストユーザー', 4, 'executive', 'active')
            `);

            // When: JWT発行
            const token = authService.issueToken({
                sub: 'test_user',
                slackUserId: 'U07LNUP582X',
                level: 4,
                employmentType: 'executive',
                tenantId: null
            });

            // Then: ペイロードに正しい内容が含まれる
            const decoded = jwt.verify(token, jwtSecret);

            expect(decoded.sub).toBe('test_user');
            expect(decoded.slackUserId).toBe('U07LNUP582X');
            expect(decoded.level).toBe(4);
            expect(decoded.employmentType).toBe('executive');
            expect(decoded.tenantId).toBeNull();
            expect(decoded.iat).toBeDefined();
            expect(decoded.exp).toBeDefined();
        });
    });

    describe('TC-AUTH-005: 異常系 - 未登録ユーザー（404エラー）', () => {
        it('DBに存在しないslack_user_idで認証するとエラー', async () => {
            // Given: DBに slack_user_id='U000000XXXX'のユーザーが存在しない
            // When: Slack OAuthコールバックで slack_user_id='U000000XXXX'が渡される
            // Then: エラーがスローされる（またはnullが返される）

            await expect(async () => {
                const user = await authService.findUserBySlackId('U000000XXXX');
                if (!user) {
                    throw new Error('User not registered in members.yml');
                }
            }).rejects.toThrow('User not registered in members.yml');
        });
    });

    describe('TC-AUTH-006: 異常系 - inactiveユーザー（仕様確定: ブロック）', () => {
        it('status="inactive"のユーザーは認証がブロックされる（403/404）', async () => {
            // Given: DBにユーザー test_user_info（infoアカウント）が status='inactive'で登録済み
            await pool.query(`
                INSERT INTO people (id, name) VALUES ('test_user_info', 'テストユーザー')
            `);
            await pool.query(`
                INSERT INTO users (slack_user_id, person_id, workspace_id, name, access_level, employment_type, status)
                VALUES ('U_INFO_INACTIVE', 'test_user_info', 'unson', 'テストユーザー（info）', 4, 'executive', 'inactive')
            `);

            // When: Slack OAuthコールバックで該当slack_user_idが渡される
            const user = await authService.findUserBySlackId('U_INFO_INACTIVE');

            // Then: 認証拒否（findUserBySlackIdはWHERE status='active'でクエリするため、nullを返す）
            expect(user).toBeNull();
        });
    });
});

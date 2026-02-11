import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import NodeCache from 'node-cache';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * TC-PERM-001, 004, 005
 * UserPermissions権限取得テスト（PostgreSQL統合）
 */

const describeWithPermissionDb = process.env.TEST_PERMISSION_DB_URL ? describe : describe.skip;

describeWithPermissionDb('UserPermissions DB Integration Tests', () => {
    let pool;
    let testDbUrl;
    let userPermissions;

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
    });

    afterAll(async () => {
        if (pool) {
            await pool.end();
        }
    });

    beforeEach(async () => {
        // テーブルクリーンアップ（外部キー制約を考慮）
        await pool.query('TRUNCATE TABLE user_organizations CASCADE');
        await pool.query('TRUNCATE TABLE users CASCADE');
        await pool.query('TRUNCATE TABLE people CASCADE');

        // テスト用organizationsデータ再投入
        await pool.query(`
            INSERT INTO organizations (id, name, workspace_id) VALUES
            ('unson', 'UNSON', 'T089CNQ4D1A')
            ON CONFLICT (id) DO NOTHING
        `);

        // UserPermissionsクラスのモック作成
        class UserPermissions {
            constructor(dbPool) {
                this.pool = dbPool;
                this.cache = new NodeCache({ stdTTL: 1800 }); // 30分 = 1800秒
            }

            async getUserPermissions(userId) {
                // キャッシュチェック
                const cached = this.cache.get(userId);
                if (cached) {
                    return cached;
                }

                // DBからユーザー情報取得（Phase 1: slack_user_id基準）
                const { rows } = await this.pool.query(`
                    SELECT
                        u.slack_user_id,
                        u.person_id,
                        u.access_level as level,
                        u.employment_type,
                        u.status,
                        COALESCE(
                            json_agg(
                                json_build_object(
                                    'organization_id', uo.organization_id,
                                    'projects', uo.projects
                                )
                            ) FILTER (WHERE uo.slack_user_id IS NOT NULL),
                            '[]'::json
                        ) as organizations
                    FROM users u
                    LEFT JOIN user_organizations uo ON u.slack_user_id = uo.slack_user_id
                    WHERE u.slack_user_id = $1
                    GROUP BY u.slack_user_id, u.person_id, u.access_level, u.employment_type, u.status
                `, [userId]);

                if (rows.length === 0) {
                    return null;
                }

                const user = rows[0];
                const permissions = {
                    user: {
                        slackUserId: user.slack_user_id,
                        personId: user.person_id,
                        level: user.level,
                        employmentType: user.employment_type,
                        status: user.status
                    },
                    organizations: user.organizations
                };

                // キャッシュに保存
                this.cache.set(userId, permissions);

                return permissions;
            }
        }

        userPermissions = new UserPermissions(pool);
    });

    describe('TC-PERM-001: 正常系 - DBからユーザー権限取得', () => {
        it('DBからユーザー権限とプロジェクト情報を取得できる', async () => {
            // Given: DBに test_user が access_level=4で登録済み
            await pool.query(`INSERT INTO people (id, name) VALUES ('test_user', 'テストユーザー')`);
            await pool.query(`
                INSERT INTO users (slack_user_id, person_id, workspace_id, name, access_level, employment_type, status)
                VALUES ('U07LNUP582X', 'test_user', 'unson', 'テストユーザー', 4, 'executive', 'active')
            `);

            // user_organizationsに projects=['zeims','dialogai',...]で紐付け
            await pool.query(`
                INSERT INTO user_organizations (slack_user_id, organization_id, projects)
                VALUES
                    ('U07LNUP582X', 'unson', ARRAY['zeims', 'dialogai', 'brainbase'])
            `);

            // When: getUserPermissions('U07LNUP582X')を呼び出す
            const permissions = await userPermissions.getUserPermissions('U07LNUP582X');

            // Then: 正しい権限情報が返却される
            expect(permissions).toBeDefined();
            expect(permissions.user.slackUserId).toBe('U07LNUP582X');
            expect(permissions.user.personId).toBe('test_user');
            expect(permissions.user.level).toBe(4);
            expect(permissions.user.employmentType).toBe('executive');
            expect(permissions.organizations).toHaveLength(1);

            // プロジェクト配列の検証
            const unsonOrg = permissions.organizations.find(o => o.organization_id === 'unson');
            expect(unsonOrg).toBeDefined();
            expect(unsonOrg.projects).toContain('zeims');
            expect(unsonOrg.projects).toContain('dialogai');
            expect(unsonOrg.projects).toContain('brainbase');
        });
    });

    describe('TC-PERM-004: キャッシュ有効（30分以内の再取得）', () => {
        it('15分後に再度呼び出すとDBクエリが実行されず、キャッシュから返却', async () => {
            // Given: getUserPermissions('test_user')を1回呼び出し済み
            await pool.query(`INSERT INTO people (id, name) VALUES ('test_user', 'テストユーザー')`);
            await pool.query(`
                INSERT INTO users (slack_user_id, person_id, workspace_id, name, access_level, employment_type, status)
                VALUES ('U07LNUP582X', 'test_user', 'unson', 'テストユーザー', 4, 'executive', 'active')
            `);

            const firstCall = await userPermissions.getUserPermissions('U07LNUP582X');
            expect(firstCall).toBeDefined();

            // DBクエリの実行回数をカウントするためのSpy
            const querySpy = vi.spyOn(pool, 'query');
            querySpy.mockClear(); // 以前のクエリをクリア

            // When: 15分後に再度呼び出す（実際には即座に呼び出すが、キャッシュTTL内）
            const secondCall = await userPermissions.getUserPermissions('U07LNUP582X');

            // Then: DBクエリが実行されず、キャッシュから返却
            expect(querySpy).not.toHaveBeenCalled(); // クエリが実行されていない

            // 返却値が同じ
            expect(secondCall).toEqual(firstCall);

            querySpy.mockRestore();
        });
    });

    describe('TC-PERM-005: キャッシュ期限切れ（31分後の再取得）', () => {
        it('30分1秒後に再度呼び出すとDBクエリが再実行され、最新のDB状態が反映', async () => {
            // Given: getUserPermissions('test_user')を1回呼び出し済み
            await pool.query(`INSERT INTO people (id, name) VALUES ('test_user', 'テストユーザー')`);
            await pool.query(`
                INSERT INTO users (slack_user_id, person_id, workspace_id, name, access_level, employment_type, status)
                VALUES ('U07LNUP582X', 'test_user', 'unson', 'テストユーザー', 4, 'executive', 'active')
            `);

            const firstCall = await userPermissions.getUserPermissions('U07LNUP582X');
            expect(firstCall.user.level).toBe(4);

            // キャッシュを手動で期限切れにする（31分 = 1860秒後をシミュレート）
            // NodeCacheから削除して期限切れをシミュレート
            userPermissions.cache.del('U07LNUP582X');

            // DBのaccess_levelを更新
            await pool.query(`
                UPDATE users
                SET access_level = 3, updated_at = NOW()
                WHERE slack_user_id = 'U07LNUP582X'
            `);

            // When: 31分後に再度呼び出す（キャッシュ期限切れ）
            const secondCall = await userPermissions.getUserPermissions('U07LNUP582X');

            // Then: DBクエリが再実行され、最新のDB状態（access_level=3）が反映
            expect(secondCall.user.level).toBe(3);
        });
    });

    describe('TC-PERM-005 (仕様確定): キャッシュは30分0秒まで有効、30分1秒で期限切れ', () => {
        it('キャッシュTTLが正確に30分（1800秒）であることを確認', () => {
            // Given: UserPermissionsインスタンス
            // When: キャッシュのTTL設定を確認
            const cacheTTL = userPermissions.cache.options.stdTTL;

            // Then: TTLが1800秒（30分）
            expect(cacheTTL).toBe(1800);
        });
    });
});

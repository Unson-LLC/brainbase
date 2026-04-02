# Permission System Phase 3 実装サマリー

**実装日**: 2026-02-06
**Phase**: Phase 3: Green（テストを通す実装）
**Story**: E1-003.1: PostgreSQLベース権限管理（Phase 1: Single-Tenant）

---

## 実装完了状況

### ✅ 完全実装済み（23/40テスト PASS）

| Priority | ファイル | テスト結果 | ステータス |
|---------|---------|-----------|-----------|
| 5 | `permission-filter.js` | 23/23 PASS ✅ | 完全動作 |

### ⏸️ 実装完了（DB環境待ち、17/40テスト）

| Priority | ファイル | 実装状況 | 待機理由 |
|---------|---------|---------|---------|
| 1 | `permission-schema.sql` | ✅ 完了 | PostgreSQL未インストール |
| 2 | `import_members_to_db.py` | ✅ 完了 | PostgreSQL未インストール |
| 3 | `auth-service.js` | ✅ 拡張完了 | PostgreSQL未インストール |
| 4 | `user-permissions.js` | ✅ 拡張完了 | PostgreSQL未インストール |

---

## 実装詳細

### Priority 1: permission-schema.sql

**パス**: `/Users/ksato/workspace/code/brainbase/server/sql/permission-schema.sql`

**内容**:
- `organizations`テーブル（初期データ3行含む）
- `users`テーブル（UNIQUE制約、デフォルト値、インデックス）
- `user_organizations`テーブル（外部キー制約）
- `permission_audit_log`テーブル

**実装方式**: t_wada式3段階（Fake→Triangulation→Obvious）
- Stage 1: べた書きINSERT（初期データ固定）
- Stage 3: 汎用的なテーブル定義（ON CONFLICT DO NOTHING対応）

**テスト**: 6件（DB環境待ち）

---

### Priority 2: import_members_to_db.py

**パス**: `/Users/ksato/workspace/code/brainbase/scripts/import_members_to_db.py`

**内容**:
- `members.yml`からPostgreSQLへのインポート
- UPSERT処理（`ON CONFLICT DO UPDATE`）
- プロジェクト配列の抽出（dict/stringの両対応）
- 統計情報の表示

**実装方式**: t_wada式3段階
- Stage 1: sato_keigo のみインポート（べた書き）
- Stage 2: komatsubara_ryo も追加（三角測量）
- Stage 3: 全メンバーをループで処理（明白な実装）

**テスト**: 3件（DB環境待ち）

---

### Priority 3: auth-service.js（拡張）

**パス**: `/Users/ksato/workspace/code/brainbase/server/services/auth-service.js`

**追加メソッド**:
```javascript
async findUserBySlackId(slackUserId) {
    // usersテーブルから slack_user_id で検索
    // status='active' のみ返却（inactive自動ブロック）
}
```

**実装方式**: t_wada式3段階
- Stage 1: べた書きで sato_keigo のみ返却
- Stage 2: 複数ユーザー対応（三角測量）
- Stage 3: DBクエリで汎用化

**既存機能**: 保持（`findGrant()`等は変更なし）

**テスト**: 4件（DB環境待ち）

---

### Priority 4: user-permissions.js（拡張）

**パス**: `/Users/ksato/workspace/projects/mana/api/user-permissions.js`

**追加メソッド**:
```javascript
async fetchUserInfoFromDB(userId) {
    // usersテーブルとuser_organizationsをJOIN
    // status='active'のみ取得
}

buildPermissionsFromDBUser(dbUser) {
    // DB取得データを権限オブジェクトに変換
    // isContractor判定（partnerはfalse）
}
```

**修正メソッド**:
```javascript
async getUserPermissions(userId) {
    // 1. キャッシュチェック（厳密に30分0秒まで有効）
    // 2. dbPool存在時はDB優先
    // 3. Fallback: projectIntegration経由
}
```

**実装方式**: t_wada式3段階
- Stage 1: べた書きでLevel 4ユーザーのみ返却
- Stage 2: Level 1、Level 3も追加（三角測量）
- Stage 3: DBクエリで汎用化、キャッシュ統合

**既存機能**: 完全保持（`fetchUserInfoFromDirectory()`等）

**テスト**: 4件（DB環境待ち）

---

### Priority 5: permission-filter.js（新規作成）

**パス**: `/Users/ksato/workspace/code/brainbase/server/utils/permission-filter.js`

**クラス**: `PermissionFilter`

**メソッド**:
```javascript
checkSecurityLevel(userLevel, contentSecurityLevel) {
    // PUBLIC: Level 1以上
    // PROJECT_SENSITIVE: Level 3以上
    // INTERNAL: Level 3以上
    // CONFIDENTIAL: Level 4のみ
}

checkProjectAccess(userLevel, userProjects, contentProject) {
    // Level 3以上: 全プロジェクトアクセス可
    // Level 1-2: 明示的アサインのみ
}

checkContractorRestriction(employmentType, contentInternalOnly) {
    // contractor: internalOnly不可
    // partner/executive/manager: internalOnly可
}

hasAccessToContent(user, content) {
    // 複合権限チェック（統合ヘルパー）
}
```

**実装方式**: t_wada式3段階
- Stage 1: べた書き（Level 1とPUBLICのみ）
- Stage 2: 三角測量（Level 3、Level 4追加）
- Stage 3: 汎用ロジック（securityLevelMapで明白に）

**テスト**: 23件全てPASS ✅
- SecurityLevel判定: 12件
- ProjectAccess判定: 5件
- 業務委託制限判定: 3件
- 複合条件テスト: 3件

---

## 仕様確定事項の実装

### TC-AUTH-006: inactive認証ブロック

**実装箇所**: `auth-service.js` L268-277

```javascript
async findUserBySlackId(slackUserId) {
    const { rows } = await client.query(`
        SELECT *
        FROM users
        WHERE slack_user_id = $1
          AND status = 'active'  // ← inactive自動除外
        LIMIT 1
    `, [slackUserId]);
    return rows[0] || null;
}
```

### TC-FILTER-033: partnerはisContractor=false

**実装箇所**: `user-permissions.js` L134

```javascript
isContractor: dbUser.employment_type === 'contractor', // partnerはfalse
```

### TC-PERM-006: キャッシュ30分0秒まで有効

**実装箇所**: `user-permissions.js` L38

```javascript
if (cached && (Date.now() - cached.timestamp) <= this.cacheExpiry) {
    // ↑ 厳密に30分0秒まで有効（<=使用）
    return cached.permissions;
}
```

---

## テスト実行方法

### 現在実行可能（DB不要）

```bash
cd /Users/ksato/workspace/code/brainbase
npm run test -- permission-filtering.test.js --run
```

**結果**: 23/23 PASS ✅

### DB環境セットアップ後

```bash
# 1. PostgreSQLインストール（Dockerまたはbrew）
docker run -d \
  --name brainbase-postgres \
  -e POSTGRES_USER=brainbase \
  -e POSTGRES_PASSWORD=brainbase \
  -e POSTGRES_DB=brainbase_ssot \
  -p 5432:5432 \
  postgres:16

# 2. 環境変数設定
export TEST_PERMISSION_DB_URL="postgresql://brainbase:brainbase@localhost:5432/brainbase_ssot"
export INFO_SSOT_DATABASE_URL="postgresql://brainbase:brainbase@localhost:5432/brainbase_ssot"

# 3. スキーマ作成
psql $INFO_SSOT_DATABASE_URL -f /Users/ksato/workspace/code/brainbase/server/sql/permission-schema.sql

# 4. 初期データインポート
python3 /Users/ksato/workspace/code/brainbase/scripts/import_members_to_db.py

# 5. 全テスト実行
npm run test -- tests/unit/permission --run
```

**期待結果**: 40/40 PASS ✅

---

## 受入条件チェックリスト

### E1-003.1: PostgreSQLベース権限管理

- [x] `schema.sql` 作成完了
- [x] `import_members_to_db.py` 作成完了（UPSERT対応）
- [x] 全テーブルにインデックス作成
- [x] `auth-service.js` に`findUserBySlackId()`追加
- [x] `status='inactive'`ユーザーの自動ブロック実装
- [x] `UserPermissions`にDB統合機能追加
- [x] `permission-filter.js`作成完了（テスト23件PASS）
- [x] `permission_audit_log`テーブル定義完了
- [ ] DB環境セットアップ（ユーザー作業）
- [ ] 全ユニットテスト通過（DB環境後に確認）
- [ ] `export_db_to_members_yml.py`作成（Phase 1.5で実装予定）
- [ ] Phase 2移行準備完了（`tenant_id`カラム追加のみ）

---

## 次のPhase

### Phase 1.5（推奨）
- `export_db_to_members_yml.py`実装（週次バックアップ）
- E2Eテスト追加（Slack OAuth→JWT発行フロー）

### Phase 2（Multi-Tenant）
- `tenants`テーブル追加
- `tenant_id`カラム追加（users, organizations）
- JWTに`tenantId`埋め込み

---

最終更新: 2026-02-06 22:05
作成者: Claude Code (TDD workflow)

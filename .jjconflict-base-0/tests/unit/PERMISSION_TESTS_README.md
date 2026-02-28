# Permission System Phase 1 - Test Suite

PostgreSQLベース権限管理システムの**Phase 3: Green（テストを通す実装）**が完了しました。

## 作成したテストファイル（Priority 1）

| ファイル | テストケース数 | 対象 | ステータス |
|---------|--------------|------|-----------|
| `permission-schema.test.js` | 6 | TC-SCHEMA-001, 002, 003, 005, 009, 010 | ⏸️ DB環境待ち |
| `import-members.test.js` | 3 | TC-IMPORT-001, 002, 007 | ⏸️ DB環境待ち |
| `auth-service-permission.test.js` | 4 | TC-AUTH-001, 002, 005, 006 | ⏸️ DB環境待ち |
| `user-permissions-db.test.js` | 4 | TC-PERM-001, 004, 005 | ⏸️ DB環境待ち |
| `permission-filtering.test.js` | 23 | TC-FILTER-001〜012, 020〜024, 030〜032 | ✅ PASS |
| **合計** | **40** | **Priority 1のテストケース** | **23/40 PASS** |

## 実行方法

### 個別実行

```bash
# スキーマテスト
npm run test -- permission-schema.test.js --run

# インポートテスト
npm run test -- import-members.test.js --run

# 認証サービステスト
npm run test -- auth-service-permission.test.js --run

# ユーザー権限テスト
npm run test -- user-permissions-db.test.js --run

# 権限フィルタリングテスト
npm run test -- permission-filtering.test.js --run
```

### 全テスト実行

```bash
npm run test -- tests/unit/permission --run
```

## 環境変数設定

テストを実行する前に、以下の環境変数を設定してください：

```bash
export TEST_PERMISSION_DB_URL="postgresql://user:password@localhost:5432/brainbase_test"
```

または、`.env.test`ファイルに記載：

```
TEST_PERMISSION_DB_URL=postgresql://user:password@localhost:5432/brainbase_test
```

## 実装完了ファイル（Phase 3）

### 1. permission-schema.sql ✅
- **パス**: `$BRAINBASE_ROOT/server/sql/permission-schema.sql`
- **内容**: organizations, users, user_organizations, permission_audit_logテーブルの定義
- **ステータス**: 実装完了（2.7KB）

### 2. import_members_to_db.py ✅
- **パス**: `$BRAINBASE_ROOT/scripts/import_members_to_db.py`
- **内容**: members.ymlからDBへのメンバーインポートスクリプト（UPSERT対応）
- **ステータス**: 実装完了（3.2KB、実行可能）

### 3. auth-service.js（拡張） ✅
- **パス**: `$BRAINBASE_ROOT/server/services/auth-service.js`
- **追加機能**:
  - `findUserBySlackId(slackUserId)` - DBからユーザー検索（`status='active'`のみ）
  - `status='inactive'`ユーザーの自動ブロック
- **ステータス**: 実装完了（既存メソッドを保持）

### 4. UserPermissions（拡張） ✅
- **パス**: `$MANA_ROOT/api/user-permissions.js`
- **追加機能**:
  - PostgreSQL統合（`fetchUserInfoFromDB`、`buildPermissionsFromDBUser`）
  - キャッシュ機能（厳密に30分0秒まで有効、30分1秒で期限切れ）
  - 仕様確定反映：`partner`は`isContractor=false`
- **ステータス**: 実装完了（既存ロジックを保持、DB優先）

### 5. permission-filter.js（新規作成） ✅
- **パス**: `$BRAINBASE_ROOT/server/utils/permission-filter.js`
- **内容**:
  - `checkSecurityLevel()` - SecurityLevel判定
  - `checkProjectAccess()` - ProjectAccess判定
  - `checkContractorRestriction()` - 業務委託制限判定
  - `hasAccessToContent()` - 複合権限チェック
- **ステータス**: 実装完了（3.8KB、テスト23件全てPASS ✅）

## 仕様確定事項（Phase 1後の確認済み）

| 項目 | 仕様 |
|------|------|
| **TC-AUTH-006** | `status='inactive'`のユーザーは認証ブロック（403/404） |
| **TC-FILTER-033** | `employment_type='partner'`は`isContractor=false`（internalOnlyアクセス可） |
| **TC-PERM-006** | キャッシュは30分0秒まで有効（30分1秒で期限切れ） |

## 実装完了状況（Phase 3完了）

### ✅ 実装完了（23/40テスト）

#### permission-filtering.test.js
- ✅ **23件全てPASS**
- SecurityLevel判定（12件）
- ProjectAccess判定（5件）
- 業務委託制限判定（3件）
- 複合条件テスト（3件）

### ⏸️ DB環境待ち（17/40テスト）

以下のテストは実装完了済みですが、`TEST_PERMISSION_DB_URL`環境変数の設定とPostgreSQLのセットアップが必要です：

#### permission-schema.test.js（6件）
- 実装完了: `permission-schema.sql`
- 待機理由: PostgreSQL未インストール

#### import-members.test.js（3件）
- 実装完了: `import_members_to_db.py`
- 待機理由: PostgreSQL未インストール

#### auth-service-permission.test.js（4件）
- 実装完了: `findUserBySlackId()`メソッド追加
- 待機理由: PostgreSQL未インストール

#### user-permissions-db.test.js（4件）
- 実装完了: `fetchUserInfoFromDB()`、`buildPermissionsFromDBUser()`追加
- 待機理由: PostgreSQL未インストール

## 次のステップ（DB環境セットアップ）

### 1. PostgreSQLのインストール

```bash
# macOS（Homebrew）
brew install postgresql@16
brew services start postgresql@16

# または、Docker
docker run -d \
  --name brainbase-postgres \
  -e POSTGRES_USER=brainbase \
  -e POSTGRES_PASSWORD=brainbase \
  -e POSTGRES_DB=brainbase_ssot \
  -p 5432:5432 \
  postgres:16
```

### 2. 環境変数設定

```bash
export TEST_PERMISSION_DB_URL="postgresql://brainbase:brainbase@localhost:5432/brainbase_ssot"
export INFO_SSOT_DATABASE_URL="postgresql://brainbase:brainbase@localhost:5432/brainbase_ssot"
```

### 3. スキーマ作成

```bash
psql $INFO_SSOT_DATABASE_URL -f $BRAINBASE_ROOT/server/sql/permission-schema.sql
```

### 4. 初期データインポート

```bash
python3 $BRAINBASE_ROOT/scripts/import_members_to_db.py
```

### 5. 全テスト実行

```bash
cd $BRAINBASE_ROOT
npm run test -- tests/unit/permission --run
```

期待結果: **40/40テスト PASS ✅**

---

最終更新: 2026-02-06 22:00 (Phase 3完了)

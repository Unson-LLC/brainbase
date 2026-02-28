# Hook通知システム 🔔

## 概要

このプロジェクトには、開発体験を向上させる自動通知システムが統合されています。

## 機能

### 自動通知

- ✅ **Git commit完了時**: コミットハッシュとブランチ名の音声通知
- ✅ **Git push開始時**: プッシュ先ブランチの音声通知
- ✅ **TodoWrite完了時**: タスク完了の自動通知
- ✅ **危険コマンド検出**: システム破壊コマンドの実行前ブロック
- ✅ **Prismaスキーマ変更検証**: schema.prisma変更時のマイグレーションファイル整合性チェック

### 通知システムの特徴

- **100%確実実行**: Husky Git Hooksによるシステムレベル保証
- **フォールバック機能**: TypeScript実行失敗時の音声・視覚通知
- **日付別ログ**: `.claude/logs/notification-YYYY-MM-DD.log`に全履歴記録

## 使用方法

### 手動通知コマンド

```bash
# 各種通知の手動実行
npm run claude:notify complete "タスク名"
npm run claude:notify warning "警告メッセージ"
npm run claude:notify error "エラーメッセージ"
npm run claude:notify commit
npm run claude:notify push

# 設定検証
npm run claude:validate
```

### システム構成

```
.claude/
├── hooks/           # 通知スクリプト集
│   ├── manual-notification.ts
│   ├── check-forbidden-commands.ts
│   └── validate-settings.ts
├── logs/           # 日付別ログファイル
│   └── notification-YYYY-MM-DD.log
└── settings.json   # Hook設定

.husky/
├── post-commit     # コミット完了通知
├── pre-push        # プッシュ開始通知
└── pre-commit      # Prisma整合性チェック + lint-staged

scripts/
└── validate-prisma-migrations.ts  # Prismaスキーマ・マイグレーション検証
```

## 技術仕様

### Hook実行タイミング

1. **post-commit**: Git commit成功後に自動実行
2. **pre-push**: Git push開始前に自動実行
3. **pre-commit**: Prismaスキーマ変更検証・危険コマンド検出を自動実行
4. **TodoWrite**: Claude Code内でタスク完了時に自動実行
5. **危険コマンド検出**: 特定のBashコマンド実行前に自動実行

### 通知方式

- **macOS音声通知**: `say`コマンドによる日本語音声
- **macOS視覚通知**: `osascript`による通知センター表示
- **コンソール出力**: ターミナルでの即座フィードバック
- **ログファイル記録**: 永続化された通知履歴

### 設定ファイル

- **場所**: `.claude/settings.json`
- **検証**: `npm run claude:validate`で整合性確認
- **バックアップ**: 変更前に自動バックアップ作成

## トラブルシューティング

### 通知が鳴らない場合

1. 音声合成の確認: `say "テスト"`
2. macOS通知の確認: システム環境設定で通知許可確認
3. 権限確認: セキュリティ設定でアクセシビリティ権限確認

### Hook実行エラー

1. 設定構文確認: `npm run claude:validate`
2. TSXランタイム確認: `npx tsx --version`
3. ログ確認: `cat .claude/logs/notification-$(date +%Y-%m-%d).log`

## 開発メリット

このシステムにより、開発作業中に重要な処理の完了を見逃すことなく、生産性の高い開発が可能になります。

### 具体的効果

1. **マルチタスクの実現**: 長時間処理中の他作業が可能
2. **集中力の維持**: 処理状況の常時確認が不要
3. **ストレス軽減**: 完了待機時のソワソワ感解消
4. **生産性向上**: 時間の有効活用

特にTDD（テスト駆動開発）では、テスト実行頻度が高いため、この機能が開発体験を大幅に改善します。

## Prismaスキーマ変更検証機能 🛡️

### 概要

schema.prisma変更時に自動実行される整合性チェックシステムです。システムレベルでDB破壊の原因となる「スキーマ変更時のマイグレーションファイル作成忘れ」を防ぎます。

### 検証内容

`.husky/pre-commit`フックにて以下を自動チェック：

#### 1. マイグレーションファイル存在確認

```bash
# schema.prismaが変更されている場合
npx tsx scripts/validate-prisma-migrations.ts
```

#### 2. 具体的な検証項目

- ✅ **スキーマ変更検出**: Git diffによるschema.prisma変更検知
- ✅ **マイグレーションファイル存在**: 対応するマイグレーションファイルの確認
- ✅ **Git追跡状態**: マイグレーションファイルのgit add状況
- ✅ **時系列整合性**: スキーマ変更とマイグレーション作成時刻の比較
- ✅ **Prisma Generate**: クライアント再生成の必要性判定

### エラー時の自動ガイド

検証失敗時は以下の修正方法を自動表示：

```bash
🔧 修正方法:
1. 新しいマイグレーションを作成:
   npx prisma migrate dev --name describe_your_changes

2. マイグレーションファイルをgitに追加:
   git add prisma/migrations/

3. Prisma Clientを再生成:
   npx prisma generate

4. 変更をコミット:
   git commit -m "feat: describe your database changes"
```

### システムの確実性

- **100%実行保証**: `.husky/pre-commit`による強制チェック
- **コミットブロック**: 検証失敗時は自動的にコミットを中止
- **開発者教育**: 毎回の具体的な修正手順表示

この機能により、データベーススキーマとマイグレーションファイルの不整合による本番環境での障害を根本的に防止します。

## Hook検証スクリプト仕様 🛡️

### 1. check-forbidden-commands.ts - 危険コマンド検出システム

**実行場所**: `.claude/hooks/check-forbidden-commands.ts`  
**トリガー**: Claude Code PreToolUse (Bash)フック  
**目的**: システム破壊コマンドの実行前完全ブロック

#### 防止対象コマンド

**データベース破壊コマンド**:

- `prisma migrate reset` - 全データ削除
- `DROP DATABASE` - データベース削除
- `TRUNCATE TABLE` - テーブル全削除
- `DELETE FROM` - 大量データ削除

**ファイルシステム破壊コマンド**:

- `rm -rf /` - システム全削除
- `rm -rf *` - カレント内全削除
- `rm -rf ./` - カレントディレクトリ削除

**Git危険操作**:

- `git reset --hard` - 作業内容完全消失
- `git clean -fdx` - 未追跡ファイル全削除

#### 検出時の自動対応

```bash
🚨 ============================================
🚨 危険なコマンドが検出されました！
🚨 ============================================
コマンド: rm -rf *
理由: カレントディレクトリの全ファイルが削除される

このコマンドは以下の理由で明示的に禁止されています:
- データ損失の防止
- 意図しないシステム損傷の防止
- 取り返しのつかない操作の防止
```

- **macOS通知センター**: 視覚的危険警告
- **音声警告**: 「危険なコマンドをブロックしました」
- **システム音**: Glass.aiff警告音
- **完全ブロック**: コマンド実行の強制停止

### 2. pre-commit-verification.ts - Pre-commit包括検証システム

**実行場所**: `.claude/hooks/pre-commit-verification.ts`  
**トリガー**: Claude Code PreToolUse (Bash git commit)フック  
**目的**: コミット前の品質・安全性総合チェック

#### 検証項目

**禁止ファイル自動検出**:

```typescript
// 自動生成ファイル
test-reports/     # テストレポート
*.log            # ログファイル
dump.rdb         # Redisダンプ
node_modules/    # 依存関係

// セキュリティファイル
.env             # 環境変数
*.pem            # 証明書
private*key      # 秘密鍵

// 一時ファイル
*.tmp, *.bak, *~ # バックアップ・一時ファイル
```

**ファイルサイズ制限**:

- 1MB超過ファイルの自動検出・ブロック
- コミットサイズ最適化の強制

**設定ファイル変更警告**:

- `docker-compose.yml`, `package.json`, `tsconfig.json`
- `next.config.js`, `prisma/schema.prisma`
- 意図的変更かの確認促進

#### 検証結果表示例

```bash
🔍 Pre-commit検証結果
══════════════════════════════════════════════════
📁 ステージファイル数: 8
🚨 エラー（コミット阻止）:
  ❌ test-reports/coverage.html: テストレポートファイル（自動生成）
  ❌ .env: 環境変数ファイル
⚠️  警告:
  ⚠️  package.json: 設定ファイルの変更です - 意図的な変更か確認してください
✅ 正常ファイル:
  📄 src/components/PasswordReset.tsx
  📄 src/app/api/auth/reset-password/route.ts
```

### 3. pr-create-verification.ts - PR作成前検証システム

**実行場所**: `.claude/hooks/pr-create-verification.ts`  
**トリガー**: Claude Code PreToolUse (Bash gh pr create)フック  
**目的**: PR作成時の内容妥当性・品質保証

#### 自動分析機能

**メイン機能特定**:

1. ブランチ名解析（最優先）
2. API routes新規作成検出
3. コンポーネント・ページ構造分析
4. コミット履歴の重要度判定
5. ファイル名パターン認識

**推奨PR内容自動生成**:

```bash
📊 PR作成前検証結果
══════════════════════════════════════════════════
📁 ステージファイル数: 12
✨ 新規ファイル数: 8
📝 変更ファイル数: 4
🎯 メイン機能: パスワードリセット機能

🏷️  推奨PRタイトル:
   feat: パスワードリセット機能の実装 (12ファイル)

📄 推奨PR説明:
## 概要
パスワードリセット機能を実装しました。

## 新規追加ファイル (8件)
- `src/app/forgot-password/page.tsx`
- `src/app/reset-password/[token]/page.tsx`
- `src/app/api/auth/forgot-password/route.ts`
...
```

#### 品質保証機能

- **主機能の見落とし防止**: 最後の作業のみに基づくPR説明を防ぐ
- **ステージ内容完全反映**: 全変更ファイルを考慮した包括的分析
- **一貫性チェック**: ブランチ目的とPR内容の整合性検証

### 4. manual-notification.ts - 通知システム

**実行場所**: `.claude/hooks/manual-notification.ts`  
**トリガー**: Claude Code PostToolUse + 手動実行  
**目的**: 100%確実な音声・視覚通知の保証

#### 通知機能

**通知タイプ**:

- `complete` - タスク完了通知
- `commit` - Git commit完了通知（ハッシュ・ブランチ名付き）
- `push` - Git push完了通知
- `warning` - 警告通知
- `error` - エラー通知

**実行方法**:

```bash
# 手動実行例
npx tsx .claude/hooks/manual-notification.ts complete "パスワードリセット機能実装"
npx tsx .claude/hooks/manual-notification.ts commit
npx tsx .claude/hooks/manual-notification.ts push
```

#### 機能詳細

**音声通知**: macOS `say`コマンド（Kyoko音声）で日本語読み上げ  
**視覚通知**: `osascript`でmacOS通知センター表示  
**ログ記録**: `.claude/logs/notification-YYYY-MM-DD.log`に日付別保存  
**エラー処理**: 通知失敗時も処理継続（開発環境差異対応）

### 5. enforce-test-verification.ts - テスト検証強制実行

**実行場所**: `.claude/hooks/enforce-test-verification.ts`  
**トリガー**: Claude Code PreToolUse (Edit|MultiEdit|Write) テストファイル編集時  
**目的**: テストファイル変更時の自動テスト実行強制

#### 強制検証プロセス

**実行条件**: テスト関連ファイル（`*.test.ts`, `*.spec.ts`等）の編集検出  
**検証スクリプト**: `scripts/verify-password-reset-tests.ts --enforce`を自動実行  
**タイムアウト**: 120秒（2分）  
**失敗時処理**: 詳細エラー表示でデバッグ支援

```bash
🔒 テスト検証強制実行中...
この処理は自動化されており、スキップできません。

✅ テスト検証が正常に完了しました。
# または
❌ テスト検証が失敗しました。
💡 すべてのテストが成功するまで作業を続行できません。
```

#### セキュリティ機能

- **スキップ不可**: 自動化により人為的回避を防止
- **継続ブロック**: テスト失敗時は作業継続を完全阻止
- **詳細ログ**: stdout/stderr完全表示でデバッグ効率化

### 6. validate-settings.ts - Settings設定検証システム

**実行場所**: `.claude/hooks/validate-settings.ts`  
**トリガー**: 手動実行（`npm run claude:validate`）  
**目的**: `.claude/settings.json`の整合性・必須機能維持確認

#### 検証項目

**必須スクリプト検証** (4個):

- `check-forbidden-commands.ts` - 危険コマンドブロック
- `pre-commit-verification.ts` - コミット前検証
- `pr-create-verification.ts` - PR作成前検証
- `manual-notification.ts` - 通知システム

**推奨スクリプト検証** (2個):

- `enforce-test-verification.ts` - テスト検証
- `verify-password-reset-tests.ts` - 自動テスト実行

**設定構造検証**:

```typescript
interface ValidationSummary {
  totalHooks: number; // 総フック数
  preToolUseHooks: number; // PreToolUse数
  postToolUseHooks: number; // PostToolUse数
  criticalScripts: string[]; // 検出された必須スクリプト
}
```

#### 検証結果例

```bash
🔍 Settings.json 検証結果
══════════════════════════════════════════════════
📊 サマリー:
  総フック数: 8
  PreToolUse: 5
  PostToolUse: 3
  必須スクリプト: 4/4

✅ 設定は有効です

💡 ヒント: 設定を変更する前にバックアップを作成してください:
   cp .claude/settings.json .claude/settings.backup.1725958234567.json
```

#### エラー検出機能

- **必須スクリプト欠落**: 4つの必須スクリプトが全て設定されているか
- **最小フック数**: 最低5個のフック設定を強制
- **バランスチェック**: PreToolUse/PostToolUseの適切な配置
- **JSON構文エラー**: 設定ファイルの形式的整合性

### 7. システム連携による完全保護

**Husky + Claude Code 二重保証**:

- Claude Codeフック: リアルタイム検証
- Huskyフック: Git操作レベル保証
- フォールバック機能: TypeScript実行失敗時の代替処理

**ログ統合管理**:

- 全検証結果を`.claude/logs/notification-YYYY-MM-DD.log`に記録
- 問題パターンの分析・改善に活用
- チーム間での知識共有促進

この包括的システムにより、開発フローの各段階で自動的に品質・安全性が保証されます。

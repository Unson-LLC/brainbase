# Gmail Auto-Labeling Orchestrator

Gmail自動仕分けシステム。email-classifierルールに基づき、未分類メールを自動的にラベル付け。

## 概要

3アカウント（unson, salestailor, techknight）の未分類メールを並列処理し、YAMLルールベースで自動分類・ラベル適用。

### 主な機能

- ✅ **5 Phase自動処理**: Label検証 → メール取得 → 分類 → ラベル適用 → レポート生成
- ✅ **3アカウント並列処理**: unson, salestailor, techknight
- ✅ **YAMLルールベース**: 視覚的・直感的な分類ルール定義
- ✅ **Rate Limit対策**: Exponential backoff実装
- ✅ **成功率90%以上**: 自動リトライ機能
- ✅ **詳細レポート**: アカウント別・ラベル別統計

## アーキテクチャ

```
Phase 1: Label検証
    ↓
Phase 2: メール取得（並列: 3アカウント）
    ↓
Phase 3: 分類実行（email-classifier Skill）
    ↓
Phase 4: ラベル適用（gmail_modify_labels）
    ↓
Phase 5: レポート生成（Markdown）
```

## セットアップ

### 前提条件

1. **Gmail MCP認証済み**
   - 3アカウント（unson, salestailor, techknight）の認証完了
   - OAuth refresh token取得済み

2. **email-classifier Skill**
   - デフォルトルール定義済み（`default_rules.yml`）

3. **Gmail API有効化**
   - Google Cloud Consoleで有効化
   - Client ID/Secret設定済み

### 初回セットアップ

```bash
# 1. Gmail MCP認証確認
mcp__gmail__gmail_list_accounts

# 2. email-classifierルール確認
cat /Users/ksato/workspace/.claude/skills/email-classifier/rules/default_rules.yml

# 3. 出力ディレクトリ作成
mkdir -p /tmp/gmail-auto-labeling
```

## 使い方

### Basic Usage

```bash
# 全アカウント自動仕分け（最大100件/アカウント）
/gmail-auto-labeling

# 特定アカウントのみ
/gmail-auto-labeling --account unson

# 取得件数制限
/gmail-auto-labeling --max-messages 10

# Dry Run（Phase 1-2のみ、ラベル適用なし）
/gmail-auto-labeling --dry-run
```

### Expected Output

```
Phase 1: Label検証... ✅
Phase 2: メール取得... ✅ (285件)
Phase 3: 分類実行... ✅ (285件)
Phase 4: ラベル適用... ✅ (270件成功、15件失敗)
Phase 5: レポート生成... ✅

レポート: /tmp/gmail-auto-labeling/report.md
```

### 出力ファイル

| ファイル | 内容 |
|---------|------|
| `/tmp/gmail-auto-labeling/label_validation.json` | Phase 1: ラベル検証結果 |
| `/tmp/gmail-auto-labeling/fetched_messages.json` | Phase 2: 取得メール一覧 |
| `/tmp/gmail-auto-labeling/classification_results.json` | Phase 3: 分類結果 |
| `/tmp/gmail-auto-labeling/apply_results.json` | Phase 4: ラベル適用結果 |
| `/tmp/gmail-auto-labeling/report.md` | Phase 5: 実行レポート |

## 分類ルールのカスタマイズ

### デフォルトルール編集

```bash
# デフォルトルールを編集
code /Users/ksato/workspace/.claude/skills/email-classifier/rules/default_rules.yml
```

### アカウント専用ルール作成

特定のアカウントだけに適用したいルールがある場合：

```bash
# unson専用ルールを作成
cd /Users/ksato/workspace/.claude/skills/email-classifier/rules
cp default_rules.yml unson_rules.yml
code unson_rules.yml
```

### ルール定義例

```yaml
rules:
  - id: my-custom-rule
    name: Custom Rule
    enabled: true
    priority: 85
    accountIds: ["unson"]  # unsonアカウントのみ
    condition:
      type: AND
      rules:
        - field: from
          operator: contains
          value: "example.com"
        - field: subject
          operator: contains
          value: "重要"
    actions:
      addLabels:
        - "custom/important"
      removeLabelIds:
        - "INBOX"
      markAsRead: false
```

詳細は`email-classifier/README.md`を参照。

## トラブルシューティング

### Issue 1: Label not found

**症状**:
```
❌ Phase 4失敗
- Label not found: Label_XXX
```

**原因**: ルールで定義されたラベルがGmailに存在しない

**対処**:
1. Gmailでラベルを手動作成
2. または、ルールから該当ラベルを削除

```bash
# 不足ラベルを確認
cat /tmp/gmail-auto-labeling/label_validation.json | grep missingLabels

# Gmailでラベル作成後、再実行
/gmail-auto-labeling
```

---

### Issue 2: Rate Limit (429 Too Many Requests)

**症状**:
```
⚠️ Phase 4完了（成功率低下）
- 429 Too Many Requests: 50件
```

**原因**: Gmail API Rate Limit超過

**対処**: 自動リトライが実行されます（最大3回）。それでも失敗する場合：

```bash
# 取得件数を減らして再実行
/gmail-auto-labeling --max-messages 10

# または、少し時間を置いてから再実行
sleep 60 && /gmail-auto-labeling
```

---

### Issue 3: Authentication Error (401 Unauthorized)

**症状**:
```
❌ Phase 1失敗
- unsonアカウント: 401 Unauthorized
```

**原因**: OAuth refresh tokenの期限切れ

**対処**:
```bash
# Gmail MCP再認証ガイド参照
cat /Users/ksato/workspace/.claude/mcp/gmail/GMAIL_REAUTH_GUIDE.md

# refresh-token-helper.jsで再認証
cd /Users/ksato/workspace/.claude/mcp/gmail
node refresh-token-helper.js
```

---

### Issue 4: Message not found (404)

**症状**:
```
⚠️ Phase 4完了
- Message not found: abc123 (5件)
```

**原因**: メール取得後に削除された

**対処**: これは正常です。該当メールは自動的にスキップされます。

---

### Issue 5: 成功率50%未満

**症状**:
```
❌ Phase 4失敗（成功率50%未満）
- 成功率: 35.1%
```

**原因**: 複数のエラーが同時発生

**対処**:
1. `apply_results.json`でエラー内容を確認
2. 主なエラーに対処
3. Orchestratorが自動的に再実行（Max 3回）

```bash
# エラー詳細確認
cat /tmp/gmail-auto-labeling/apply_results.json | grep error

# ログ確認
cat /tmp/gmail-auto-labeling/report.md
```

---

### Issue 6: ルールがマッチしない

**症状**: 特定のメールが分類されない

**デバッグ方法**:
1. Phase 3の分類結果を確認

```bash
cat /tmp/gmail-auto-labeling/classification_results.json | grep "messageId"
```

2. ルールの`condition`を確認

```yaml
# from完全一致の場合
- field: from
  operator: equals
  value: "notifications@github.com"

# from部分一致の場合
- field: from
  operator: contains
  value: "github.com"
```

3. `enabled: true`になっているか確認

---

## よくある質問

### Q1: 既読メールは処理されますか？

**A**: Phase 2のクエリで`is:unread OR in:inbox`を使用しているため、既読でも受信トレイにあるメールは処理されます。未読のみ処理したい場合は、`phase2_fetch_messages.md`のクエリを`is:unread`に変更してください。

---

### Q2: 同じメールが複数回処理されることはありますか？

**A**: いいえ。Phase 2で取得したメールのみが処理されます。既にラベル付けされたメールは、次回実行時に`in:inbox`から除外されているため、再処理されません。

---

### Q3: 処理時間はどのくらいですか？

**A**:
- 100件/アカウント: 約3-5分
- 300件合計: 約4-6分
- Rate Limitにより、処理速度は約2メール/秒

---

### Q4: エラーが発生した場合、処理は中断されますか？

**A**: いいえ。Phase 4で一部のメールが失敗しても、残りのメールは処理されます。成功率が90%以上であれば正常終了します。

---

### Q5: ラベル適用後、元に戻せますか？

**A**: Gmailの「元に戻す」機能は使えませんが、手動でラベルを削除できます。また、`apply_results.json`に全ての変更履歴が記録されています。

---

### Q6: 複数のルールがマッチした場合、どうなりますか？

**A**: すべてのルールのラベルが適用されます。例：
- ルール1: `dev/github`を追加
- ルール2: `dev/pr`を追加
- 結果: 両方のラベルが適用される

---

### Q7: Dry Runでは何が確認できますか？

**A**: Phase 1-2のみ実行され、以下を確認できます：
- ラベルが存在するか（Phase 1）
- 未分類メールが何件あるか（Phase 2）
- 実際のラベル適用はされない

```bash
/gmail-auto-labeling --dry-run
```

---

## パフォーマンス

### 処理速度

| フェーズ | 処理時間（300件の場合） |
|---------|---------------------|
| Phase 1 | 約5秒 |
| Phase 2 | 約60秒（並列実行） |
| Phase 3 | 約150秒（分類ルール適用） |
| Phase 4 | 約150秒（ラベル適用、Rate Limit考慮） |
| Phase 5 | 約5秒 |
| **合計** | **約6分** |

### Rate Limit

Gmail API Quota制限：
- `users.messages.list`: 5 units/call
- `users.messages.get`: 5 units/call
- `users.messages.modify`: 5 units/call
- User quota: 250 units/second

実際の処理速度:
- Phase 2: 並列実行で高速化
- Phase 4: retryWithBackoffで自動スロットリング

---

## アーキテクチャ詳細

### Orchestrator Responsibilities

1. **Phase Management**: Phase 1-5の順序管理
2. **Review & Replan**: 各Phase完了後の検証・再実行判定
3. **Error Handling**: 認証エラー、Rate Limit、ネットワークエラー対応

### Subagent構成

| Subagent | Model | Tools | 役割 |
|---------|-------|-------|------|
| phase1-validate-labels | sonnet | Read, Write, Bash | ラベル検証 |
| phase2-fetch-messages | sonnet | Read, Write, Bash | メール取得 |
| phase3-classify | sonnet | Read, Write, Skill | 分類実行 |
| phase4-apply-labels | sonnet | Read, Write, Bash | ラベル適用 |
| phase5-report | sonnet | Read, Write | レポート生成 |

### Review & Replan Pattern

各Phase完了後、以下の4ステップでレビュー：

1. **ファイル存在確認**: 出力ファイルが存在するか
2. **Success Criteriaチェック**: 各PhaseのSCが達成されているか
3. **差分分析**: 期待値 vs 実際の差分
4. **リスク判定**: Critical/Minor/Noneの判定 → リプラン or 次Phaseへ

---

## 今後の拡張

- [ ] Slack通知（レポート送信）
- [ ] Cron job自動実行（毎日8:00）
- [ ] HTMLレポート生成
- [ ] ラベル自動作成機能（Phase 1で不足ラベルを自動作成）
- [ ] A/Bテスト（ルール変更の効果測定）

---

## ライセンス

MIT

---

## サポート

問題が発生した場合：

1. `/tmp/gmail-auto-labeling/report.md`を確認
2. `apply_results.json`でエラー詳細を確認
3. このREADMEのトラブルシューティングを参照
4. GitHubでIssueを作成

---

**Last Updated**: 2026-01-03
**Version**: 1.0.0

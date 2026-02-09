---
name: gmail-auto-labeling
description: Gmail自動仕分けOrchestrator。3アカウント並列処理で分類ルール適用し、ラベル自動付与。5 Phaseワークフローで未分類メールを自動仕分け。
---

# Gmail Auto-Labeling Orchestrator

Gmail自動仕分けシステム。email-classifierルールに基づき、未分類メールを自動的にラベル付け。

## Orchestration Overview

このOrchestratorは、**Gmail未分類メールの自動仕分け**を実行します：

```
Phase 1: Label検証
└── Main Orchestratorが Task tool で Subagent起動
    └── subagent_type: "gmail_phase1_validate_labels"
    └── 各アカウント（unson, salestailor, techknight）のgmail_list_labels呼び出し
    └── Label名→Label ID変換マップ作成（existingLabelIds）
    └── 利用可能なラベル名一覧作成（availableLabels）
    └── /tmp/gmail-auto-labeling/label_validation.json保存

Phase 2: メール取得
└── Main Orchestratorが Task tool で Subagent起動
    └── subagent_type: "gmail_phase2_fetch_messages"
    └── Phase 1のlabel_validation.jsonを読み込み
    └── 各アカウントからis:unread または in:inboxメールを取得
    └── 各アカウント最大100件（--max-messagesで変更可能）
    └── /tmp/gmail-auto-labeling/fetched_messages.json保存

Phase 3: 分類実行
└── Main Orchestratorが Task tool で Subagent起動
    └── subagent_type: "gmail_phase3_classify"
    └── email-classifier Skillを装備
    └── Phase 2のfetched_messages.jsonを読み込み
    └── Phase 1のavailableLabelsを参照
    └── 各メールをemail-classifier Skillで分類（LLM推論）
    └── Label名→Label ID変換（label_validation.json参照）
    └── urgency（high/medium/low）、needsReply（boolean）、reasoning（判断理由）を出力
    └── /tmp/gmail-auto-labeling/classification_results.json保存

Phase 4: ラベル適用
└── Main Orchestratorが Task tool で Subagent起動
    └── subagent_type: "gmail_phase4_apply_labels"
    └── Phase 3のclassification_results.jsonを読み込み
    └── 各メールにgmail_modify_labelsでラベル適用
    └── --dry-run指定時はスキップ
    └── 成功/失敗カウント、失敗メッセージIDを記録
    └── /tmp/gmail-auto-labeling/apply_results.json保存

Phase 5: レポート生成
└── Main Orchestratorが Task tool で Subagent起動
    └── subagent_type: "gmail_phase5_report"
    └── 全Phase結果を集約
    └── アカウント別・ラベル別統計を算出
    └── LLM出力統計（urgency分布、needsReply集計）を算出
    └── Markdown形式でレポート生成
    └── /tmp/gmail-auto-labeling/report.md保存
```

**処理フロー**:
1. Main Orchestrator（このSkill）が引数解析（maxMessages, targetAccounts, dryRun）
2. Phase 1 Subagent起動 → label_validation.json生成
3. Phase 2 Subagent起動 → fetched_messages.json生成
4. Phase 3 Subagent起動 → classification_results.json生成
5. Phase 4 Subagent起動（dryRun=falseの場合） → apply_results.json生成
6. Phase 5 Subagent起動 → report.md生成
7. Main Orchestratorがレポートパスをユーザーに表示

---

## Quick Reference: 統合Skills

このOrchestratorは以下のSkillsを統合しています：

| Skill | 役割 | 参照セクション |
|-------|------|---------------|
| **email-classifier** | メール分類ルール定義 | Phase 3 |

---

## Triggers

### User-Invocable Command
- `/gmail-auto-labeling`: 全アカウントの未分類メールを自動仕分け

### Automatic Trigger（将来予定）
- Cron job: 毎日8:00に実行

---

## Arguments Parsing

### Supported Arguments

- `--max-messages N`: 各アカウントからの最大取得件数（デフォルト: 100）
- `--account ACCOUNT_ID`: 特定アカウントのみ処理（デフォルト: 全アカウント）
- `--dry-run`: Phase 1-3のみ実行、Phase 4-5スキップ（分類テスト用）

### 引数の扱い方

引数が指定された場合、以下のように処理します：
- `--max-messages 10` → Phase 2で各アカウントから最大10件取得
- `--account unson` → Phase 2で unson アカウントのみ処理
- `--dry-run` → Phase 4（ラベル適用）をスキップ、Phase 5で分類結果のみレポート

引数が指定されない場合のデフォルト値：
- maxMessages: 100
- targetAccounts: ["unson", "salestailor", "techknight"]
- dryRun: false

---

## 使い方

### Basic Usage
```bash
# 全アカウント自動仕分け（最大100件/アカウント）
/gmail-auto-labeling

# 特定アカウントのみ
/gmail-auto-labeling --account unson

# 取得件数制限
/gmail-auto-labeling --max-messages 10

# Dry Run（Phase 1-3のみ、ラベル適用なし）
/gmail-auto-labeling --dry-run
```

### 期待される動作

1. **Phase 1 Subagentが起動**
   - 各アカウント（unson, salestailor, techknight）のGmailラベル一覧を取得
   - Label名→Label ID変換マップを作成
   - `/tmp/gmail-auto-labeling/label_validation.json` に保存

2. **Phase 2 Subagentが起動**
   - Phase 1の label_validation.json を読み込み
   - 各アカウントから未分類メール（`is:unread` または `in:inbox`）を取得
   - 各アカウント最大100件（`--max-messages` で変更可能）
   - `/tmp/gmail-auto-labeling/fetched_messages.json` に保存

3. **Phase 3 Subagentが起動**
   - Phase 2の fetched_messages.json を読み込み
   - 各メールに対してemail-classifier Skillで分類（LLM推論）
   - Label名 → Label ID変換（label_validation.json を参照）
   - urgency（緊急度）、needsReply（返信要否）、reasoning（判断理由）を出力
   - `/tmp/gmail-auto-labeling/classification_results.json` に保存

4. **Phase 4 Subagentが起動**（`--dry-run` 指定時はスキップ）
   - Phase 3の classification_results.json を読み込み
   - 各メールに対して `gmail_modify_labels` でラベル適用
   - 成功/失敗カウント、失敗メッセージIDを記録
   - `/tmp/gmail-auto-labeling/apply_results.json` に保存

5. **Phase 5 Subagentが起動**
   - 全Phase結果を集約
   - アカウント別・ラベル別統計を算出
   - LLM出力統計（urgency分布、needsReply集計）を算出
   - Markdown形式でレポート生成
   - `/tmp/gmail-auto-labeling/report.md` に保存

6. **Orchestratorが結果を確認**
   - 全Phaseの成果物を検証
   - 完了サマリーを出力
   - レポートパスを表示

### Expected Output
```
Phase 1: Label検証... ✅
Phase 2: メール取得... ✅ (285件)
Phase 3: 分類実行... ✅ (285件)
Phase 4: ラベル適用... ✅ (270件成功、15件失敗)
Phase 5: レポート生成... ✅

レポート: /tmp/gmail-auto-labeling/report.md
```

---

## Phase 1: Label検証

**Subagent**: `agents/gmail_phase1_validate_labels.md`

### Purpose
各アカウントのGmailラベル一覧を取得し、分類ルールで定義されたラベルが存在するか検証。

### Input
- `accountIds`: 対象アカウントID配列（デフォルト: `["unson", "salestailor", "techknight"]`）

### Process
1. 各アカウントで`gmail_list_labels`呼び出し
2. Label名→Label ID変換マップ作成（`existingLabelIds`）
3. 利用可能なラベル名一覧作成（`availableLabels`）
4. Phase 3でLLMに渡すための準備

### Output
`/tmp/gmail-auto-labeling/label_validation.json`:
```json
{
  "unson": {
    "existingLabelIds": {
      "finance/invoice": "Label_8764504159471345508",
      "dev/github": "Label_123",
      "dev/pr": "Label_456"
    }
  },
  "salestailor": {
    "existingLabelIds": {
      "project/crm": "Label_789",
      "finance/invoice": "Label_012"
    }
  },
  "techknight": {
    "existingLabelIds": {
      "dev/github": "Label_345",
      "dev/vercel": "Label_678"
    }
  }
}
```

### Success Criteria
- [✅] SC-1: 全アカウントのラベル一覧取得成功
- [✅] SC-2: Label名→ID変換マップ作成完了
- [✅] SC-3: 認証エラーなし（401/403）

### Review & Replan
- **Critical**: 認証エラー発生 → 人間へエスカレーション
- **Minor**: 一部アカウントでラベル0件 → 警告記録 + Phase 2へ進行
- **None**: 全アカウント正常取得 → Phase 2へ進行

---

## Phase 2: メール取得

**Subagent**: `agents/gmail_phase2_fetch_messages.md`

### Purpose
未分類メール（`label:unread` または `in:inbox`）を各アカウントから取得。

### Input
- `label_validation.json`（Phase 1の出力）
- `maxMessages`: アカウントあたりの最大取得件数（デフォルト: 100）

### Process
1. 3アカウント並列で`gmail_list_messages`呼び出し
   - クエリ: `is:unread` または `in:inbox`
   - maxResults: 100件/アカウント
2. メッセージの詳細取得（`gmail_get_message`）
3. メール一覧をJSON形式で出力

### Output
`/tmp/gmail-auto-labeling/fetched_messages.json`:
```json
{
  "unson": [
    {
      "id": "abc123",
      "threadId": "thread-1",
      "from": "notifications@github.com",
      "subject": "Pull Request #123 opened",
      "body": "A new PR has been opened...",
      "labelIds": ["INBOX", "UNREAD"]
    }
  ],
  "salestailor": [...],
  "techknight": [...]
}
```

### Success Criteria
- [✅] SC-1: 全アカウントでメール取得成功
- [✅] SC-2: 各アカウント最大100件取得
- [✅] SC-3: メール詳細（from, subject, body）取得完了

### Review & Replan
- **Critical**: API呼び出し失敗（3回リトライ後） → Phase 2再実行
- **Minor**: 一部アカウントで0件 → 記録 + Phase 3へ
- **None**: 全アカウント正常取得 → Phase 3へ

---

## Phase 3: 分類実行

**Subagent**: `agents/gmail_phase3_classify.md`

### Purpose
email-classifier Skillを使って各メールを分類し、適用すべきラベルを決定。

### Input
- `fetched_messages.json`（Phase 2の出力）
- `label_validation.json`（Phase 1の出力）

### Process
1. Phase 2のメールリスト読み込み
2. availableLabels準備（Phase 1の`existingLabelIds`から）
3. 各メールに対してemail-classifier Skill呼び出し（LLM版）
   - Input: メールオブジェクト + アカウントID + availableLabels + brainbaseContext（オプション）
   - Output: `{ addLabelNames, removeLabelIds, urgency, needsReply, reasoning, actions }`
4. Label名 → Label ID変換（`label_validation.json`を参照）
5. 分類結果マップ作成

### Output
`/tmp/gmail-auto-labeling/classification_results.json`:
```json
{
  "unson": {
    "abc123": {
      "addLabelIds": ["Label_123", "Label_456"],
      "removeLabelIds": ["INBOX"],
      "urgency": 2,
      "needsReply": false,
      "reasoning": "GitHub PR通知。開発関連だが緊急性は低い。自動通知なので返信不要。",
      "actions": {
        "archive": false,
        "markAsRead": false
      }
    }
  }
}
```

### Success Criteria
- [✅] SC-1: 全メール分類完了（LLM推論成功）
- [✅] SC-2: Label名 → Label ID変換成功
- [✅] SC-3: brainbaseContext取得試行（失敗時はnullで継続）
- [✅] SC-4: urgency/needsReply/reasoning出力

### Review & Replan
- **Critical**: email-classifier Skill呼び出し失敗 → Phase 3再実行
- **Minor**: brainbaseContext取得失敗 → 警告 + Phase 4へ
- **None**: 全メール分類成功 → Phase 4へ

---

## Phase 4: ラベル適用

**Subagent**: `agents/gmail_phase4_apply_labels.md`

### Purpose
gmail_modify_labelsを使って各メールにラベル適用。

### Input
- `classification_results.json`（Phase 3の出力）

### Process
1. Phase 3の分類結果読み込み
2. 各メールに対して`gmail_modify_labels`呼び出し
   - Rate Limit対策: retryWithBackoff（Gmail MCP側で実装済み）
3. 成功/失敗カウント
4. 失敗メッセージIDを記録

### Output
`/tmp/gmail-auto-labeling/apply_results.json`:
```json
{
  "summary": {
    "total": 285,
    "success": 270,
    "failed": 15,
    "successRate": 0.947
  },
  "failedMessages": [
    {
      "account": "unson",
      "messageId": "xyz789",
      "error": "Label not found: Label_999"
    }
  ]
}
```

### Success Criteria
- [✅] SC-1: 全分類結果にラベル適用試行
- [✅] SC-2: 成功率90%以上
- [✅] SC-3: 失敗メッセージID記録

### Review & Replan
- **Critical**: 成功率50%未満 → Phase 4再実行
- **Minor**: 成功率50-90% → 警告 + Phase 5へ
- **None**: 成功率90%以上 → Phase 5へ

---

## Phase 5: レポート生成

**Subagent**: `agents/gmail_phase5_report.md`

### Purpose
処理サマリーをMarkdown形式で生成。

### Input
- `label_validation.json`（Phase 1）
- `fetched_messages.json`（Phase 2）
- `classification_results.json`（Phase 3）
- `apply_results.json`（Phase 4）

### Process
1. 全Phase結果を集約
2. アカウント別・ラベル別統計を算出
3. Markdown形式でレポート生成
4. `/tmp/gmail-auto-labeling/report.md`に出力

### Output
`/tmp/gmail-auto-labeling/report.md`:
```markdown
# Gmail自動仕分けレポート

実行日時: 2026-01-03 10:45:00

## 実行サマリー

- **総メール数**: 285件
- **成功**: 270件（94.7%）
- **失敗**: 15件（5.3%）

## アカウント別詳細

### UNSON
- 取得: 100件
- 成功: 95件
- 適用ラベル:
  - `dev/github`: 30件
  - `finance/invoice`: 20件
  - `spam/promo`: 10件

### SALESTAILOR
- 取得: 85件
- 成功: 80件
- 適用ラベル:
  - `project/crm`: 50件
  - `dev/vercel`: 10件

### TECHKNIGHT
- 取得: 100件
- 成功: 95件
- 適用ラベル:
  - `dev/github`: 40件
  - `dev/pr`: 20件

## 失敗詳細

| Account | MessageID | Error |
|---------|----------|-------|
| unson | xyz789 | Label not found: Label_999 |
```

### Success Criteria
- [✅] SC-1: Markdownレポート生成
- [✅] SC-2: アカウント別統計正確
- [✅] SC-3: 失敗詳細テーブル出力

### Review & Replan
- **None**: レポート生成成功 → Orchestrator完了

---

## Orchestrator Responsibilities

### Phase Management

**各Phaseの完了を確認**:
- Phase 1の成果物が存在するか（Label検証結果）
- Phase 2の成果物が存在するか（取得済みメール一覧）
- Phase 3の成果物が存在するか（分類結果）
- Phase 4の成果物が存在するか（ラベル適用結果）
- Phase 5の成果物が存在するか（処理サマリーレポート）

**Phase間のデータ受け渡しを管理**:
- Phase 1の`label_validation.json`をPhase 2とPhase 3に渡す
  - `existingLabelIds`: Label名→Label IDマップ（Phase 3でLLM出力をIDに変換）
  - `availableLabels`: 利用可能なラベル名一覧（Phase 3でLLMに渡す選択肢）
- Phase 2の`fetched_messages.json`をPhase 3に渡す
  - 各メールの`id`, `subject`, `snippet`, `sender`, `accountId`
- Phase 3の`classification_results.json`をPhase 4に渡す
  - 各メールの`id`, `accountId`, `labelIds`, `urgency`, `needsReply`, `reasoning`
- Phase 4の`apply_results.json`をPhase 5に渡す
  - `successCount`, `failureCount`, `failedMessageIds`
- 引数`maxMessages`, `targetAccounts`, `dryRun`を全Phaseで引き継ぐ

---

### Review & Replan

**Review実施** (各Phase完了後):

1. **ファイル存在確認**
   - Phase 1成果物: `/tmp/gmail-auto-labeling/label_validation.json`
   - Phase 2成果物: `/tmp/gmail-auto-labeling/fetched_messages.json`
   - Phase 3成果物: `/tmp/gmail-auto-labeling/classification_results.json`
   - Phase 4成果物: `/tmp/gmail-auto-labeling/apply_results.json`
   - Phase 5成果物: `/tmp/gmail-auto-labeling/report.md`

2. **Success Criteriaチェック**
   - **Phase 1（Label検証）**:
     - SC-1: 各アカウント（unson, salestailor, techknight）の`gmail_list_labels`呼び出しが成功している
     - SC-2: `existingLabelIds`マップが作成されている（Label名→Label IDマッピング）
     - SC-3: `availableLabels`配列が作成されている（LLMに渡す選択肢）
     - SC-4: email-classifierで定義された必須ラベル（顧客対応、緊急、ToDo等）がすべて存在する
   - **Phase 2（メール取得）**:
     - SC-1: 各アカウントから`is:unread`または`in:inbox`メールが取得されている
     - SC-2: 各メールに`id`, `subject`, `snippet`, `sender`, `accountId`が含まれている
     - SC-3: 取得件数が`maxMessages`以下である（デフォルト100）
     - SC-4: `targetAccounts`指定時、指定アカウントのみが処理されている
   - **Phase 3（分類実行）**:
     - SC-1: 各メールがemail-classifier Skillで分類されている（LLM推論）
     - SC-2: 各メールに`labelIds`配列が割り当てられている（Label ID形式）
     - SC-3: 各メールに`urgency`（high/medium/low）が設定されている
     - SC-4: 各メールに`needsReply`（boolean）が設定されている
     - SC-5: 各メールに`reasoning`（判断理由）が含まれている
     - SC-6: LLMが選択したラベル名が`availableLabels`内に存在する（Phase 1で検証済みのラベルのみ）
   - **Phase 4（ラベル適用）**:
     - SC-1: `--dry-run`指定時はスキップされている
     - SC-2: 各メールに対して`gmail_modify_labels`が呼び出されている
     - SC-3: 成功率が90%以上である（`successCount / (successCount + failureCount) >= 0.9`）
     - SC-4: 失敗したメッセージIDが`failedMessageIds`に記録されている
   - **Phase 5（レポート生成）**:
     - SC-1: アカウント別統計（処理件数、成功件数、失敗件数）が含まれている
     - SC-2: ラベル別統計（各ラベルの適用件数）が含まれている
     - SC-3: LLM出力統計（urgency分布、needsReply集計）が含まれている
     - SC-4: 失敗詳細（failedMessageIds、エラーメッセージ）が含まれている
     - SC-5: Markdown形式で整形されている

3. **差分分析**
   - **Phase 1**: email-classifier Skillで定義された必須ラベルがすべて存在するか
   - **Phase 2**: 取得件数が期待値（maxMessages以下）であるか
   - **Phase 3**: email-classifier基準への準拠（緊急度判定、返信要否判定、ラベル選択の妥当性）
   - **Phase 4**: 成功率が目標（90%以上）を達成しているか
   - **Phase 5**: レポートフォーマットが標準（Markdown、必須セクション含む）に準拠しているか

4. **リスク判定**
   - **Critical**: リプラン実行（Subagentへ修正指示）
     - Phase 1: 必須ラベルが存在しない（email-classifier定義との不整合）
     - Phase 2: メール取得件数が0（Gmail API接続失敗の可能性）
     - Phase 3: LLMが選択したラベルが`availableLabels`外（Phase 1との不整合）
     - Phase 4: 成功率が50%未満（深刻なAPI障害）
     - Phase 5: レポートが生成されていない
   - **Minor**: 警告+進行許可
     - Phase 1: 一部アカウントのラベル取得失敗（他アカウントは継続）
     - Phase 2: 取得件数がmaxMessagesより少ない（未分類メールが少ない場合は正常）
     - Phase 3: 一部メールの分類失敗（LLMエラー、リトライ後も失敗）
     - Phase 4: 成功率が50-90%（Rate Limit等の一時的エラー）
     - Phase 5: レポートの一部セクション欠落（必須情報は含まれている）
   - **None**: 承認（次Phaseへ）

**Replan実行** (Critical判定時):

1. **Issue Detection（問題検出）**
   - Success Criteriaの不合格項目を特定
   - 例: "Phase 3でLLMが選択したラベル'プロジェクト提案'が`availableLabels`に存在しません（Phase 1で取得したラベル一覧に含まれていません）"

2. **Feedback Generation（フィードバック生成）**
   - 何が要件と異なるか: "Phase 3の分類結果に、Phase 1のlabel_validation.jsonに存在しないラベルが含まれています"
   - どう修正すべきか: "email-classifier Skillを再実行し、`availableLabels`内のラベルのみを選択してください。具体的には、以下のラベルから選択してください: ['顧客対応', '緊急', 'ToDo', 'プロジェクト提案（顧客名）', '報告・連絡・相談', '1on1', 'Archive']"
   - 修正チェックリスト:
     - [ ] email-classifierで`availableLabels`を再確認
     - [ ] 各メールの分類時に`availableLabels`外のラベルを選択していないか確認
     - [ ] LLM出力のラベル名を`existingLabelIds`でLabel IDに変換できるか確認
     - [ ] 変換できないラベルがある場合、最も近いラベルに修正
     - [ ] 再分類結果を`classification_results.json`に保存

3. **Replan Prompt Creation（リプランプロンプト作成）**
   - 元のタスク + フィードバック
   - Success Criteriaの再定義（修正後の期待値）

4. **Subagent Re-execution（Subagent再実行）**
   - Task Tool経由で該当Phaseを再起動
   - リプランプロンプトを入力
   - 修正成果物を取得

5. **Re-Review（再レビュー）**
   - 修正成果物を同じ基準で再評価
   - **PASS** → 次Phaseへ
   - **FAIL** → リトライカウント確認
     - リトライ < Max (3回) → ステップ1へ戻る
     - リトライ >= Max (3回) → 人間へエスカレーション（AskUserQuestion）

**Max Retries管理**:
- 各Phaseで最大3回までリプラン実行可能
- 3回超過時は人間（佐藤）へエスカレーション
- エスカレーション内容:
  - 何が問題か（Success Criteria不合格項目）
  - どう修正を試みたか（リプラン履歴）
  - 人間の判断が必要な理由

---

### Error Handling

**Phase実行失敗時のフォールバック**:
- Subagent起動失敗 → Task Tool再実行（1回）
- Gmail MCP接続失敗 → OAuth再認証ガイド表示（`/Users/ksato/workspace/.claude/mcp/gmail/GMAIL_REAUTH_GUIDE.md`）
- ファイル書き込み失敗 → `/tmp/gmail-auto-labeling/`ディレクトリ作成 + 再実行

**データ不足時の追加情報取得**:
- `targetAccounts`指定時、存在しないアカウントID → AskUserQuestionで確認
- Phase間のデータ引き継ぎ失敗 → 前Phaseの成果物を再読み込み
- email-classifier Skill読み込み失敗 → パス確認（`/Users/ksato/workspace/.claude/skills/email-classifier/`）

**Max Retries超過時の人間へのエスカレーション**:
- 3回のリプラン実行後も基準を満たさない → AskUserQuestion
- 質問内容: 問題の詳細、リプラン履歴、人間の判断を求める理由

**Gmail API Rate Limit対応**:
- Phase 2（メール取得）、Phase 4（ラベル適用）でRate Limitエラー発生時
- Gmail MCP側の`retryWithBackoff`が自動実行（最大3回）
- 3回失敗時は人間へエスカレーション（"Rate Limit超過、しばらく待ってから再実行してください"）

---

## Troubleshooting

### Common Issues

**Issue 1: Label not found**
- **症状**: Phase 4で`Label not found: Label_XXX`エラー
- **原因**: LLMが選択したラベルがGmailに存在しない（Phase 1とPhase 3の間でラベル削除された等）
- **対処**: Gmailでラベルを手動作成、またはPhase 1を再実行してラベル一覧を更新

**Issue 2: Rate Limit**
- **症状**: Phase 4で`429 Too Many Requests`
- **原因**: Gmail API Rate Limit超過
- **対処**: retryWithBackoffが自動実行（最大3回）、失敗時は人間へエスカレーション

**Issue 3: Authentication Error**
- **症状**: Phase 1/2で`401 Unauthorized`
- **原因**: OAuth refresh tokenの期限切れ
- **対処**: `/Users/ksato/workspace/.claude/mcp/gmail/GMAIL_REAUTH_GUIDE.md`参照

---

## File Paths

- **Output Directory**: `/tmp/gmail-auto-labeling/`
- **email-classifier Prompts**: `/Users/ksato/workspace/.claude/skills/email-classifier/prompts/`
- **Subagents**: `/Users/ksato/workspace/.claude/skills/gmail-auto-labeling/agents/`

---

## Performance

- **処理時間**: 約5-10分（300件処理・LLM版）
  - Phase 1-2: ~1分（Label検証・メール取得）
  - Phase 3: ~5-8分（LLM分類・300回呼び出し）
  - Phase 4-5: ~1分（ラベル適用・レポート生成）
- **成功率目標**: 90%以上
- **並列処理**: Phase 2で3アカウント同時実行
- **LLMコスト**: ~$0.90/300件（sonnet）

---

## Version

- **Current**: 1.0.0
- **Last Updated**: 2026-01-03

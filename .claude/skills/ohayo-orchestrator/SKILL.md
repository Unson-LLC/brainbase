---
name: ohayo-orchestrator
description: 朝のセットアップを自動化。リポジトリ同期→情報収集（カレンダー・タスク・メール自動振り分け）→サマリー生成→フォーカス提案を並列実行。
tools: []
skills: [gmail-auto-labeling]
---

# おはようダッシュボード Orchestrator

仕事開始時に実行する朝のセットアップコマンド。
同期 → 現状把握 → AI提案 → フォーカス確定 の流れで1日をスタート。

## Orchestration Overview

```
Phase 0: リポジトリ同期
    ↓
Phase 0.5: MCP依存データ取得（Main Orchestratorが実行）★重要
    ↓
Phase 1: 情報収集（Subagent - ファイル系タスクのみ）
    ↓
Phase 2: サマリー生成 + フォーカス提案（並列: 2タスク）
    ↓
Phase 3: 確認・締め（Main Orchestrator）
```

**重要**: SubagentはMCPツールにアクセスできないため、カレンダー・Gmail等のMCP依存データはPhase 0.5でMain Orchestratorが取得する。

**実行フロー（Main Orchestratorの責務）**:

このOrchestrator（Main Orchestrator）は、以下の順序で各Phaseを実行します：

1. **Phase 0実行**: Bashツールでリポジトリ同期スクリプトを実行
   - `cd /Users/ksato/workspace && ./shared/_codex/common/ops/scripts/nocodb/update-all-repos.sh`を実行
   - 結果を確認（dirty/失敗リポジトリのリスト取得）
   - Phase 0.5へ進む

2. **Phase 0.5実行**: Main Orchestratorが直接実行（MCPツール呼び出し）
   - Step 1: `/tmp/ohayo/`ディレクトリ作成
   - Step 2: MCPSearchでカレンダーツールをロード
   - Step 3: `mcp__google-calendar__get-current-time`で現在時刻取得
   - Step 4: `mcp__google-calendar__list-events`でカレンダー取得
   - Step 5: Skillツールで`gmail-auto-labeling`実行
   - Step 6: 結果を`/tmp/ohayo/mcp_data.json`に保存
   - Phase 0.5完了を確認（mcp_data.json存在確認）
   - Phase 1へ進む

3. **Phase 1実行**: Task toolでSubagent起動
   - `Task({ subagent_type: "phase1-gather", prompt: "...", description: "Phase 1 情報収集" })`を実行
   - phase1-gatherがmcp_data.jsonを読み込み、ファイル系タスクを収集
   - `/tmp/ohayo/phase1_results.json`生成を待つ
   - Phase 1完了を確認（phase1_results.json存在確認）
   - Phase 2へ進む

4. **Phase 2実行**: Task toolで2つのSubagentを並列起動
   - `Task({ subagent_type: "phase2-summary", ..., run_in_background: true })`を実行（バックグラウンド）
   - `Task({ subagent_type: "phase2-focus", ..., run_in_background: true })`を実行（バックグラウンド）
   - 両方の完了を待つ（TaskOutputでブロック）
   - Phase 2完了を確認（_schedules/YYYY-MM-DD.md存在確認、フォーカス提案テキスト取得）
   - Phase 3へ進む

5. **Phase 3実行**: Main Orchestratorが直接実行（ユーザー確認）
   - phase2-summaryの結果を画面表示
   - phase2-focusの結果を画面表示
   - AskUserQuestionでフォーカス確定
   - 確定メッセージ表示
   - Orchestrator完了

**重要な実行原則**:
- Phase 0, 0.5, 3は Main Orchestrator（このSkill）が直接実行
- Phase 1, 2は Task toolでSubagentを起動
- Phase 2の2つのSubagentは並列実行（run_in_background: true）
- 各Phase完了後、Success Criteriaチェック（ファイル存在確認）を実施
- エラー発生時はReview & Replanフロー実行（最大3回リトライ）

---

## Phase 0: リポジトリ同期

**実行方法**: Main Orchestratorが直接Bashで実行（Subagentなし）

```bash
cd /Users/ksato/workspace && ./shared/_codex/common/ops/scripts/nocodb/update-all-repos.sh
```

### Purpose
全リポジトリを最新状態に同期し、dirtyな状態を検出。

### Input
- なし

### Process
1. `/Users/ksato/workspace/shared/_codex/common/ops/scripts/nocodb/update-all-repos.sh` を実行
2. dirtyなリポジトリがあれば報告
3. pull失敗があれば報告

### Output
- 同期結果サマリー（成功/失敗/dirty状態）

### Success Criteria
- [✅] SC-1: update-all-repos.sh 実行成功
- [✅] SC-2: dirty/失敗リポジトリのリスト取得
- [✅] SC-3: ユーザーへの報告完了

### Review & Replan
- **Critical**: スクリプト実行失敗 → Phase 0再実行
- **Minor**: dirty/失敗リポジトリあり → 警告記録 + Phase 0.5へ
- **None**: 全リポジトリ同期成功 → Phase 0.5へ

---

## Phase 0.5: MCP依存データ取得

**実行方法**: Main Orchestratorが直接実行（Subagentなし）

**重要**: SubagentはMCPツールにアクセスできないため、このPhaseでカレンダー・Gmailを取得する。

### Purpose
MCPツールを使用してカレンダーとGmailデータを取得し、Subagentに渡すためのファイルを生成。

### Input
- なし

### Process

Main Orchestratorが以下の手順を実行します：

**Step 1: 出力ディレクトリ作成**
1. `/tmp/ohayo/`ディレクトリが存在しない場合は作成する
2. Bashツールで`mkdir -p /tmp/ohayo`を実行

**Step 2: MCPツールをロード**
1. MCPSearchツールを使用して、カレンダーツールをロード
   - `MCPSearch({ query: "select:mcp__google-calendar__get-current-time" })`を実行
   - `MCPSearch({ query: "select:mcp__google-calendar__list-events" })`を実行
2. ツールがロードされたことを確認

**Step 3: 現在時刻を取得**
1. `mcp__google-calendar__get-current-time`ツールを呼び出し
   - パラメータ: `{ account: "unson", timeZone: "Asia/Tokyo" }`
2. レスポンスから現在のタイムスタンプを取得（例: `2026-01-09T09:00:00+09:00`）
3. このタイムスタンプから、今日の0:00と23:59を計算
   - 例: `2026-01-09T00:00:00+09:00`から`2026-01-09T23:59:59+09:00`

**Step 4: カレンダーイベントを取得**
1. `mcp__google-calendar__list-events`ツールを呼び出し
   - パラメータ:
     - `account: "unson"`
     - `calendarId: ["k.sato.unson@gmail.com", "k.sato.ncom@gmail.com", "k.sato@sales-tailor.jp", "k.sato.baao@gmail.com", "k.sato.knllc@gmail.com", "k0127s@gmail.com", "sin310135@gmail.com"]`
     - `timeMin`: Step 3で計算した今日の0:00（例: `2026-01-09T00:00:00+09:00`）
     - `timeMax`: Step 3で計算した今日の23:59（例: `2026-01-09T23:59:59+09:00`）
     - `timeZone: "Asia/Tokyo"`
2. レスポンスからイベント一覧を取得
3. 各イベントから`summary`, `start.dateTime`, `end.dateTime`, `location`を抽出
4. イベント件数をカウント

**Step 5: Gmail自動振り分けを実行**
1. Skillツールで`gmail-auto-labeling`を呼び出し
   - パラメータ: `{ skill: "gmail-auto-labeling" }`
   - ohayo-orchestratorがsonnetで動いているため、親モデルが継承される
2. gmail-auto-labelingの完了を待つ
3. レポートファイル`/tmp/gmail-auto-labeling/report.md`が生成されたことを確認
4. レポートから以下の情報を抽出:
   - `total`: 処理したメール総数
   - `labeled`: ラベル適用成功件数
   - `successRate`: 成功率（labeled / total）
   - `urgent`: 緊急度が高いメールのリスト（urgency >= 3）
   - `needs_reply`: 返信が必要なメールのリスト（needsReply = true）

**Step 6: 結果をファイルに保存**
1. Step 3, 4, 5の結果をJSON形式で整形
2. Writeツールで`/tmp/ohayo/mcp_data.json`に保存
   - 構造:
     ```json
     {
       "timestamp": "2026-01-09T09:00:00+09:00",
       "calendar": {
         "events": [
           { "time": "10:00-11:00", "summary": "週次MTG", "location": "Google Meet" }
         ],
         "count": 3
       },
       "gmail": {
         "summary": { "total": 30, "labeled": 17, "successRate": 0.57 },
         "urgent": [
           { "account": "techknight", "from": "Fly.io", "subject": "Payment failed", "urgency": 4 }
         ],
         "needs_reply": []
       }
     }
     ```
3. ファイルが正常に保存されたことを確認

### Output
`/tmp/ohayo/mcp_data.json`:
```json
{
  "timestamp": "2026-01-06T09:00:00+09:00",
  "calendar": {
    "events": [
      { "time": "10:00-11:00", "summary": "週次MTG", "location": "Google Meet" }
    ],
    "count": 5
  },
  "gmail": {
    "summary": { "total": 30, "labeled": 17, "successRate": 0.57 },
    "urgent": [
      { "account": "techknight", "from": "Fly.io", "subject": "Payment failed", "urgency": 4 }
    ],
    "needs_reply": []
  }
}
```

### Success Criteria
- [✅] SC-1: カレンダー取得成功（0件でも成功）
- [✅] SC-2: Gmail自動振り分け実行
- [✅] SC-3: `mcp_data.json` 生成成功

### Review & Replan
- **Critical**: mcp_data.json 生成失敗 → Phase 0.5再実行
- **Minor**: カレンダーまたはGmail取得失敗 → 該当データを空で記録 + Phase 1へ
- **None**: 全データ取得成功 → Phase 1へ

---

## Phase 1: 情報収集（ファイル系タスク）

**実行方法**: Task toolで `phase1-gather` Subagentを起動

```javascript
Task({
  subagent_type: "phase1-gather",
  prompt: "/tmp/ohayo/mcp_data.json を読み込み、ファイル系タスク（タスク・Git・Slack・学習候補）を収集して phase1_results.json を生成してください",
  description: "Phase 1 情報収集"
})
```

**成果物**: `/tmp/ohayo/phase1_results.json`

### Purpose
ファイル系の情報を収集し、Phase 0.5で取得したMCPデータとマージしてphase1_results.jsonを生成。

### Input
- `/tmp/ohayo/mcp_data.json`（Phase 0.5で生成）

### Process（並列実行）

**Task 1: MCPデータ読み込み**
- `/tmp/ohayo/mcp_data.json` を読み込み
- カレンダーとGmailデータを取得

**Task 2: 未完了タスク**
- `_tasks/index.md` を読み込み
- status が `pending` または `in_progress` のものを抽出

**Task 3: 昨日の活動**
- `git log --since="yesterday 00:00" --until="today 00:00" --oneline`

**Task 4: Slack未対応メンション**
- `_inbox/pending.md` を読み込み
- status が `pending` のものを抽出
- 自分宛メンション（@k.sato）を優先

**Task 5: 学習候補**
- `.claude/learning/learning_queue/` のファイル数をカウント
- 信頼度0.8以上の候補がある場合は `/learn-skills` 実行を提案

**Task 6: SNSバズ候補**
- `_inbox/sns_candidates.md` を読み込み
- 各候補からScore上位3件を抽出（engagement順）
- URL、投稿者、スコアを記録

**注意**: カレンダーとGmailはPhase 0.5で取得済み。mcp_data.jsonから読み込んでマージする。

### Output
`/tmp/ohayo/phase1_results.json`:
```json
{
  "calendar": { "events": [...], "count": 3 },
  "tasks": { "pending": [...], "in_progress": [...], "count": 5 },
  "git": { "commits": [...], "count": 12 },
  "slack": { "mentions": [...], "count": 2 },
  "learning": { "queue_count": 3, "suggest_learn": true },
  "gmail": {
    "total": 30,
    "labeled": 17,
    "urgent": [
      {
        "account": "techknight",
        "from": "Fly.io",
        "subject": "Payment failed",
        "urgency": 4,
        "needsReply": true
      }
    ],
    "needs_reply": [...]
  },
  "sns_buzz": {
    "categories": [
      { "name": "English: AI Coding", "candidates": [
        { "author": "DavidKPiano", "score": 16574, "url": "https://x.com/...", "text": "Before AI coding agents..." }
      ]}
    ],
    "total_count": 9
  }
}
```

### Success Criteria
- [✅] SC-1: mcp_data.json 読み込み成功
- [✅] SC-2: 6タスク（タスク・Git・Slack・学習候補・SNSバズ・MCPマージ）すべて完了
- [✅] SC-3: phase1_results.json 生成成功（カレンダー・Gmail・SNSバズデータ含む）

### Review & Replan
- **Critical**: phase1_results.json 生成失敗 → Phase 1再実行
- **Minor**: ファイル系タスクの一部失敗 → 該当データを"取得失敗"として記録 + Phase 2へ
- **None**: 全タスク成功 → Phase 2へ

---

## Phase 2: サマリー生成 + フォーカス提案（並列実行）

**実行方法**: Task toolで2つのSubagentを並列起動

```javascript
// 1つのメッセージで両方を呼び出す（並列実行）
Task({
  subagent_type: "phase2-summary",
  prompt: "/tmp/ohayo/phase1_results.json を読み込み、サマリー生成してください。スケジュールファイルは /Users/ksato/workspace/shared/_schedules/YYYY-MM-DD.md に保存してください（YYYYMMDDは今日の日付）",
  description: "Phase 2 サマリー生成",
  run_in_background: true
})

Task({
  subagent_type: "phase2-focus",
  prompt: "phase1_results.jsonを読み込み、今日のフォーカスを1つ提案してください",
  description: "Phase 2 フォーカス提案",
  run_in_background: true
})

// 両方の完了を待つ
TaskOutput({ task_id: "summary_agent_id", block: true })
TaskOutput({ task_id: "focus_agent_id", block: true })
```

**成果物**:
- `/Users/ksato/workspace/shared/_schedules/YYYY-MM-DD.md`
- フォーカス提案テキスト

### Purpose
収集した情報をサマリー化し、同時に今日の最優先事項を提案。

### Input
- `/tmp/ohayo/phase1_results.json`（必須）

### Process

**Subagent 1: サマリー生成（phase2-summary）**
- 画面出力用サマリー生成
- スケジュールファイル生成（`_schedules/YYYY-MM-DD.md`）

**Subagent 2: フォーカス提案（phase2-focus）**
- タスク・カレンダー・昨日の活動・Slackメンション・メールから最優先事項を1つ提案

### Output

**Subagent 1 出力**:
- 画面サマリー（Markdown形式）
- `_schedules/YYYY-MM-DD.md` 保存

**Subagent 2 出力**:
```markdown
💡 今日のフォーカス提案:
「Fly.io支払い失敗の対応」

理由: 緊急度4の高優先度メールで、サービス停止リスクあり
```

### Success Criteria
- [✅] SC-1: 両Subagent完了
- [✅] SC-2: スケジュールファイル生成成功
- [✅] SC-3: フォーカス提案が妥当（タスク/メール/カレンダーに基づく）

### Review & Replan
- **Critical**: スケジュールファイル生成失敗 → phase2-summary再実行
- **Minor**: フォーカス提案が不適切 → 警告 + Phase 3へ
- **None**: 両Subagent成功 → Phase 3へ

---

## Phase 3: 確認・締め

### Purpose
フォーカスを確定し、1日をスタート。

### Input
- Phase 2 のサマリー + フォーカス提案

### Process（Main Orchestrator）

1. **サマリー表示**（phase2-summary結果）
2. **フォーカス提案表示**（phase2-focus結果）
3. **AskUserQuestion**: 「この提案で進めますか？」
   - 選択肢: 「OK」「別のタスクを優先」「今日はノープラン」
4. ユーザーが「別のタスク」を選んだ場合は、タスク一覧から選択
5. **確定メッセージ**:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   🎯 今日のフォーカス: {確定した内容}
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   では、始めましょう。
   ```

### Output
- なし（画面表示のみ）

### Success Criteria
- [✅] SC-1: ユーザー確認完了
- [✅] SC-2: 確定メッセージ表示

### Review & Replan
- **None**: 常に承認 → Orchestrator完了

---

## Orchestrator Responsibilities

### Phase Management
- Phase順序の管理（0 → 1 → 2 → 3）
- Phase間のデータ受け渡し検証
- 各Phaseの完了確認

### Review & Replan
各Phase完了後、以下の4ステップでレビュー：

**Step 1: ファイル存在確認**
- Phase 1: `phase1_results.json`
- Phase 2: `_schedules/YYYY-MM-DD.md`

**Step 2: Success Criteriaチェック**
- 各PhaseのSCが達成されているか

**Step 3: 差分分析**
- 期待値（Success Criteria）vs 実際（成果物）の差分

**Step 4: リスク判定**
- **Critical**: リプラン必須 → Subagent再実行
- **Minor**: 警告+進行許可 → 次Phaseへ
- **None**: 承認 → 次Phaseへ

**Replan実行フロー**:
1. Issue Detection: 不合格項目の特定
2. Feedback Generation: 修正方針の明示化
3. Subagent Re-execution: Task Tool経由で再起動
4. Re-Review: 同じ基準で再評価
5. Max Retries: 3回（超過時は人間へエスカレーション）

### Error Handling
- **Phase実行失敗**: Max 3回リトライ → 人間へエスカレーション
- **データ不足**: 該当データを"取得失敗"として記録 + 続行
- **API失敗**: Gmail/Calendar API失敗時も続行（エラーメッセージ表示）

---

## Usage Example

### Basic Usage
```bash
# カスタムコマンド経由
/ohayo
```

### Expected Output
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☀️ おはよう｜金曜日 01/03
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase 0: リポジトリ同期... ✅
Phase 1: 情報収集 + Gmail処理... ✅ (6タスク並列)
Phase 2: サマリー生成 + フォーカス提案... ✅ (2タスク並列)

📅 今日の予定: 0件
MTGなし

📋 未完了タスク: 0件
現在、未完了のタスクはありません。

📊 昨日の活動: 5件
- fix(gmail): ポート3001に変更
- feat(gmail): k.sato.unson@gmail.com追加
- docs(ohayo): Orchestrator設計

💬 Slack未対応: 0件
現在、未対応のメンションはありません。

📧 Gmail自動振り分け: 17件完了（30件中）
⚠️ 高緊急度メール: 2件
  - Fly.io支払い失敗 (techknight, urgency 4)
  - GMOサイン契約書署名 (techknight, urgency 4)

📚 学習候補: 0件

🐦 SNSバズ候補: 9件
[AI Coding] @DavidKPiano (Score: 16574) - Before AI coding agents...
[Claude Code] @Kyomesuke (Score: 6598) - Claude Codeおまえ…
[AI Agent] @mattn_jp (Score: 2628) - 僕の観測範囲で喋ってしまうけど...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 今日のフォーカス提案:
「Fly.io支払い失敗の対応」

理由: 緊急度4の高優先度メールで、サービス停止リスクあり

この提案で進めますか？
> OK
> 別のタスクを優先
> 今日はノープラン

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 今日のフォーカス: Fly.io支払い失敗の対応
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
では、始めましょう。
```

---

## File Paths

- **Output Directory**: `/tmp/ohayo/`
- **Subagents**: `/Users/ksato/workspace/.claude/agents/` (phase0-sync, phase1-gather, phase2-summary, phase2-focus)
- **スケジュール保存先**: `/Users/ksato/workspace/shared/_schedules/YYYY-MM-DD.md`

---

## Performance

- **処理時間**: 約30秒〜1分（並列実行により高速化）
- **並列実行**: Phase 1で6タスク、Phase 2で2タスク
- **Gmail処理**: gmail-auto-labelingに委譲（約3-5分/300件）

---

## Version

- **Current**: 1.0.0
- **Last Updated**: 2026-01-03

---
name: verify-first-debugging-team
description: バグ修正を確実・深く・早く・本格的に実行する5職能Agent Teams。VERIFY-FIRST Frameworkの6 Phase（REPRODUCE→LOCATE→VERIFY→PREREQUISITES→ROOT CAUSE→FIX）を自動化し、Review & Replanで品質保証。
teammates:
  - name: bug-analyst
    agentType: bug-analyst
    description: Phase 1-2を担当（再現・影響範囲特定）
    tools: [ToolSearch, Skill, Bash, Read, Grep, Glob, LSP]
    skills: [verify-first-debugging, git-workflow, context-check]
  - name: verification-specialist
    agentType: verification-specialist
    description: Phase 3を担当（バグタイプ選択 + 8種類検証）
    tools: [ToolSearch, Skill, Bash, Read, Grep, Glob]
    skills: [verify-first-debugging, architecture-patterns, security-patterns]
  - name: root-cause-investigator
    agentType: root-cause-investigator
    description: Phase 4-5を担当（前提条件確認 + 根本原因特定）
    tools: [ToolSearch, Skill, Bash, Read, Grep]
    skills: [verify-first-debugging, system2-reasoning]
    model: opus
  - name: fix-engineer
    agentType: fix-engineer
    description: Phase 6を担当（根本修正 + テスト追加）
    tools: [ToolSearch, Skill, Bash, Read, Write, Edit, Grep]
    skills: [verify-first-debugging, tdd-workflow, git-commit-rules]
  - name: qa-lead
    agentType: qa-lead
    description: Review & Replanを担当（成果物レビュー + リプラン実行）
    tools: [ToolSearch, Skill, Read, SendMessage]
    skills: [verify-first-debugging, test-strategy]
---

# verify-first-debugging-team Skill

**概要**: バグ修正を確実・深く・早く・本格的に実行する5職能Agent Teams。VERIFY-FIRST Frameworkの6 Phase（REPRODUCE→LOCATE→VERIFY→PREREQUISITES→ROOT CAUSE→FIX）を自動化し、Review & Replanで品質保証。

**設計思想**:
- **1 job function = multiple workflows**: 各職能は複数のワークフローを担当
- **Phase並列実行**: 独立した職能を並列起動し、処理時間を短縮
- **Review & Replan**: QA Leadが各Phaseの成果物をレビューし、必要に応じてリプラン（Max 3 Retries）

---

## Orchestration Overview

```
Main Orchestrator
  ├── Phase 1: Team作成
  │   └── TeamCreate("verify-first-debugging-team")
  │
  ├── Phase 2: 5職能順次起動（blocking）
  │   ├── Bug Analyst: Phase 1-2（REPRODUCE→LOCATE）
  │   │   → /tmp/verify-first-bugs/{BUG_ID}/phase1_reproduce.md
  │   │   → /tmp/verify-first-bugs/{BUG_ID}/phase2_locate.md
  │   │
  │   ├── Verification Specialist: Phase 3（VERIFY）
  │   │   → /tmp/verify-first-bugs/{BUG_ID}/phase3_verify.md
  │   │
  │   ├── Root Cause Investigator: Phase 4-5（PREREQUISITES→ROOT CAUSE）
  │   │   → /tmp/verify-first-bugs/{BUG_ID}/phase4_prerequisites.md
  │   │   → /tmp/verify-first-bugs/{BUG_ID}/phase5_root_cause.md
  │   │
  │   ├── Fix Engineer: Phase 6（FIX）
  │   │   → /tmp/verify-first-bugs/{BUG_ID}/phase6_fix.md
  │   │
  │   └── QA Lead: Review & Replan（Max 3 Retries）
  │       → /tmp/verify-first-bugs/{BUG_ID}/review_report.json
  │
  ├── Phase 3: 結果統合 & バグ修正サマリー
  │   └── /tmp/verify-first-bugs/{BUG_ID}/ のファイル一覧を表示
  │
  ├── Phase 4: Review & Replan（Max 3 Retries）
  │   └── QA Leadが各Phaseの成果物をレビューし、必要に応じてリプラン
  │
  └── Phase 5: Team cleanup
      └── TeamDelete("verify-first-debugging-team")
```

**職能間のデータ共有**: `/tmp/verify-first-bugs/{BUG_ID}/` 配下のMarkdownファイル + SendMessage

---

## Phase 1: Team作成

### Step 1: Teamディレクトリ準備

```bash
BUG_ID=$(date +%s)
mkdir -p /tmp/verify-first-bugs/${BUG_ID}
```

### Step 2: Team作成

```javascript
TeamCreate({
  team_name: "verify-first-debugging-team",
  description: "バグ修正を確実・深く・早く・本格的に実行する5職能Agent Teams",
  agent_type: "verify-first-debugging-lead"
})
```

---

## Phase 2: 5職能順次起動（blocking）

### Step 1: Bug Analyst起動

**重要**: Phase 1-2を順次実行（REPRODUCE→LOCATE）

```javascript
Task({
  subagent_type: "bug-analyst",
  team_name: "verify-first-debugging-team",
  name: "bug-analyst",
  description: "Phase 1-2: バグの再現と影響範囲特定",
  prompt: `
# Bug Analyst Workflow

あなたは verify-first-debugging-team の Bug Analyst です。

## 入力
- バグ説明: {user_bug_description}
- 環境: {environment_info}
- BUG_ID: {BUG_ID}

## 実行手順

### Phase 1: REPRODUCE（再現）
1. ToolSearch で verify-first-debugging をロード
2. Skill tool で verify-first-debugging Phase 1を実行
3. 期待動作と再現手順を確立
4. 成果物を /tmp/verify-first-bugs/{BUG_ID}/phase1_reproduce.md に保存

### Phase 2: LOCATE（影響範囲特定）
1. エラーメッセージ解析（スタックトレース、エラーコード）
2. git blame で最近の変更を特定
3. 影響範囲分類（UI/API/DB/インフラ等）
4. バグタイプ候補を抽出（データ検証/認証/API統合/環境依存/並行処理/設定/依存関係/型不整合）
5. 成果物を /tmp/verify-first-bugs/{BUG_ID}/phase2_locate.md に保存

### 成果物JSON
6. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "bug-analyst",
  "workflows_executed": ["REPRODUCE", "LOCATE"],
  "deliverables": {
    "phase1_reproduce": "/tmp/verify-first-bugs/{BUG_ID}/phase1_reproduce.md",
    "phase2_locate": "/tmp/verify-first-bugs/{BUG_ID}/phase2_locate.md"
  },
  "bug_types_detected": ["data_validation", "api_integration"],
  "status": "success",
  "errors": []
}
\`\`\`

7. Write tool で /tmp/verify-first-bugs/{BUG_ID}/bug_analyst_result.json に保存
8. SendMessage で team lead に完了報告

## Success Criteria

- [ ] Phase 1: 期待動作と再現手順が明確
- [ ] Phase 2: エラーメッセージ解析完了
- [ ] Phase 2: git blame で最近の変更特定
- [ ] Phase 2: 影響範囲分類完了
- [ ] Phase 2: バグタイプ候補を3-5個抽出

## Error Handling

- 再現失敗: 再現手順を詳細化し、環境依存の可能性を記録
- git blame失敗: 手動でコミット履歴を確認
- エラーメッセージ不明瞭: ログファイルを全文読み込み

## Notes

- Phase 1-2を順次実行（Phase 1完了後にPhase 2を開始）
- バグタイプ候補は最大5個まで（多すぎると検証時間が増加）
- 成果物は全てMarkdown形式で保存
`,
  run_in_background: false
})
```

### Step 2: Verification Specialist起動

**重要**: Bug Analyst完了後に起動（phase2_locate.md を参照）

```javascript
Task({
  subagent_type: "verification-specialist",
  team_name: "verify-first-debugging-team",
  name: "verification-specialist",
  description: "Phase 3: バグタイプに応じた検証を並列実行",
  prompt: `
# Verification Specialist Workflow

あなたは verify-first-debugging-team の Verification Specialist です。

## 入力
- Bug Analyst の成果物: /tmp/verify-first-bugs/{BUG_ID}/phase2_locate.md
- BUG_ID: {BUG_ID}

## 実行手順

### Phase 3: VERIFY（構造的不整合検出）
1. Read tool で /tmp/verify-first-bugs/{BUG_ID}/phase2_locate.md を読み込み
2. バグタイプ候補を特定（3-5個）
3. 各バグタイプに応じた検証SubAgentを選択（最大5-6個）:
   - V1: データ検証不足
   - V2: 認証・認可の欠陥
   - V3: API統合の不整合
   - V4: 環境依存の問題
   - V5: 並行処理の競合
   - V6: 設定ミスマッチ
   - V7: 依存関係の衝突
   - V8: 型不整合
4. 選択した検証SubAgentを並列起動（Task tool使用）
5. 各SubAgentの検証結果を統合
6. 成果物を /tmp/verify-first-bugs/{BUG_ID}/phase3_verify.md に保存

### 成果物JSON
7. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "verification-specialist",
  "workflows_executed": ["VERIFY"],
  "deliverables": {
    "phase3_verify": "/tmp/verify-first-bugs/{BUG_ID}/phase3_verify.md"
  },
  "verification_subagents_executed": ["V1", "V3", "V8"],
  "detected_issues": [
    {"type": "data_validation", "severity": "high", "description": "..."},
    {"type": "api_integration", "severity": "medium", "description": "..."}
  ],
  "status": "success",
  "errors": []
}
\`\`\`

8. Write tool で /tmp/verify-first-bugs/{BUG_ID}/verification_specialist_result.json に保存
9. SendMessage で team lead に完了報告

## Success Criteria

- [ ] Phase 3: バグタイプ候補を3-5個特定
- [ ] Phase 3: 検証SubAgentを3-5個選択
- [ ] Phase 3: 検証SubAgentを並列実行（2段階で最大5-6個）
- [ ] Phase 3: 構造的不整合を検出
- [ ] Phase 3: 検証結果をMarkdown形式で保存

## Error Handling

- バグタイプ特定失敗: 全8種類の検証を実行（時間増加）
- 検証SubAgent起動失敗: 手動で検証を実行
- 検証結果統合失敗: 各SubAgentの結果を個別に保存

## Notes

- 検証SubAgentは2段階で最大5-6個に留める（並列実行時間を最適化）
- 各検証SubAgentは独立して実行可能（並列処理）
- 検証結果は全てMarkdown形式で保存
`,
  run_in_background: false
})
```

### Step 3: Root Cause Investigator起動

**重要**: Verification Specialist完了後に起動（phase3_verify.md を参照）、opus model使用

```javascript
Task({
  subagent_type: "root-cause-investigator",
  team_name: "verify-first-debugging-team",
  name: "root-cause-investigator",
  description: "Phase 4-5: 前提条件確認と根本原因特定",
  prompt: `
# Root Cause Investigator Workflow

あなたは verify-first-debugging-team の Root Cause Investigator です。

## 入力
- Verification Specialist の成果物: /tmp/verify-first-bugs/{BUG_ID}/phase3_verify.md
- BUG_ID: {BUG_ID}

## 実行手順

### Phase 4: PREREQUISITES（前提条件確認）
1. Read tool で /tmp/verify-first-bugs/{BUG_ID}/phase3_verify.md を読み込み
2. ツール存在確認（必要なCLI/ライブラリ）
3. 環境変数確認（.env/環境変数設定）
4. ファイル存在確認（設定ファイル/依存ファイル）
5. 権限確認（ファイルアクセス権/API権限）
6. 成果物を /tmp/verify-first-bugs/{BUG_ID}/phase4_prerequisites.md に保存

### Phase 5: ROOT CAUSE（根本原因特定、opus model使用）
1. Read tool で /tmp/verify-first-bugs/{BUG_ID}/phase4_prerequisites.md を読み込み
2. Why×3で根本原因を特定:
   - Why 1: 症状の直接原因
   - Why 2: 原因の原因
   - Why 3: 構造的問題
3. 根本原因を明確化（1つに絞る）
4. 成果物を /tmp/verify-first-bugs/{BUG_ID}/phase5_root_cause.md に保存

### 成果物JSON
5. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "root-cause-investigator",
  "workflows_executed": ["PREREQUISITES", "ROOT_CAUSE"],
  "deliverables": {
    "phase4_prerequisites": "/tmp/verify-first-bugs/{BUG_ID}/phase4_prerequisites.md",
    "phase5_root_cause": "/tmp/verify-first-bugs/{BUG_ID}/phase5_root_cause.md"
  },
  "root_cause": "...",
  "status": "success",
  "errors": []
}
\`\`\`

6. Write tool で /tmp/verify-first-bugs/{BUG_ID}/root_cause_investigator_result.json に保存
7. SendMessage で team lead に完了報告

## Success Criteria

- [ ] Phase 4: ツール存在確認完了
- [ ] Phase 4: 環境変数確認完了
- [ ] Phase 4: ファイル存在確認完了
- [ ] Phase 4: 権限確認完了
- [ ] Phase 5: Why×3で根本原因特定
- [ ] Phase 5: 根本原因を1つに絞る

## Error Handling

- ツール不在: ツール名とインストール方法を記録
- 環境変数不在: 環境変数名と設定方法を記録
- ファイル不在: ファイルパスと作成方法を記録
- Why×3失敗: 手動で根本原因を特定し、記録

## Notes

- Phase 4-5を順次実行（Phase 4完了後にPhase 5を開始）
- opus modelを使用して深い推論を実行（Why×3）
- 根本原因は必ず1つに絞る（複数ある場合は最も影響が大きいものを選択）
`,
  run_in_background: false
})
```

### Step 4: Fix Engineer起動

**重要**: Root Cause Investigator完了後に起動（phase5_root_cause.md を参照）

```javascript
Task({
  subagent_type: "fix-engineer",
  team_name: "verify-first-debugging-team",
  name: "fix-engineer",
  description: "Phase 6: 根本修正 + テスト追加",
  prompt: `
# Fix Engineer Workflow

あなたは verify-first-debugging-team の Fix Engineer です。

## 入力
- Root Cause Investigator の成果物: /tmp/verify-first-bugs/{BUG_ID}/phase5_root_cause.md
- BUG_ID: {BUG_ID}

## 実行手順

### Phase 6: FIX（根本修正 + テスト追加）
1. Read tool で /tmp/verify-first-bugs/{BUG_ID}/phase5_root_cause.md を読み込み
2. 根本原因から修正実施（症状ではなく根本を修正）
3. 副作用確認（修正による他の影響を確認）
4. テスト追加（同じバグを防ぐテストを追加）
5. 同じパターンの問題確認（他の箇所にも同じ問題がないか確認）
6. 成果物を /tmp/verify-first-bugs/{BUG_ID}/phase6_fix.md に保存

### 成果物JSON
7. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "fix-engineer",
  "workflows_executed": ["FIX"],
  "deliverables": {
    "phase6_fix": "/tmp/verify-first-bugs/{BUG_ID}/phase6_fix.md"
  },
  "files_modified": ["src/api/user.ts", "tests/api/user.test.ts"],
  "tests_added": ["tests/api/user.test.ts"],
  "status": "success",
  "errors": []
}
\`\`\`

8. Write tool で /tmp/verify-first-bugs/{BUG_ID}/fix_engineer_result.json に保存
9. SendMessage で team lead に完了報告

## Success Criteria

- [ ] Phase 6: 根本原因から修正実施
- [ ] Phase 6: 副作用確認完了
- [ ] Phase 6: テスト追加完了
- [ ] Phase 6: 同じパターンの問題確認完了
- [ ] Phase 6: 修正内容をMarkdown形式で保存

## Error Handling

- 修正失敗: 修正内容を記録し、手動修正を促す
- テスト追加失敗: テスト追加方針を記録し、手動追加を促す
- 副作用検出: 副作用内容を記録し、追加修正を提案

## Notes

- 必ず根本原因から修正する（症状対処は禁止）
- テストは必ず追加する（同じバグを防ぐため）
- 同じパターンの問題が他にもないか確認（横展開）
`,
  run_in_background: false
})
```

### Step 5: QA Lead起動

**重要**: Fix Engineer完了後に起動（全Phaseの成果物を参照）

```javascript
Task({
  subagent_type: "qa-lead",
  team_name: "verify-first-debugging-team",
  name: "qa-lead",
  description: "Review & Replan: 成果物レビュー + リプラン実行",
  prompt: `
# QA Lead Workflow

あなたは verify-first-debugging-team の QA Lead です。

## 入力
- 全Phaseの成果物: /tmp/verify-first-bugs/{BUG_ID}/
- BUG_ID: {BUG_ID}

## 実行手順

### Review & Replan（Max 3 Retries）
1. Read tool で全Phaseの成果物を読み込み:
   - phase1_reproduce.md
   - phase2_locate.md
   - phase3_verify.md
   - phase4_prerequisites.md
   - phase5_root_cause.md
   - phase6_fix.md

2. 4ステップレビュー:
   - Step 1: ファイル存在確認（6ファイル全て存在するか）
   - Step 2: Success Criteriaチェック（各Phaseの成果物が基準を満たすか）
   - Step 3: 差分分析（期待値 vs 実際）
   - Step 4: リスク判定（Critical / Minor / None）

3. リスク判定:
   - **Critical**: リプラン必須 → Subagent再実行（SendMessage経由）
   - **Minor**: 警告+進行許可 → 次Phaseへ
   - **None**: 承認 → 完了

4. リプラン実行フロー（Criticalの場合）:
   - Issue Detection: 不合格項目の特定
   - Feedback Generation: 修正方針の明示化
   - Subagent Re-execution: SendMessage で該当Subagentに再実行指示
   - Re-Review: 同じ基準で再評価
   - Max Retries: 3回（超過時は人間へエスカレーション）

5. 成果物を /tmp/verify-first-bugs/{BUG_ID}/review_report.json に保存

### 成果物JSON
6. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "qa-lead",
  "workflows_executed": ["REVIEW_AND_REPLAN"],
  "deliverables": {
    "review_report": "/tmp/verify-first-bugs/{BUG_ID}/review_report.json"
  },
  "review_result": {
    "phase1": {"status": "approved", "issues": []},
    "phase2": {"status": "approved", "issues": []},
    "phase3": {"status": "critical", "issues": ["バグタイプ特定不足"]},
    "phase4": {"status": "approved", "issues": []},
    "phase5": {"status": "approved", "issues": []},
    "phase6": {"status": "approved", "issues": []}
  },
  "replan_count": 1,
  "status": "success",
  "errors": []
}
\`\`\`

7. Write tool で /tmp/verify-first-bugs/{BUG_ID}/qa_lead_result.json に保存
8. SendMessage で team lead に完了報告

## Success Criteria

- [ ] 4ステップレビュー完了
- [ ] リスク判定完了
- [ ] リプラン実行完了（Criticalの場合）
- [ ] レビュー結果をJSON形式で保存

## Error Handling

- リプラン3回失敗: 人間へエスカレーション（team leadに報告）
- ファイル不在: Critical判定 → 該当Subagentに再実行指示
- Success Criteria不合格: Critical/Minor判定 → リプラン実行

## Notes

- Max 3 Retriesを厳守（無限ループ防止）
- リプラン時は必ずFeedbackを明示化（Subagentが改善できるように）
- Critical判定時は該当Subagentに具体的な修正指示を送る
`,
  run_in_background: false
})
```

---

## Phase 3: 結果統合 & バグ修正サマリー

### Step 1: 各teammateの成果物を読み込み

```javascript
const bugAnalystResult = Read({ file_path: "/tmp/verify-first-bugs/{BUG_ID}/bug_analyst_result.json" })
const verificationSpecialistResult = Read({ file_path: "/tmp/verify-first-bugs/{BUG_ID}/verification_specialist_result.json" })
const rootCauseInvestigatorResult = Read({ file_path: "/tmp/verify-first-bugs/{BUG_ID}/root_cause_investigator_result.json" })
const fixEngineerResult = Read({ file_path: "/tmp/verify-first-bugs/{BUG_ID}/fix_engineer_result.json" })
const qaLeadResult = Read({ file_path: "/tmp/verify-first-bugs/{BUG_ID}/qa_lead_result.json" })
```

### Step 2: バグ修正サマリー生成

```markdown
# Bug Fix Summary
BUG_ID: {BUG_ID}
生成日時: {timestamp}

## Bug Analyst（Phase 1-2: REPRODUCE→LOCATE）
- 実行ワークフロー: {workflows_executed}
- 成果物:
  - {phase1_reproduce}
  - {phase2_locate}
- バグタイプ候補: {bug_types_detected}
- ステータス: {status}
- エラー: {errors}

## Verification Specialist（Phase 3: VERIFY）
- 実行ワークフロー: {workflows_executed}
- 成果物: {phase3_verify}
- 検証SubAgent: {verification_subagents_executed}
- 検出された問題: {detected_issues}
- ステータス: {status}
- エラー: {errors}

## Root Cause Investigator（Phase 4-5: PREREQUISITES→ROOT CAUSE）
- 実行ワークフロー: {workflows_executed}
- 成果物:
  - {phase4_prerequisites}
  - {phase5_root_cause}
- 根本原因: {root_cause}
- ステータス: {status}
- エラー: {errors}

## Fix Engineer（Phase 6: FIX）
- 実行ワークフロー: {workflows_executed}
- 成果物: {phase6_fix}
- 修正ファイル: {files_modified}
- 追加テスト: {tests_added}
- ステータス: {status}
- エラー: {errors}

## QA Lead（Review & Replan）
- 実行ワークフロー: {workflows_executed}
- 成果物: {review_report}
- レビュー結果: {review_result}
- リプラン回数: {replan_count}
- ステータス: {status}
- エラー: {errors}

## Next Actions
1. 修正内容を確認: {phase6_fix}
2. テストを実行: {tests_added}
3. コミット: git commit（git-commit-rules Skillを使用）
```

### Step 3: サマリー保存

```javascript
Write({
  file_path: "/tmp/verify-first-bugs/{BUG_ID}/bug_fix_summary.md",
  content: summary
})
```

---

## Phase 4: Review & Replan（Max 3 Retries）

QA Lead が Phase 2で実行（各Subagent完了後に自動実行）

---

## Phase 5: Team cleanup

### Step 1: Team削除

```javascript
TeamDelete()
```

---

## Usage Examples

### 例1: バグ修正（デフォルト）

```bash
/verify-first-debugging-team --bug "ユーザー登録時にエラーが発生する"
```

→ 5職能が順次起動し、バグ修正を実行

### 例2: 既存の成果物からレビューのみ

```bash
/verify-first-debugging-team --bug-id 1234567890 --review-only
```

→ QA Lead のみ起動し、既存の成果物をレビュー

---

## File Paths

- **Output Directory**: `/tmp/verify-first-bugs/{BUG_ID}/`
- **Subagents**: `.claude/skills/verify-first-debugging-team/agents/`

---

## Performance

- **処理時間**: 約15-20分（5職能順次実行）
- **並列実行**: Phase 3の検証SubAgentのみ並列実行（最大5-6個）
- **opus model使用**: Phase 5のみ（Why×3の深い推論）

---

## Notes

- **VERIFY-FIRST Framework準拠**: 6 Phase（REPRODUCE→LOCATE→VERIFY→PREREQUISITES→ROOT CAUSE→FIX）を自動化
- **Review & Replan**: QA Leadが各Phaseの成果物をレビューし、必要に応じてリプラン（Max 3 Retries）
- **JSON形式データフロー**: 各teammateは成果物をJSONで保存し、team leadが統合
- **opus model使用**: Phase 5のみ（Why×3の深い推論）

---

最終更新: 2026-02-10

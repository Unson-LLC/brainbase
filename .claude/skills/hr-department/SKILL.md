---
name: hr-department
description: Agent Teams作成プロセスを自動化するメタレベルOrchestrator。Skills Analyst・Organization Designer・Code Generatorの3職能が既存Skillsを分析し、新規Agent Teamsの設計と実装を自動生成。
tools: []
skills: [raci-format, task-format, principles, knowledge-frontmatter, git-commit-rules]
teammates:
  - name: skills-analyst
    agentType: skills-analyst
    description: 既存Skillsを収集・分類し、新規チームに適したSkillsを抽出。CLAUDE.mdから81個のSkills一覧を読み込み、ドメイン別フィルタリング、Orchestrator型/ガイド型の分類を実行。
    tools: [Read, Write]
  - name: organization-designer
    agentType: organization-designer
    description: 職能（Job Functions）を設計し、各職能の役割・責任・ワークフロー割り当てを定義。RACI構造を明確化し、Skills装備を最終決定。
    tools: [Read, Write, Skill]
  - name: code-generator
    agentType: code-generator
    description: SKILL.md + agents/*.md を自動生成。frontmatter定義、Phase構成生成、agent定義ファイル生成、JSON出力フォーマット定義を実行し、最終ファイルを出力。
    tools: [Read, Write]
---

# hr-department Orchestrator

**概要**: Agent Teams作成プロセスを自動化する **メタレベル** Orchestrator。marketing-ops、ops-dailyの作成プロセスを形式知化し、新規Agent Teams（sales-ops、dev-ops等）を自動生成。

**設計思想**: Agent Teamsを作るAgent Teams = メタレベル自動化

---

## Orchestration Overview

```
Main Orchestrator
  ├── Phase 1: Team作成
  │   └── TeamCreate("hr-department")
  │
  ├── Phase 2: 3職能並列起動（blocking）
  │   ├── Skills Analyst: 既存Skillsを収集・分類（5 workflows）
  │   ├── Organization Designer: 職能設計・ワークフロー割り当て（5 workflows）
  │   └── Code Generator: SKILL.md + agents/*.md 生成（5 workflows）
  │
  ├── Phase 3: 結果統合 & コード生成サマリー
  │   └── /tmp/hr-department/generated_code/ のファイル一覧を表示
  │
  ├── Phase 4: Review & Replan（Max 3 Retries）
  │   └── エラー発生時、該当teammateを再起動
  │
  └── Phase 5: Team cleanup
      └── TeamDelete("hr-department")
```

**職能間のデータ共有**: `/tmp/hr-department/` 配下のJSONファイル + SendMessage

---

## Phase 1: Team作成

### Step 1: Teamディレクトリ準備

```bash
mkdir -p /tmp/hr-department
```

### Step 2: Team作成

```javascript
TeamCreate({
  team_name: "hr-department",
  description: "Agent Teams作成チーム: Skills Analyst / Organization Designer / Code Generator",
  agent_type: "hr-department-lead"
})
```

---

## Phase 2: 3職能並列起動（blocking）

### 入力パラメータ

| パラメータ | 説明 | デフォルト | 例 |
|----------|------|-----------|---|
| `--domain` | ドメイン名（marketing, sales, dev等） | 必須 | `--domain marketing` |
| `--team-name` | 生成するチーム名 | `{domain}-ops` | `--team-name marketing-ops` |

### Step 1: 3職能を並列起動

**重要**: `run_in_background: false` でblocking実行（全teammateの完了を待つ）

#### Skills Analyst起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "hr-department",
  name: "skills-analyst",
  description: "Skills分析",
  prompt: `
# Skills Analyst Workflow

あなたは HR Department チームの Skills Analyst です。

## 役割
既存Skillsを収集・分類し、新規チームに適したSkillsを抽出。

## 入力
- ドメイン: ${domain}
- CLAUDE.md（セクション5）: 81個のSkills一覧

## Workflows（5つ）

### W1: Skills索引読み込み
- Read: /Users/ksato/workspace/shared/.worktrees/session-1770385136710-brainbase/CLAUDE.md（セクション5）
- 81個のSkills一覧を抽出

### W2: ドメイン別フィルタリング
- 指定ドメイン（${domain}）に関連するSkillsを抽出
- 例: marketing → sns-smart, note-smart, marketing-strategy-planner等

### W3: Orchestrator型/ガイド型の分類
- Orchestrator型: 複数Phaseを持つ（sns-smart, note-smart等）
- ガイド型: 単一参照・知識提供（sns-copy-patterns, marketing-compass等）

### W4: Phase数・依存Skills抽出
- Orchestrator型SkillsのPhase数・依存Skillsを抽出
- 例: sns-smart → 6 Phase、依存Skills: sns-copy-patterns, customer-centric-marketing-n1等

### W5: 推奨Skills一覧生成
- ドメイン別に3-4職能 × 4-5 Skillsの推奨構成を生成
- JSON形式で保存: /tmp/hr-department/skills_analysis.json

## 実行手順

1. Read tool で CLAUDE.md を読み込み
2. セクション5のSkills一覧を抽出
3. ドメイン別フィルタリング
4. Orchestrator型/ガイド型の分類
5. 推奨Skills一覧を生成
6. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "skills-analyst",
  "domain": "${domain}",
  "filtered_skills": ["sns-smart", "note-smart", ...],
  "orchestrator_skills": [
    {
      "skill": "sns-smart",
      "phases": 6,
      "dependencies": ["sns-copy-patterns", "customer-centric-marketing-n1"]
    }
  ],
  "guide_skills": ["sns-copy-patterns", "marketing-compass", ...],
  "recommended_skills": {
    "content-creator": ["sns-smart", "note-smart", "sns-copy-patterns"],
    "campaign-manager": ["marketing-strategy-planner", "milestone-management"],
    "analytics-specialist": ["x-analytics-source", "x-bookmarks-source", "kpi-calculation"]
  },
  "status": "success",
  "errors": []
}
\`\`\`

7. Write tool で /tmp/hr-department/skills_analysis.json に保存
8. SendMessage で team lead に完了報告

## Success Criteria

- [ ] 81個全てのSkillsが読み込まれている
- [ ] ドメイン関連Skillsが10個以上抽出されている
- [ ] Orchestrator型/ガイド型に分類されている
- [ ] 推奨Skills一覧が3-4職能分生成されている

## Notes

- CLAUDE.md（セクション5）は81個のSkills一覧を含む
- ドメイン未指定時はエラー
- 推奨構成はmarketing-opsの実装を参考に生成
`
})
```

#### Organization Designer起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "hr-department",
  name: "organization-designer",
  description: "職能設計",
  prompt: `
# Organization Designer Workflow

あなたは HR Department チームの Organization Designer です。

## 役割
職能（Job Functions）を設計し、各職能の役割・責任・ワークフロー割り当てを定義。

## 入力
- ドメイン: ${domain}
- Skills分析結果: /tmp/hr-department/skills_analysis.json

## Workflows（5つ）

### W1: ドメイン分析
- ドメイン特性を分析し、標準職能テンプレートを定義
- 例: marketing → Content Creator, Campaign Manager, Analytics Specialist

### W2: 職能候補生成
- 3-4職能を生成
- 各職能のname, agentType, descriptionを定義

### W3: 各職能の役割定義
- 各職能の詳細（tools, skills）を定義
- RACI構造を明確化

### W4: ワークフロー割り当て
- 各職能に4-5ワークフローを割り当て
- ワークフロー詳細（説明、入力、出力）を定義

### W5: Skills装備設計
- 各職能に装備するSkillsを最終決定
- Skills分析結果から最適なSkillsを選定

## 実行手順

1. Read tool で /tmp/hr-department/skills_analysis.json を読み込み
2. ドメイン分析（標準職能テンプレート定義）
3. 職能候補生成（3-4職能）
4. 各職能の役割定義（tools, skills）
5. ワークフロー割り当て（4-5 workflows/職能）
6. Skills装備設計（最適なSkills選定）
7. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "organization-designer",
  "team_name": "${teamName}",
  "job_functions": [
    {
      "name": "content-creator",
      "agentType": "content-creator",
      "description": "SNS投稿（X/note）の企画・作成・公開",
      "tools": ["ToolSearch", "Skill", "Bash", "Read", "Write"],
      "skills": ["sns-smart", "note-smart", "sns-copy-patterns"],
      "workflows": [
        {
          "id": "W1",
          "name": "X投稿作成",
          "description": "sns-smart Skillを実行し、X投稿ドラフトを生成",
          "inputs": ["トピック"],
          "outputs": ["_codex/sns/drafts/{topic}_draft.md"]
        },
        ...
      ]
    },
    ...
  ],
  "raci_structure": {
    "content-creator": {
      "responsible": ["X投稿作成", "note記事作成"],
      "accountable": ["コンテンツ品質"],
      "consulted": ["campaign-manager"],
      "informed": ["analytics-specialist"]
    },
    ...
  },
  "status": "success",
  "errors": []
}
\`\`\`

8. Write tool で /tmp/hr-department/organization_design.json に保存
9. SendMessage で team lead に完了報告

## Success Criteria

- [ ] 3-4職能が設計されている
- [ ] 各職能に4-5ワークフローが割り当てられている
- [ ] RACI構造が明確化されている
- [ ] Skills装備が最終決定されている

## Notes

- marketing-opsの実装を参考に職能を設計
- RACI構造は raci-format Skillを参照
- 各職能はgeneral-purpose agentとして起動可能
`
})
```

#### Code Generator起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "hr-department",
  name: "code-generator",
  description: "コード生成",
  prompt: `
# Code Generator Workflow

あなたは HR Department チームの Code Generator です。

## 役割
SKILL.md + agents/*.md を自動生成。

## 入力
- 組織設計結果: /tmp/hr-department/organization_design.json
- テンプレート参照: /Users/ksato/workspace/shared/.worktrees/session-1770385136710-brainbase/.claude/skills/marketing-ops/
- テンプレート参照: /Users/ksato/workspace/shared/.worktrees/session-1770385136710-brainbase/.claude/skills/ops-daily/

## Workflows（5つ）

### W1: SKILL.md frontmatter生成
- teammates定義を含むfrontmatterを生成
- name, description, tools, skills, teammatesを定義

### W2: Phase構成生成
- 標準5 Phase（Team作成 → Teammates起動 → 結果統合 → Review & Replan → Cleanup）を生成
- Phase別のTask呼び出しパターンを定義

### W3: agents/*.md テンプレート生成
- 各職能のagent定義ファイルを生成
- frontmatter + Workflows（5つ）+ Success Criteria + Error Handlingを定義

### W4: JSON出力フォーマット定義
- 各職能のJSON出力形式を定義
- teammate, workflows_executed, results, errorsを含む

### W5: 最終ファイル出力
- 生成したファイルを /tmp/hr-department/generated_code/ に保存
- .claude/skills/${teamName}/ 配下ファイル一式を出力

## 実行手順

1. Read tool で /tmp/hr-department/organization_design.json を読み込み
2. Read tool で marketing-ops/SKILL.md、ops-daily/SKILL.md を参照
3. SKILL.md frontmatter生成
4. Phase構成生成（Phase 1-5）
5. agents/*.md テンプレート生成（各職能）
6. JSON出力フォーマット定義
7. 結果を保存:

\`\`\`
/tmp/hr-department/generated_code/
├── SKILL.md
└── agents/
    ├── content_creator.md
    ├── campaign_manager.md
    └── analytics_specialist.md
\`\`\`

8. 成果物を JSON 形式で報告:

\`\`\`json
{
  "teammate": "code-generator",
  "generated_files": [
    "/tmp/hr-department/generated_code/SKILL.md",
    "/tmp/hr-department/generated_code/agents/content_creator.md",
    "/tmp/hr-department/generated_code/agents/campaign_manager.md",
    "/tmp/hr-department/generated_code/agents/analytics_specialist.md"
  ],
  "status": "success",
  "errors": []
}
\`\`\`

9. Write tool で /tmp/hr-department/code_generation.json に保存
10. SendMessage で team lead に完了報告

## Success Criteria

- [ ] SKILL.md が生成されている
- [ ] frontmatter/Phase構成が正しい
- [ ] agents/*.md が3-4職能分生成されている
- [ ] 出力ファイルが /tmp/hr-department/generated_code/ に保存されている

## Notes

- marketing-ops/ops-dailyの実装を参考にテンプレート生成
- frontmatter は knowledge-frontmatter Skillを参照
- コミット形式は git-commit-rules Skillを参照
`
})
```

---

## Phase 3: 結果統合 & コード生成サマリー

### Step 1: 各teammateの成果物を読み込み

```javascript
const skillsAnalysisResult = Read({ file_path: "/tmp/hr-department/skills_analysis.json" })
const organizationDesignResult = Read({ file_path: "/tmp/hr-department/organization_design.json" })
const codeGenerationResult = Read({ file_path: "/tmp/hr-department/code_generation.json" })
```

### Step 2: コード生成サマリー生成

```markdown
# HR Department Summary
生成日時: {timestamp}
ドメイン: {domain}
チーム名: {teamName}

## Skills Analyst
- 実行ワークフロー: {workflows_executed}
- ドメイン関連Skills: {filtered_skills.length}個
- Orchestrator型: {orchestrator_skills.length}個
- ガイド型: {guide_skills.length}個
- 推奨構成: {recommended_skills}
- ステータス: {status}
- エラー: {errors}

## Organization Designer
- 実行ワークフロー: {workflows_executed}
- 職能数: {job_functions.length}個
- 各職能: {job_functions.map(jf => jf.name).join(", ")}
- RACI構造: {raci_structure}
- ステータス: {status}
- エラー: {errors}

## Code Generator
- 実行ワークフロー: {workflows_executed}
- 生成ファイル:
  {generated_files.map(f => `  - ${f}`).join("\n")}
- ステータス: {status}
- エラー: {errors}

## 生成されたAgent Teams
- チーム名: {teamName}
- 職能: {job_functions.map(jf => jf.name).join(", ")}
- ファイル: /tmp/hr-department/generated_code/

## Next Actions
1. 生成ファイルを確認: ls -la /tmp/hr-department/generated_code/
2. SKILL.md を確認: cat /tmp/hr-department/generated_code/SKILL.md
3. agents/*.md を確認: cat /tmp/hr-department/generated_code/agents/*.md
4. .claude/skills/${teamName}/ にコピー
```

### Step 3: サマリー保存

```javascript
Write({
  file_path: "/tmp/hr-department/hr_summary.md",
  content: summary
})
```

### Step 4: Agent Teams検証（agent-teams-validator）

生成されたAgent Teams Skillの整合性を検証。5つのチェック（teammates定義・agents/ディレクトリ・name一致・suffix無し・ファイル名パターン）を実行。

```bash
/Users/ksato/workspace/.claude/skills/agent-teams-validator/validate.sh /tmp/hr-department/generated_code/
```

**検証項目**:
- ✅ Check 1: teammates: exists in SKILL.md
- ✅ Check 2: agents/ directory exists
- ✅ Check 3: All agent names match teammates list
- ✅ Check 4: No invalid suffixes (-teammate, -agent)
- ✅ Check 5: Filename patterns are correct

**検証結果をサマリーに追記**:

```javascript
const validationResult = Bash({
  command: "/Users/ksato/workspace/.claude/skills/agent-teams-validator/validate.sh /tmp/hr-department/generated_code/",
  description: "Agent Teams構造検証"
})

// 検証結果をサマリーに追記
const validationSummary = `

## Agent Teams Validation

${validationResult}

`

const updatedSummary = summary + validationSummary

Write({
  file_path: "/tmp/hr-department/hr_summary.md",
  content: updatedSummary
})
```

**検証失敗時のアクション**:
- 検証エラーがあればPhase 4でCode Generatorを再起動
- `-teammate` suffixなどの既知のバグを自動修正するオプションも検討

---

## Phase 4: Review & Replan（Max 3 Retries）

### Step 1: エラーチェック

```javascript
const hasErrors =
  skillsAnalysisResult.errors?.length > 0 ||
  organizationDesignResult.errors?.length > 0 ||
  codeGenerationResult.errors?.length > 0
```

### Step 2: エラー時の再起動

```javascript
if (hasErrors && retryCount < 3) {
  // エラーが発生したteammateのみ再起動
  if (skillsAnalysisResult.errors?.length > 0) {
    // skills-analyst 再起動
    Task({ ... })
  }

  if (organizationDesignResult.errors?.length > 0) {
    // organization-designer 再起動
    Task({ ... })
  }

  if (codeGenerationResult.errors?.length > 0) {
    // code-generator 再起動
    Task({ ... })
  }

  retryCount++
} else if (retryCount >= 3) {
  // 3回失敗したら手動介入を促す
  console.log("⚠️ 3回のリトライに失敗しました。手動確認が必要です。")
}
```

---

## Phase 5: Team cleanup

### Step 1: Team削除

```javascript
TeamDelete()
```

---

## Usage Examples

### 例1: マーケティング系Agent Teams生成

```bash
/hr-department --domain marketing
```

→ Skills Analyst が marketing関連Skillsを抽出
→ Organization Designer が Content Creator / Campaign Manager / Analytics Specialist を設計
→ Code Generator が SKILL.md + agents/*.md を生成

### 例2: セールス系Agent Teams生成

```bash
/hr-department --domain sales
```

→ Skills Analyst が sales関連Skillsを抽出
→ Organization Designer が Sales Rep / SDR / Account Manager を設計
→ Code Generator が SKILL.md + agents/*.md を生成

### 例3: 開発系Agent Teams生成

```bash
/hr-department --domain dev
```

→ Skills Analyst が dev関連Skillsを抽出
→ Organization Designer が Backend Dev / Frontend Dev / DevOps を設計
→ Code Generator が SKILL.md + agents/*.md を生成

---

## Notes

- **メタレベル自動化**: Agent Teams作成プロセス自体をAgent Teamsで自動化
- **ops-daily/marketing-opsパターン踏襲**: 3職能 × 複数ワークフロー、JSON形式データフロー
- **既存Skills索引活用**: CLAUDE.md（セクション5）の81個のSkills一覧を入力データとして使用
- **テンプレート生成**: ops-daily/marketing-opsの実装をテンプレートとして参照
- **Review & Replan**: エラー時は最大3回まで再実行
- **統合レポート**: コード生成サマリーで全職能の成果物を一覧化

---

最終更新: 2026-02-07

# Agent Teams サンプル

**目的**: UNSONメンバーがAgent Teams（チーム構造）を構築する際のリファレンス

**重要**: これはサンプル構造です。実際のTeamsは `~/.claude/teams/` に動的に作成されます。

---

## Agent Teams とは？

複数のAIエージェントがチームとして協働し、複雑なタスクを並行処理する仕組み。

### メリット
- **並行作業**: 複数のエージェントが同時に異なるタスクを実行
- **専門性**: 各エージェントが特定のSkillsに特化
- **効率化**: タスクを分割して高速に完了

---

## サンプルTeam構成（5つ）

### 1. marketing（マーケティングチーム）- X投稿作成

**目的**: X投稿を作成するための5人チーム

| メンバー | 役割 | 使用Skills |
|---------|------|-----------|
| team-lead | チームリーダー | - |
| customer-research | ターゲット顧客分析 | customer-centric-marketing-n1 |
| tactics-planning | マーケティング戦術選定 | b2b-marketing-60-tactics-playbook, marketing-failure-patterns |
| brand-management | ブランド一貫性チェック | branding-strategy-guide |
| content-creation | 投稿ドラフト作成 | sns-smart, sns-copy-patterns |

---

### 2. ops（運用チーム）- brainbase開発運用

**目的**: brainbase開発運用のための5人チーム

| メンバー | 役割 | 使用Skills |
|---------|------|-----------|
| team-lead | チームリーダー | - |
| architect | アーキテクチャパターン検証 | architecture-patterns, story-arch-spec-code |
| tdd-engineer | TDDワークフロー実装 | tdd-workflow, test-strategy |
| security-engineer | セキュリティ検証 | security-patterns |
| refactoring-specialist | リファクタリング実施 | refactoring-workflow, verify-first-debugging |

---

### 3. dev（開発チーム）- 新機能実装

**目的**: Story-driven approachで新機能を実装する5人チーム

| メンバー | 役割 | 使用Skills |
|---------|------|-----------|
| team-lead | チームリーダー | - |
| story-architect | Story & Architecture定義 | story-arch-spec-code |
| spec-writer | 詳細仕様作成 | story-arch-spec-code, architecture-patterns |
| tdd-engineer | TDD実装 | tdd-workflow, test-strategy |
| code-reviewer | コードレビュー | architecture-patterns, security-patterns, refactoring-workflow |

---

### 4. sales（セールスチーム）- 提案・価格戦略

**目的**: 提案書作成・価格戦略・顧客対応のための5人チーム

| メンバー | 役割 | 使用Skills |
|---------|------|-----------|
| team-lead | チームリーダー | - |
| proposal-writer | 提案書作成 | sales-playbook, kernel-prompt-engineering |
| pricing-strategist | 価格戦略・契約条件 | jutaku-1oku-shikumi, sales-playbook |
| customer-relations | 顧客対応・関係構築 | 1on1-mastery, sales-playbook |
| case-study-writer | 導入事例作成 | sales-playbook, note-article-writing |

---

### 5. hr（人事チーム）- 採用・評価・育成

**目的**: 採用・評価・育成のための6人チーム

| メンバー | 役割 | 使用Skills |
|---------|------|-----------|
| team-lead | チームリーダー | - |
| recruiter | 採用面接・候補者評価 | hiring-retention |
| performance-reviewer | 評価・フィードバック | performance-review, manager-leverage |
| 1on1-coach | 1on1ファシリテーション | 1on1-mastery, task-relevant-maturity |
| retention-specialist | 退職防止・退職面談 | hiring-retention, principles |
| training-coordinator | 研修・スキル開発 | learning-extraction, knowledge-frontmatter |

---

## Agent Teamsの作り方（Claude Codeで）

### Step 1: Teamを作成

```
@TeamCreate {
  "team_name": "marketing-department",
  "description": "X投稿を作成するチーム",
  "agent_type": "marketing-lead"
}
```

### Step 2: メンバーを追加

```
@Task {
  "subagent_type": "general-purpose",
  "team_name": "marketing-department",
  "name": "customer-research",
  "prompt": "You are the Customer Research teammate...",
  "description": "ターゲット顧客分析"
}
```

### Step 3: タスクを作成・割り当て

```
@TaskCreate {
  "subject": "X投稿作成",
  "description": "Agent Teamsについての投稿を作成"
}

@TaskUpdate {
  "taskId": "1",
  "owner": "customer-research"
}
```

### Step 4: メンバーが作業

各エージェントが自分のタスクを完了後、team-leadに報告。

### Step 5: Teamを終了

```
@SendMessage {
  "type": "shutdown_request",
  "recipient": "customer-research",
  "content": "全タスク完了、ありがとう！"
}

@TeamDelete
```

---

## カスタマイズ方法

### 1. メンバー構成を変更

`config.sample.json` の `members` 配列を編集：
- メンバー追加・削除
- 役割（role）の変更
- 使用Skillsの変更

### 2. Model選択

| Model | 用途 | コスト |
|-------|------|--------|
| **Opus 4.6** | 複雑な分析・戦略立案 | 高 |
| **Sonnet 4.5** | バランス型（リーダー向け） | 中 |
| **Haiku 4.5** | 単純作業・高速処理 | 低 |

### 3. Skillsの組み合わせ

各メンバーに複数のSkillsを割り当て可能：

```json
{
  "name": "strategist",
  "skills": [
    "marketing-strategy-planner",
    "marketing-compass",
    "marketing-framework-115-methods"
  ]
}
```

---

## よくあるTeam構成パターン

### 1. コンテンツ作成チーム
- リサーチャー（顧客分析）
- ライター（ドラフト作成）
- エディター（校正・レビュー）
- デザイナー（画像プロンプト生成）

### 2. プロジェクト立ち上げチーム
- 戦略担当（project-onboarding）
- RACI担当（raci-format）
- タスク担当（task-format）
- マイルストーン担当（milestone-management）

### 3. 開発チーム
- アーキテクト（architecture-patterns）
- TDD担当（tdd-workflow）
- セキュリティ担当（security-patterns）
- リファクタリング担当（refactoring-workflow）

---

## トラブルシューティング

### Q1: メンバーが応答しない

**A**: `@SendMessage` でメッセージを送信してみる。idle状態は正常。

### Q2: Teamが削除できない

**A**: 全メンバーにshutdown_requestを送信してから `@TeamDelete`。

### Q3: タスクの進捗が見えない

**A**: `@TaskList` でタスク一覧確認。各メンバーの `owner` を確認。

---

## 参考リンク

- **TeamCreate**: CLAUDE.mdのTeamCreate toolセクション
- **Skills一覧**: README.md の89個のSkillsリスト
- **Agent構成**: `.claude/agents/` のSubagent定義

---

最終更新: 2026-02-09

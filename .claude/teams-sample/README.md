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

## サンプルTeam構成

### marketing-department（X投稿作成チーム）

**目的**: X投稿を作成するための5人チーム

| メンバー | 役割 | 使用Skills | Model |
|---------|------|-----------|-------|
| **team-lead** | チームリーダー（最終判断） | - | Sonnet 4.5 |
| **customer-research** | ターゲット顧客分析 | customer-centric-marketing-n1 | Opus 4.6 |
| **tactics-planning** | マーケティング戦術選定 | b2b-marketing-60-tactics-playbook, marketing-failure-patterns | Opus 4.6 |
| **brand-management** | ブランド一貫性チェック | branding-strategy-guide | Opus 4.6 |
| **content-creation** | 投稿ドラフト作成 | sns-smart, sns-copy-patterns | Opus 4.6 |

**ワークフロー**:
1. customer-research → ターゲット分析（N=1、9セグ）
2. tactics-planning → 戦術選定（60施策、失敗パターン診断）
3. brand-management → ブランドガイドライン定義
4. content-creation → 上記3つの成果を統合してドラフト作成
5. team-lead → 最終レビュー・承認

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

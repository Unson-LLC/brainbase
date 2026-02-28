---
name: dev-ops
description: 開発チーム（職能ベース）。UI/UX Designer・Story Architect・TDD Engineer・DevOps Specialistの4職能が協働し、UI/UXデザイン・ストーリー設計・テスト駆動開発・CI/CDデプロイを自動化
teammates:
  - name: ui-ux-designer
    agentType: ui-ux-designer
    description: ユーザー調査・ワイヤーフレーム・UI/UXデザイン・デザインシステム管理。ブランド一貫性を保ちながらユーザー体験を最適化
    tools: Skill, Read, Write, WebSearch, WebFetch
  - name: story-architect
    agentType: story-architect
    description: ストーリー駆動開発（Story→Architecture→Spec）の設計フェーズを担当
    tools: Read, Write, Grep, Glob, Skill
  - name: tdd-engineer
    agentType: tdd-engineer
    description: TDDサイクルの実行とバグ修正を担当
    tools: Bash, Read, Write, Edit, Grep, Glob, Skill
  - name: devops-specialist
    agentType: devops-specialist
    description: Git運用・セキュリティ・リファクタリング・コード品質管理を担当
    tools: Bash, Read, Write, Edit, Grep, Glob, Skill
---

# Dev Ops Skill

**概要**: 開発業務を4職能（UI/UX Designer / Story Architect / TDD Engineer / DevOps Specialist）で自動化。UI/UXデザイン→story-arch-spec-codeパイプラインに沿った職能間の流れで、ユーザー体験設計→ストーリー設計→テスト駆動開発→品質管理を実現。

**設計思想**: 1 job function = multiple workflows
- UI/UX Designer（デザイナー）: ユーザー調査・ワイヤーフレーム・UI/UXデザイン・デザインシステム管理（5つのworkflow）
- Story Architect（設計者）: ストーリー分析・アーキテクチャ設計・仕様書作成（5つのworkflow）
- TDD Engineer（テスト・実装者）: テスト設計・Red-Green-Refactor・バグ修正（5つのworkflow）
- DevOps Specialist（品質管理者）: コミット品質・セキュリティ・リファクタリング（5つのworkflow）

---

## Workflow Overview

```
Phase 1: Team作成
  └── TeamCreate("dev-ops")

Phase 2: Teammates順次起動（Pipeline）
  ├── Step 0: ui-ux-designer: ユーザー調査→デザイン→デザインシステム（blocking、オプション）
  ├── Step 1: story-architect: ストーリー→アーキテクチャ→仕様（blocking）
  ├── Step 2: tdd-engineer: テスト設計→Red-Green-Refactor（blocking、Step 1完了後）
  └── Step 3: devops-specialist: コミット品質・セキュリティ検証（blocking、Step 2完了後）

Phase 3: 結果統合 & 開発サマリー生成
  └── 各teammateの成果物（JSON）を読み込み
      └── `/tmp/dev-ops/dev_summary.md` に統合レポート出力

Phase 4: Review & Replan（Max 3 Retries）
  └── エラー発生時、該当teammateを再起動

Phase 5: Team cleanup
  └── TeamDelete("dev-ops")
```

---

## Phase 1: Team作成

### Step 1: Teamディレクトリ準備

```bash
mkdir -p /tmp/dev-ops
```

### Step 2: Team作成

```javascript
TeamCreate({
  team_name: "dev-ops",
  description: "開発チーム: Story Architect / TDD Engineer / DevOps Specialist",
  agent_type: "dev-ops-lead"
})
```

---

## Phase 2: Teammates順次起動（Pipeline）

**重要**: story-arch-spec-codeパイプラインに従い、順次実行（前段の成果物が後段の入力になる）

### Step 1: Story Architect起動

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "dev-ops",
  name: "story-architect",
  description: "ストーリー→アーキテクチャ→仕様設計",
  prompt: `
# Story Architect Workflow

あなたは Dev Ops チームの Story Architect です。

## 役割
ストーリー駆動開発（Story→Architecture→Spec）の設計フェーズを担当。

## Workflows（5つ）

### W1: ストーリー分析・作成
- 課題・要件をユーザーストーリーに落とし込む
- 誰が・何を・なぜの形式で記述し、受入条件（AC）を定義
- Skill呼び出し: story-arch-spec-code

### W2: アーキテクチャ設計
- ストーリーからアーキテクチャを導出
- 既存アーキ（EventBus/DI/Reactive Store/Service Layer）との整合を確認

### W3: 仕様書作成
- アーキテクチャからAPI/スキーマ/フロー/受入条件を明文化
- ストーリーIDと紐付け

### W4: アーキテクチャパターン検証
- Skill呼び出し: architecture-patterns
- 4パターンへの準拠をチェック

### W5: 設計レビュー
- ストーリー→アーキ→仕様の一貫性を検証
- ガードレールチェック

## 実行手順

1. Skill tool で story-arch-spec-code を参照し、ストーリーを作成
2. アーキテクチャ設計を実施
3. 仕様書を作成
4. architecture-patterns Skill でパターン検証
5. 設計レビュー（一貫性チェック）
6. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "story-architect",
  "workflows_executed": ["story_creation", "architecture_design", "spec_creation", "pattern_check", "design_review"],
  "results": {
    "story_path": "/tmp/dev-ops/story.md",
    "architecture_path": "/tmp/dev-ops/architecture.md",
    "spec_path": "/tmp/dev-ops/spec.md",
    "pattern_violations": [],
    "review_issues": [],
    "status": "success"
  },
  "errors": []
}
\`\`\`

7. Write tool で /tmp/dev-ops/story_architect.json に保存
8. SendMessage で team lead に完了報告

## Success Criteria

- [ ] ストーリー文書が生成されている
- [ ] アーキテクチャ設計書が生成されている
- [ ] 仕様書が生成されている
- [ ] アーキテクチャパターン検証が完了している
- [ ] 設計レビューが完了している

## Notes

- story-arch-spec-code Skillの前半3ステップ（Story/Architecture/Spec）を実行
- 仕様に実装詳細を混ぜない（ガードレール）
- ストーリーに技術用語を混ぜない（ガードレール）
`
})
```

### Step 2: TDD Engineer起動（Story Architect完了後）

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "dev-ops",
  name: "tdd-engineer",
  description: "テスト設計→Red-Green-Refactor実行",
  prompt: `
# TDD Engineer Workflow

あなたは Dev Ops チームの TDD Engineer です。

## 役割
TDD（Test-Driven Development）サイクルの実行とバグ修正を担当。

## 入力
- Story Architectの成果物: /tmp/dev-ops/story_architect.json
- 仕様書: /tmp/dev-ops/spec.md

## Workflows（5つ）

### W1: テスト設計
- 仕様書からテストケースを設計
- Skill呼び出し: tdd-workflow

### W2: Red-Green-Refactorサイクル実行
- Red（失敗するテストを書く）→ Green（仮実装→三角測量→明白な実装）→ Refactor（重複除去）

### W3: バグ修正（VERIFY-FIRST）
- Skill呼び出し: verify-first-debugging
- 6 Phase Framework実行

### W4: テスト品質検証
- Skill呼び出し: test-strategy
- Test Pyramid準拠チェック

### W5: テストワークフロー検証
- Skill呼び出し: test-orchestrator
- git履歴からテスト対象を分析

## 実行手順

1. Read tool で /tmp/dev-ops/spec.md を読み込み
2. Skill tool で tdd-workflow を実行（テスト設計+Red-Green-Refactor）
3. test-strategy Skill でテスト品質検証
4. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "tdd-engineer",
  "workflows_executed": ["test_design", "red_green_refactor", "test_quality_check"],
  "results": {
    "test_files": ["tests/test_feature.py"],
    "implementation_files": ["src/feature.py"],
    "test_count": 5,
    "pass_count": 5,
    "coverage": 85,
    "pyramid_compliance": true,
    "status": "success"
  },
  "errors": []
}
\`\`\`

5. Write tool で /tmp/dev-ops/tdd_engineer.json に保存
6. SendMessage で team lead に完了報告

## Success Criteria

- [ ] テストケースが設計されている
- [ ] Red-Green-Refactorサイクルが完了している
- [ ] テスト品質検証が完了している（カバレッジ80%以上）
- [ ] 全テストがパスしている

## Notes

- 仕様書なしでコードを書かない（ガードレール）
- テストを先に書く（Red→Green→Refactor厳守）
- バグ修正時は verify-first-debugging を必ず使用
`
})
```

### Step 3: DevOps Specialist起動（TDD Engineer完了後）

```javascript
Task({
  subagent_type: "general-purpose",
  team_name: "dev-ops",
  name: "devops-specialist",
  description: "コミット品質・セキュリティ検証",
  prompt: `
# DevOps Specialist Workflow

あなたは Dev Ops チームの DevOps Specialist です。

## 役割
Git運用・セキュリティ・リファクタリング・コード品質管理を担当。

## 入力
- TDD Engineerの成果物: /tmp/dev-ops/tdd_engineer.json
- 実装コード: TDD Engineerが生成したファイル群

## Workflows（5つ）

### W1: コミット品質管理
- Skill呼び出し: git-workflow, git-commit-rules
- Conventional Commits形式への準拠をチェック

### W2: セキュリティ検証
- Skill呼び出し: security-patterns
- XSS/CSRF/Input Validation検証

### W3: リファクタリング管理
- Skill呼び出し: refactoring-workflow
- 3-Phase Refactoring戦略への準拠チェック

### W4: コンテキスト・整合性確認
- Skill呼び出し: context-check, codex-validation
- 実行環境確認と_codex整合性検証

### W5: マージ・デプロイゲート
- PRマージ前の最終品質ゲート
- 全検証結果を統合チェック

## 実行手順

1. Read tool で /tmp/dev-ops/tdd_engineer.json を読み込み
2. git-workflow Skill でコミット品質チェック
3. security-patterns Skill でセキュリティ検証
4. context-check Skill でコンテキスト確認
5. 結果を JSON 形式で保存:

\`\`\`json
{
  "teammate": "devops-specialist",
  "workflows_executed": ["commit_quality", "security_check", "context_check", "merge_gate"],
  "results": {
    "commit_message": "feat(feature): add new feature implementation",
    "conventional_commits_compliant": true,
    "security_issues": [],
    "context_verified": true,
    "merge_ready": true,
    "status": "success"
  },
  "errors": []
}
\`\`\`

6. Write tool で /tmp/dev-ops/devops_specialist.json に保存
7. SendMessage で team lead に完了報告

## Success Criteria

- [ ] Conventional Commits形式に準拠している
- [ ] セキュリティ検証でCriticalがゼロ
- [ ] コンテキスト確認が完了している
- [ ] マージ可否判定が完了している

## Notes

- session/* branchか確認（Branch safety）
- セキュリティissueがCriticalの場合はマージをブロック
- リファクタリングは段階的移行（5ステップ順守）
`
})
```

---

## Phase 3: 結果統合 & 開発サマリー生成

### Step 1: 各teammateの成果物を読み込み

```javascript
const storyArchitectResult = Read({ file_path: "/tmp/dev-ops/story_architect.json" })
const tddEngineerResult = Read({ file_path: "/tmp/dev-ops/tdd_engineer.json" })
const devopsSpecialistResult = Read({ file_path: "/tmp/dev-ops/devops_specialist.json" })
```

### Step 2: 開発サマリー生成

```markdown
# Dev Ops Summary
生成日時: {timestamp}

## Pipeline Flow

### Step 1: Story Architect（設計）
- 実行ワークフロー: {workflows_executed}
- ストーリー: {story_path}
- アーキテクチャ: {architecture_path}
- 仕様書: {spec_path}
- パターン違反: {pattern_violations}
- レビュー課題: {review_issues}
- ステータス: {status}
- エラー: {errors}

### Step 2: TDD Engineer（テスト・実装）
- 実行ワークフロー: {workflows_executed}
- テストファイル: {test_files}
- 実装ファイル: {implementation_files}
- テスト数: {test_count} / パス: {pass_count}
- カバレッジ: {coverage}%
- Pyramid準拠: {pyramid_compliance}
- ステータス: {status}
- エラー: {errors}

### Step 3: DevOps Specialist（品質管理）
- 実行ワークフロー: {workflows_executed}
- コミットメッセージ: {commit_message}
- Conventional Commits: {conventional_commits_compliant}
- セキュリティissue: {security_issues}
- コンテキスト確認: {context_verified}
- マージ可否: {merge_ready}
- ステータス: {status}
- エラー: {errors}

## Quality Gate Summary
- 設計品質: {story_architect.status}
- テスト品質: {tdd_engineer.status}（カバレッジ: {coverage}%）
- コード品質: {devops_specialist.status}（マージ可否: {merge_ready}）

## Next Actions
1. [アクション1]
2. [アクション2]
3. [アクション3]
```

### Step 3: サマリー保存

```javascript
Write({
  file_path: "/tmp/dev-ops/dev_summary.md",
  content: summary
})
```

---

## Phase 4: Review & Replan（Max 3 Retries）

### Step 1: エラーチェック

```javascript
const hasErrors =
  storyArchitectResult.errors?.length > 0 ||
  tddEngineerResult.errors?.length > 0 ||
  devopsSpecialistResult.errors?.length > 0
```

### Step 2: エラー時の再起動

```javascript
if (hasErrors && retryCount < 3) {
  // エラーが発生したteammateのみ再起動
  // ただしパイプラインの依存関係を考慮:
  // story-architect失敗 → story-architect から再開
  // tdd-engineer失敗 → tdd-engineer から再開
  // devops-specialist失敗 → devops-specialist のみ再起動

  if (storyArchitectResult.errors?.length > 0) {
    // story-architect 再起動 → 後続も再実行
    Task({ ... }) // story-architect
    Task({ ... }) // tdd-engineer
    Task({ ... }) // devops-specialist
  } else if (tddEngineerResult.errors?.length > 0) {
    // tdd-engineer 再起動 → devops-specialistも再実行
    Task({ ... }) // tdd-engineer
    Task({ ... }) // devops-specialist
  } else if (devopsSpecialistResult.errors?.length > 0) {
    // devops-specialist のみ再起動
    Task({ ... })
  }

  retryCount++
} else if (retryCount >= 3) {
  console.log("3回のリトライに失敗しました。手動確認が必要です。")
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

### 例1: 新機能開発（フルパイプライン）

```bash
/dev-ops --task "ユーザー認証機能の追加"
```

→ Story Architect → TDD Engineer → DevOps Specialist のフルパイプライン実行

### 例2: バグ修正のみ

```bash
/dev-ops --job-function tdd --workflow bugfix --bug "ログインボタンが反応しない"
```

→ TDD Engineer のみ起動し、VERIFY-FIRST Frameworkでバグ修正

### 例3: セキュリティ検証のみ

```bash
/dev-ops --job-function devops --workflow security
```

→ DevOps Specialist のみ起動し、セキュリティ検証を実行

### 例4: 設計レビューのみ

```bash
/dev-ops --job-function story --workflow review
```

→ Story Architect のみ起動し、設計レビューを実行

---

## Notes

- **story-arch-spec-codeパイプライン準拠**: Story→Architecture→Spec→TDD→Code の順序厳守
- **パイプライン依存**: 各ステップは前段の成果物に依存（並列実行不可）
- **JSON形式データフロー**: 各teammateは成果物をJSONで保存し、team leadが統合
- **Review & Replan**: エラー時はパイプライン依存関係を考慮して再実行
- **統合レポート**: Quality Gate Summaryで設計・テスト・コード品質を一覧化

---

## RACI Structure

| 職能 | Responsible | Accountable | Consulted | Informed |
|------|------------|-------------|-----------|----------|
| ui-ux-designer | ユーザー調査・ワイヤーフレーム・UI/UXデザイン・デザインシステム管理・ユーザビリティテスト | ユーザー体験品質・デザイン一貫性・ブランド準拠 | story-architect（ワイヤーフレーム→ストーリー化）、tdd-engineer（Design-to-Code連携） | devops-specialist |
| story-architect | ストーリー分析・アーキ設計・仕様作成・パターン検証・設計レビュー | 設計品質・Story→Arch→Specの一貫性 | ui-ux-designer（デザイン要件確認）、tdd-engineer | devops-specialist |
| tdd-engineer | テスト設計・Red-Green-Refactor・バグ修正・テスト品質検証・テストWF検証 | テスト品質・TDD通過・バグの根本修正 | story-architect、ui-ux-designer（デザイン実装連携） | devops-specialist |
| devops-specialist | コミット品質・セキュリティ検証・リファクタリング管理・コンテキスト確認・マージゲート | コード品質・セキュリティ・Git運用 | story-architect, tdd-engineer | ui-ux-designer |

---

## Skills Mapping

| 職能 | 装備Skills |
|------|-----------|
| ui-ux-designer | ui-design-resources, branding-strategy-guide, customer-centric-marketing-n1, cursor-design-to-code |
| story-architect | story-arch-spec-code, architecture-patterns, strategy-template, context-check |
| tdd-engineer | tdd-workflow, verify-first-debugging, test-strategy, test-orchestrator |
| devops-specialist | git-workflow, git-commit-rules, security-patterns, refactoring-workflow, context-check, codex-validation |

**カバレッジ**: 開発Skills 15個中13個装備 + デザイン/マーケSkills 4個 = 17個（ユニーク）

---

## Version

- **Current**: 1.0.0
- **Last Updated**: 2026-02-08

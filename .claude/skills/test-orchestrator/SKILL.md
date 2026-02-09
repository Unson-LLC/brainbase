---
name: test-orchestrator
description: 検証用Orchestrator Skill。git履歴分析→タスク提案の2 Phase workflow。{skill}/agents/構造の検証に使用。
---

# Test Orchestrator

**目的**: `{skill}/agents/`構造でのSubagents動作検証

このSkillは、Orchestrator SkillとSubagentsの統合パターンを検証するためのテストケースです。

## Workflow Overview

```
Phase 1: Git履歴分析
└── agents/phase1_analyze.md
    └── git-commit-rules Skillを使用
    └── 過去30日のコミット履歴を分析
    └── 変更傾向・パターンを抽出

Phase 2: タスク提案生成
└── agents/phase2_tasklist.md
    └── task-format Skillを使用
    └── Phase 1の分析結果から改善タスクを提案
    └── タスクフォーマットで出力
```

## 検証項目

1. **`{skill}/agents/`構造での動作**
   - `.claude/skills/test-orchestrator/agents/`に配置されたSubagentsが認識されるか
   - Orchestratorから各Subagentを呼び出せるか

2. **コンテキスト分離**
   - Phase 1の分析結果がPhase 2に正しく引き継がれるか
   - 各Subagentのコンテキストが独立しているか

3. **Skills使用**
   - Subagentsが指定したSkills（git-commit-rules, task-format）を使用できるか
   - Skills制限（8個以内）が正しく機能するか

## 使い方

```
ユーザー: test-orchestratorを実行してください

期待される動作:
1. Phase 1 Subagentが起動
   - git logから過去30日のコミットを取得
   - git-commit-rules Skillで分析
   - 変更傾向を抽出

2. Phase 2 Subagentが起動
   - Phase 1の結果を受け取る
   - task-format Skillで改善タスクを生成
   - YAML front matter形式で出力

3. Orchestratorが結果を統合
   - 両Phaseの成果物を確認
   - 最終レポートを生成
```

## Orchestration Logic

### Phase 1: Git履歴分析

**Subagent**: `agents/phase1_analyze.md`

**Input**: なし（brainbase-uiリポジトリのgit履歴）

**Process**:
1. `git log --since="30 days ago" --oneline`で最近のコミット取得
2. git-commit-rules Skillの思考フレームワークで分析
   - コミットメッセージの品質
   - type分布（feat/fix/docs/refactor等）
   - コミット粒度の傾向
3. 改善ポイントを特定

**Output**: 分析結果テキスト（markdown）

### Phase 2: タスク提案生成

**Subagent**: `agents/phase2_tasklist.md`

**Input**: Phase 1の分析結果

**Process**:
1. 分析結果から改善が必要な領域を特定
2. task-format Skillの思考フレームワークで構造化
   - タスクタイトル（動詞開始）
   - 担当者設定
   - 優先度判定
3. YAML front matter形式でタスクリスト生成

**Output**: タスクリスト（YAML front matter）

### 統合・検証

**Orchestratorの責任**:
- 各Phaseの完了を確認
- Phase間のデータ受け渡しを管理
- 最終成果物の品質チェック
- エラー時のフォールバック

## Success Criteria

- [ ] Phase 1 Subagentが正常起動（Task tool経由）
- [ ] git-commit-rules Skillが使用される
- [ ] Phase 1の分析結果が生成される
- [ ] Phase 2 Subagentが正常起動
- [ ] task-format Skillが使用される
- [ ] Phase 2のタスクリストが生成される
- [ ] 両Phaseのコンテキストが分離されている
- [ ] Orchestratorが最終レポートを生成

## Expected Output

```markdown
# Test Orchestrator 実行結果

## Phase 1: Git履歴分析

### コミット統計（過去30日）
- 総コミット数: XX件
- type分布:
  - feat: XX件
  - fix: XX件
  - docs: XX件

### 分析結果
- コミットメッセージの品質: 良好/要改善
- コミット粒度: 適切/大きすぎる/小さすぎる
- 改善ポイント:
  - [具体的な改善提案]

## Phase 2: タスク提案

```yaml
---
task: コミットメッセージ品質向上
assignee: Dev
priority: 中
status: 未着手
---
[タスク詳細]
```

## 検証ログ
- Phase 1起動: ✅
- git-commit-rules使用: ✅
- Phase 2起動: ✅
- task-format使用: ✅
- コンテキスト分離: ✅
```

## Troubleshooting

### Subagentsが起動しない

**原因候補**:
- **セッション再起動が未実施**（最も可能性が高い）
- Subagent定義ファイルのフォーマットエラー
- Task toolが有効化されていない
- ファイル名とname不一致

**対処**:
1. Subagentファイルの存在確認
   ```bash
   ls -la .claude/skills/test-orchestrator/agents/
   # → phase1_analyze.md, phase2_tasklist.md が存在するか
   ```
2. Claude Codeセッションを再起動
3. `allowed_tools`に`Task`が含まれているか確認
4. Subagent mdファイルのYAML frontmatterを確認

### Skillsが使用されない

**原因候補**:
- Skills設定（settingSources）が未設定
- skills_mapping.jsonが見つからない
- Skill名の誤記

**対処**:
1. `setting_sources=["user", "project"]`が設定されているか確認
2. `/Users/ksato/workspace/_codex/common/meta/skills_mapping.json`が存在するか確認
3. Subagent内のSkill名が正確か確認（git-commit-rules, task-format）

## 次のステップ

検証成功時:
- 90-day-checklist Orchestrator Skillの実装
- より複雑な4 Phase workflowの設計
- 並列実行パターンの実験

## 重要な発見（2025-12-26）

**検証結果**: `{skill}/agents/`構造が完全に動作
- ✅ `{skill}/agents/`構造は動作する
- ✅ `.claude/agents/`へのコピーは不要
- ⚠️ セッション再起動が必須

詳細: `/Users/ksato/workspace/_codex/projects/brainbase/test_orchestrator_verification_final.md`

---

最終更新: 2025-12-25
M5.2 Phase 1検証実験

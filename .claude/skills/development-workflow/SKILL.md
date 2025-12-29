---
name: development-workflow
description: brainbaseの標準開発フロー（Explore → Plan → Branch → Edit → Test → Commit → Merge）を強制する思考フレームワーク。7フェーズでTDD、git-workflow、architecture-patternsを統合
setting_sources: ["user", "project"]
---

# brainbase Development Workflow

## Purpose

Subagentを活用した標準開発フローを定義し、開発効率と品質を向上させる。

**適用タイミング**:
- 新機能追加時
- バグ修正時
- リファクタリング時
- 調査・分析時

## Thinking Framework

### 1. Standard Flow: Explore → Plan → Branch → Edit → Test → Commit → Merge

brainbaseの開発は7つのPhaseで構成される:

```
Explore → Plan → Branch → Edit → Test → Commit → Merge
   ↓       ↓       ↓        ↓      ↓        ↓        ↓
  調査    設計  ブランチ  実装   検証   コミット  マージ
```

**思考パターン**:
- 新機能追加 → 「まずExploreで既存コードを理解したか?」
- 実装開始 → 「Planで設計を固めたか？」
- コード修正 → 「Skills準拠を確認しているか？」
- 実装完了 → 「Testでカバレッジ80%以上を達成したか？」
- コミット → 「既存機能が壊れていないか？」

**Why**:
- 設計ミスの早期発見（Explore/Planフェーズで）
- 品質の担保（Test/Commitフェーズで）
- 属人化の防止（標準フローの定義）

---

### 2. Phase 1: Explore（調査）

**目的**: 既存コードを理解し、影響範囲を特定する

**使用Agent**: Explore Agent

**thoroughness設定**:
- `quick`: 基本的な調査（1-2ファイル）
- `medium`: 中規模調査（3-5ファイル）
- `very thorough`: 大規模調査（6+ファイル、複雑な依存関係）

**装備Skills**:
- architecture-patterns
- refactoring-workflow

**実行例**:
```
User: "プロジェクト作成機能を理解したい"

Claude Code: [Explore Agent起動 - thoroughness: medium]
→ public/modules/domain/project/project-service.js 調査
→ public/modules/core/event-bus.js 調査
→ イベント: EVENTS.PROJECT_CREATED を特定
→ 依存関係: container.get('projectRepository') を特定

成果物: 既存コードの理解、影響範囲の特定
```

**判断基準**:
```javascript
// ✅ Good: Exploreで既存コードを理解してから実装
User: "プロジェクト削除機能を追加したい"
Claude Code:
  1. Explore Agent起動 → 既存のプロジェクト作成・更新機能を調査
  2. イベント定義、Service層の構造を理解
  3. Plan Modeで設計

// ❌ Bad: いきなり実装
User: "プロジェクト削除機能を追加したい"
Claude Code:
  1. コード追加 ❌ (既存パターンを無視)
```

---

### 3. Phase 2: Plan（設計）

**目的**: 実装方針を決定し、Skills準拠を確認する

**使用Mode**: Plan Mode (`EnterPlanMode`)

**AIの責任**: 以下の条件に該当する場合、**必ず**`EnterPlanMode`ツールを使ってユーザーにPlan Modeへの移行を提案する:
1. 新機能実装（重要な機能追加）
2. 複数の実装アプローチが存在する場合
3. コード修正（既存の振る舞いや構造に影響）
4. アーキテクチャ上の意思決定が必要
5. 複数ファイル（3ファイル以上）への変更
6. 要件が不明確で調査が必要
7. 複雑なバグ修正（2回以上失敗した場合は必須）

**装備Skills**:
- architecture-patterns
- test-strategy
- refactoring-workflow
- security-patterns

**Plan Fileに記載すべき内容**:
1. **実装方針**: どのように実装するか
2. **Skills準拠**: architecture-patterns等の準拠確認
3. **影響範囲**: 変更対象ファイル
4. **テスト計画**: Unit Test追加箇所
5. **リスク**: 破壊的変更、互換性問題

**実行例**:
```
User: "プロジェクト削除機能を追加したい"

Claude Code: [Plan Mode起動]

Plan File作成:
---
# プロジェクト削除機能追加

## 実装方針
1. ProjectService.deleteProject() メソッド追加
2. EVENTS.PROJECT_DELETED イベント定義
3. UI: 削除ボタン追加 + 確認ダイアログ

## Skills準拠
- architecture-patterns: ✅ Service Layer Pattern準拠
- architecture-patterns: ✅ Event-Driven Architecture準拠
- test-strategy: ✅ Unit Test追加（カバレッジ80%以上）
- security-patterns: ✅ CSRF Token付与

## 影響範囲
- public/modules/domain/project/project-service.js: deleteProject() 追加
- public/modules/core/event-bus.js: EVENTS.PROJECT_DELETED 追加
- public/index.html: 削除ボタンUI追加

## テスト計画
- tests/unit/project-service.test.js: deleteProject() のUnit Test

## リスク
- 削除時のカスケード削除（タスク、セッション等）を考慮
---

成果物: Plan File（設計書）
```

**判断基準**:
```javascript
// ✅ Good: Plan Modeで設計を固めてから実装
User: "プロジェクト削除機能を追加したい"
Claude Code:
  1. Explore Agent → 既存コード理解
  2. Plan Mode → 設計書作成
  3. User承認 → 実装開始

// ❌ Bad: 設計なしでいきなり実装
User: "プロジェクト削除機能を追加したい"
Claude Code:
  1. コード追加 ❌ (設計なし)
```

---

### 3.5. Phase 2.5: Branch（ブランチ作成）

**目的**: session-based branchを作成し、安全な開発環境を準備する

**使用Skill**: git-workflow

**タイミング**: Plan完了後、Edit開始前

**実行内容**:
1. `git status`で現在のブランチ確認
2. mainにいる場合: `git checkout -b session/YYYY-MM-DD-<type>-<name>`
3. 既にsession/*にいる場合: そのまま継続

**ブランチ命名規則**:
- `session/YYYY-MM-DD-feature-<name>` (新機能)
- `session/YYYY-MM-DD-fix-<name>` (バグ修正)
- `session/YYYY-MM-DD-refactor-<name>` (リファクタリング)
- `session/YYYY-MM-DD-hotfix-<name>` (緊急修正)

**Why session-based?**:
- `/commit`コマンドがsession/* branchを強制
- Git Flow慣習（feature/fix/refactor）との整合性
- 日付による開発セッション追跡

**実行例**:
```bash
User: "優先度フィルタを追加して"

Claude Code:
  1. Phase 1: Explore → 既存フィルタ機能調査
  2. Phase 2: Plan Mode → 設計完了
  3. Phase 2.5: Branch作成
     $ git status
     On branch main

     $ git checkout -b session/2025-12-29-feature-priority-filter
     Switched to a new branch 'session/2025-12-29-feature-priority-filter'

  4. Phase 3: Edit (TDD workflow開始)
```

**詳細**: git-workflow Skillを参照

---

### 4. Phase 3: Edit（実装）

**目的**: コードを修正し、Skills準拠を確認する

**使用Agent**: 通常のClaude Code

**使用Workflow**: TDD Workflow（tdd-workflow Skill）

**装備Skills**:
- **tdd-workflow** ← ★ 新規追加（TDD実践）
- architecture-patterns
- code-style
- security-patterns

**TDD実装フロー**:
1. **Red**: 失敗するテストを書く
2. **Green**: 仮実装 → 三角測量 → 明白な実装
3. **Refactor**: 重複除去、綺麗にする
4. **繰り返し**: TODOリスト完了まで

**実行時のチェック項目**:
1. **Test-First**: テストを先に書いたか？ ← ★ 新規追加
2. **Red-Green-Refactor**: サイクルに従っているか？ ← ★ 新規追加
3. **Event-Driven Architecture**: イベント発火しているか？
4. **Reactive Store Pattern**: Store経由でUI更新しているか？
5. **DI Container**: DI経由でサービス取得しているか？
6. **Service Layer Pattern**: ビジネスロジックがServiceに配置されているか？
7. **Naming Conventions**: kebab-case, PascalCase, camelCase準拠か？
8. **Import Order**: Node.js built-in → Third-party → Internal → Relativeの順か？
9. **XSS Prevention**: ユーザー入力をエスケープしているか？
10. **CSRF Protection**: POST/PUT/DELETEにCSRFトークン付与しているか？

**実行例（TDD準拠）**:
```javascript
// ✅ Good: TDD Workflow + Skills準拠の実装
// Step 1: Red（失敗するテストを書く）
describe('ProjectService', () => {
  it('deleteProject呼び出し時_DELETEDイベントが発火される', async () => {
    const emitted = [];
    eventBus.on(EVENTS.PROJECT_DELETED, (e) => emitted.push(e));

    await projectService.deleteProject('project-1');

    expect(emitted).toHaveLength(1);
  });
});
// npm run test → FAIL ❌ (deleteProject is not defined)

// Step 2: Green（仮実装）
// public/modules/domain/project/project-service.js
export class ProjectService {
  constructor({ repository, store, eventBus }) {  // DI Container
    this.repository = repository;
    this.store = store;
    this.eventBus = eventBus;
  }

  async deleteProject(id) {
    // 仮実装: イベント発火のみ
    this.eventBus.emit(EVENTS.PROJECT_DELETED, { projectId: id });
  }
}
// npm run test → PASS ✅

// Step 3: Green（三角測量で本実装）
it('deleteProject呼び出し時_Repositoryのdelete呼び出し', async () => {
  await projectService.deleteProject('project-1');
  expect(mockRepository.deleteProject).toHaveBeenCalledWith('project-1');
});
// npm run test → FAIL ❌ (repositoryが呼ばれていない)

async deleteProject(id) {
  // 本実装
  await this.repository.deleteProject(id);  // Repository経由

  // Store更新
  const projects = this.store.getState().projects.filter(p => p.id !== id);
  this.store.setState({ projects });

  // Event発火
  this.eventBus.emit(EVENTS.PROJECT_DELETED, { projectId: id });
}
// npm run test → PASS ✅

// Step 4: Refactor（重複除去）
// （他メソッドとの重複があれば除去）
// npm run test → PASS ✅ (still green)

// ❌ Bad: TDD非準拠の実装
async function deleteProject(id) {  // テストなしでいきなり実装 ❌
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  document.getElementById(id).remove();
}
```

**詳細**: tdd-workflow Skillを参照

---

### 5. Phase 4: Test（検証）

**目的**: テストを追加し、カバレッジ80%以上を達成する

**使用Agent**: 通常のClaude Code + Bash (vitest実行)

**装備Skills**:
- test-strategy

**実行時のチェック項目**:
1. **Test Pyramid**: Unit Test (80%) / API Test (15%) / E2E Test (5%)
2. **Test Naming**: `describe('対象', () => { it('条件_期待結果', () => {}) })`
3. **Coverage**: 80%以上
4. **既存テスト**: すべてパスしているか？

**実行例**:
```javascript
// tests/unit/project-service.test.js
import { describe, it, expect, vi } from 'vitest';
import { ProjectService } from '@/modules/domain/project/project-service.js';

describe('ProjectService', () => {
  it('deleteProject呼び出し時_Repositoryのdelete呼び出しとEvent発火', async () => {
    // Arrange
    const mockRepository = {
      deleteProject: vi.fn().mockResolvedValue(undefined)
    };
    const mockEventBus = {
      emit: vi.fn()
    };
    const service = new ProjectService({
      repository: mockRepository,
      store: appStore,
      eventBus: mockEventBus
    });

    // Act
    await service.deleteProject('project-1');

    // Assert
    expect(mockRepository.deleteProject).toHaveBeenCalledWith('project-1');
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      EVENTS.PROJECT_DELETED,
      { projectId: 'project-1' }
    );
  });
});
```

**Bash実行**:
```bash
# Unit Test実行
npm run test:unit

# カバレッジ確認
npm run test:coverage
# → Coverage: 82% ✅ (80%以上)

# 既存テスト実行
npm run test
# → All tests passed ✅
```

---

### 6. Phase 5: Commit（コミット）

**目的**: 実装をコミットし、decision-makingを記録する

**使用Skill**: git-workflow（戦略）、`/commit`（実装）

**カスタムコマンド**: `/commit`

**実行内容**:
1. **Branch safety check**: session/*以外は警告
2. **Decision-making capture**: 悩み→判断→結果のプロンプト
3. **Conventional Commits**: feat/fix/refactor等の形式
4. **Co-Authored-By**: Claude Sonnet 4.5

**実行時のチェック項目**:
1. **Test-First完了**: すべてのテストがパス
2. **TDD cycle完了**: Red-Green-Refactorサイクル完了
3. **Decision record**: 意思決定プロセスを明確に記録

**実行例**:
```bash
User: "/commit"

Claude Code: `/commit`コマンド実行

Branch check:
  - Current: session/2025-12-29-feature-priority-filter ✅

Decision-making prompt:
  - 悩み: 優先度フィルタの実装方法（FilterService vs TaskService統合）
  - 判断: TaskService.getFilteredTasks()に統合（既存パターン踏襲）
  - 結果: filterByPriority()ユーティリティ関数作成、100% coverage達成

Commit message generated:
feat: TaskServiceに優先度フィルタ統合

filterByPriority()ユーティリティを作成し、TaskService.getFilteredTasks()に統合。
UIドロップダウン追加、イベントハンドリング実装。

悩み: 優先度フィルタの実装方法（FilterService vs TaskService統合）
判断: TaskService.getFilteredTasks()に統合（既存パターン踏襲）
結果: filterByPriority()ユーティリティ関数作成、100% coverage達成

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>

成果物: Commit with decision record
```

**詳細**: git-workflow Skill、`/commit`コマンド実装を参照

---

### 7. Phase 6: Merge（マージ）

**目的**: Feature branchをmainにマージし、ブランチをクリーンアップする

**使用Skill**: git-workflow（戦略）、`/pr`、`/merge`（実装）

**カスタムコマンド**: `/pr` または `/merge`

**タイミング**: Feature完成、すべてのテスト完了後

**コマンド選択**:
- `/pr`: PRを作成してレビュー依頼（マージはGitHub UIで実施）
- `/merge`: PRモードでマージまで実施、または直接マージ（Safe/Fast Mode）

**実行内容**:
1. **Mode selection**: Safe Mode (worktree isolation) or Fast Mode
2. **Conflict resolution**: Interactive conflict handling
3. **--no-ff merge commit**: 明示的なmerge commit作成
4. **Branch cleanup**: マージ後のブランチ削除

**Why --no-ff (No Fast-Forward)?**:
- ✅ Feature branch履歴を保持
- ✅ git logでfeature境界が明確
- ✅ Feature全体のrevertが容易

**実行例**:
```bash
User: "Feature完成したので main にマージして"

Claude Code: `/merge`コマンド実行

Mode selection:
  - Safe Mode: worktree isolation (推奨)
  - Fast Mode: Direct merge (高速、symlink注意)

Merge execution:
  $ git checkout main
  $ git merge --no-ff session/2025-12-29-feature-priority-filter

Merge commit created:
Merge branch 'session/2025-12-29-feature-priority-filter'

- filterByPriority() ユーティリティ実装
- TaskService統合、テストカバレッジ100%
- UI ドロップダウン追加

Cleanup:
  Delete branch session/2025-12-29-feature-priority-filter? [y]
  Deleted branch session/2025-12-29-feature-priority-filter (was a1b2c3d).

成果物: --no-ff merge commit, feature branch deleted
```

**Best Practices**:
- ✅ Merge前にすべてのテストがパス
- ✅ 複数のcommitに分かれていてOK（TDD サイクルごと）
- ✅ Merge後は即座にブランチ削除（stale branch防止）

**詳細**: git-workflow Skill、`/merge`コマンド実装を参照

---

## Usage

このSkillは以下のタイミングで使用される:

1. **新機能追加時**: Explore → Plan → Branch → Edit → Test → Commit → Merge
2. **バグ修正時**: Explore → Branch → Edit → Test → Commit → Merge（Plan省略可）
3. **リファクタリング時**: Explore → Plan → Branch → Edit → Test → Commit → Merge（refactoring-workflow併用）
4. **調査・分析時**: Exploreのみ

**使用例**:

```
User: "プロジェクト削除機能を追加したい"

Claude Code: [development-workflow Skillを装備]

思考プロセス:
1. Phase 1: Explore Agent起動 → 既存コード理解
2. Phase 2: Plan Mode起動 → 設計書作成 → User承認
3. Phase 2.5: Branch作成 → session/2025-12-29-feature-project-delete
4. Phase 3: 実装 (TDD) → architecture-patterns, code-style, security-patterns準拠
5. Phase 4: Test追加 → test-strategy準拠、カバレッジ80%以上
6. Phase 5: /commit → Decision capture
7. Phase 6: /merge → --no-ff merge, branch cleanup

成果物:
- public/modules/domain/project/project-service.js (実装)
- tests/unit/project-service.test.js (テスト)
- Merge commit on main (feature完成)
```

---

## Success Criteria

- [ ] すべての開発が Explore → Plan → Branch → Edit → Test → Commit → Merge フローで実施されている
- [ ] Exploreフェーズで既存コードを理解してから実装している
- [ ] Planフェーズで設計を固めてから実装している
- [ ] Branchフェーズでsession/*ブランチを作成している
- [ ] Editフェーズですべての Skills（tdd-workflow, architecture-patterns, code-style, security-patterns）に準拠している
- [ ] Testフェーズでカバレッジ80%以上を達成している
- [ ] Commitフェーズで/commitによるdecision captureが記録されている
- [ ] Mergeフェーズで/mergeによる--no-ff mergeが実行されている
- [ ] Merge後のブランチクリーンアップが実施されている
- [ ] 属人化が0件（誰でも同じフローで開発できる）

---

## Enforcement

### Local
- このSkillを装備したClaude Codeが自動チェック
- 各Phaseで必要なSkillsを装備
- フロー違反を指摘

### CI
- GitHub Actions で `workflow-check.yml` が実行
- PR作成時にフロー準拠を確認

**チェック項目**:
```bash
# PRにPlan Fileが含まれているか？
if [ ! -f docs/plans/*.md ]; then
  echo "❌ Error: Plan file not found"
  exit 1
fi

# Test追加されているか？
git diff origin/main...HEAD --name-only | grep "tests/"
if [ $? -ne 0 ]; then
  echo "❌ Error: No tests added"
  exit 1
fi

# すべてのCI通過しているか？
gh pr checks --json state --jq '.[] | select(.state != "SUCCESS")'
if [ $? -eq 0 ]; then
  echo "❌ Error: CI failed"
  exit 1
fi
```

---

## Troubleshooting

### 問題1: Exploreを省略して実装を開始してしまう

**症状**: 既存コードのパターンを無視した実装

**原因**:
- 既存コードを理解せずに実装開始
- 時間がないためExploreを省略

**対処**:
```
// ❌ Bad: いきなり実装
User: "新機能追加したい"
Claude Code: [実装開始] ❌

// ✅ Good: Exploreから開始
User: "新機能追加したい"
Claude Code:
  1. Explore Agent起動
  2. 既存コード理解
  3. Plan Mode起動
  4. 実装
```

**Why Exploreが重要**:
- 既存パターンの把握（Event-Driven, Reactive Store等）
- 影響範囲の特定（どのファイルを変更すべきか）
- 設計一貫性の維持

---

### 問題2: Plan Modeを省略して実装を開始してしまう

**症状**: 実装途中で設計変更が発生し、手戻りが多い

**原因**:
- 設計を固めずに実装開始
- AIが`EnterPlanMode`ツールを使ってユーザーに提案しなかった
- Plan Modeの使い方がわからない

**対処**:
```
// ❌ Bad: AIが提案せず、設計なしで実装
User: "新機能追加したい"
Claude Code:
  1. Explore Agent
  2. 実装開始 ❌ (AIがEnterPlanModeツールを使わなかった)
  3. 実装途中で設計変更 ❌
  4. 手戻り発生 ❌

// ✅ Good: AIがPlan Mode提案、設計固定
User: "新機能追加したい"
Claude Code:
  1. Explore Agent
  2. EnterPlanModeツール使用 → ユーザーにPlan Modeを提案
  3. Plan Mode起動 → 設計書作成
  4. User承認
  5. 実装開始
```

**Plan Modeのメリット**:
- 設計の可視化（Userとの合意形成）
- 手戻りの削減
- Skills準拠の事前確認

**AIの責任**:
- Phase 2の条件（新機能実装、複数アプローチ、複雑なバグ修正等）に該当する場合、**必ず**`EnterPlanMode`ツールを使ってユーザーに提案する

---

### 問題3: Testを書かずにコミットしてしまう

**症状**: CI でテストカバレッジチェックが失敗

**原因**:
- Testフェーズを省略
- 時間がないためTestを後回し

**対処**:
```
// ❌ Bad: Testなしでコミット
User: "実装完了したのでコミットして"
Claude Code:
  1. /commit ❌ (テストなし)
  2. CI失敗 ❌ (カバレッジ60% < 80%)

// ✅ Good: Test追加後にコミット
User: "実装完了したのでコミットして"
Claude Code:
  1. Test追加 (test-strategy準拠)
  2. npm run test:coverage → 82% ✅
  3. /commit
  4. CI通過 ✅
```

**Testが重要な理由**:
- バグ流出の防止
- リファクタリングの容易性
- 品質の担保

---

### 問題4: CI通過せずにマージしてしまう

**症状**: 本番環境でバグ発生

**原因**:
- CI通過を待たずにマージ
- CI失敗を無視してマージ

**対処**:
```markdown
# ❌ Bad: CI失敗を無視してマージ
PR作成 → CI実行中... → マージ ❌ (CI失敗)

# ✅ Good: CI通過後にマージ
PR作成 → CI実行中... → すべてのチェック成功 ✅ → マージ
```

**GitHub Branch Protection設定**:
```yaml
# .github/settings.yml
branches:
  - name: main
    protection:
      required_status_checks:
        strict: true
        contexts:
          - architecture-check
          - test-coverage-check
          - security-check
          - naming-convention-check
          - import-order-check
      required_pull_request_reviews:
        required_approving_review_count: 1
```

---

## References

### 内部ドキュメント
- [CLAUDE.md](../../CLAUDE.md): 開発標準全体
- [.claude/skills/architecture-patterns/SKILL.md](../architecture-patterns/SKILL.md)
- [.claude/skills/test-strategy/SKILL.md](../test-strategy/SKILL.md)
- [.claude/skills/refactoring-workflow/SKILL.md](../refactoring-workflow/SKILL.md)
- [.claude/skills/security-patterns/SKILL.md](../security-patterns/SKILL.md)
- [.claude/skills/code-style/SKILL.md](../code-style/SKILL.md)

### 外部リソース
- [Claude Code Documentation](https://docs.anthropic.com/claude/docs/claude-code): Subagents, Skills, CLAUDE.md
- [GitHub Actions](https://docs.github.com/en/actions): CI/CD

---

**最終更新**: 2025-12-29
**M5.3 - Development Workflow Standardization**
**Week 2 Day 4: development-workflow Skill**

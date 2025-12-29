---
name: tdd-workflow
description: t_wada式TDD（Test-Driven Development）を実践する思考フレームワーク（Red-Green-Refactorサイクル）。新機能実装時、バグ修正時、リファクタリング時に使用。development-workflowのEditフェーズで自動装備。Test-First開発を強制し、失敗するテストを先に書く → 最速で通す実装 → 重複除去のサイクルを遵守させる。
---

# brainbase TDD Workflow

## Purpose

Test-First開発を実現し、設計品質と実装スピードを同時に向上させる。

**適用タイミング**:
- 新機能実装時（development-workflow の Edit フェーズ）
- バグ修正時（失敗するテストを先に書く）
- リファクタリング時（テストが守ってくれる安心感）

**t_wada式TDDの核心**:
1. 失敗するテストを書く（Red）
2. 最速で通す実装（Green）
3. 重複を除去して綺麗にする（Refactor）

## Thinking Framework

### 1. Red-Green-Refactorサイクル

**原則**: Red → Green → Refactor の順序で開発する

**思考パターン**:
- 機能追加 → 「まず失敗するテストを書いたか？」(Red)
- テストが通った → 「リファクタリングできるか？」(Refactor)
- 重複を見つけた → 「テストが守ってくれるから安心して削除できる」
- 実装方法に迷う → 「仮実装 → 三角測量 → 明白な実装の順で進める」

**Why**:
- 仕様の明確化（テストが仕様）
- 設計改善（テスタブルな設計になる）
- リファクタリングの安全性（テストが守る）
- 高速フィードバックループ（数分ごとにテストが通る）

**サイクルの詳細**:

```
┌─────────────────────────────────────────────────────────┐
│ Phase 1: RED（失敗するテストを書く）                     │
├─────────────────────────────────────────────────────────┤
│ 1. TODOリストから1つ選ぶ                                 │
│ 2. 失敗するテストを書く（コンパイルエラーでもOK）        │
│ 3. テスト実行 → 必ず失敗することを確認                   │
│                                                          │
│ ❌ npm run test → FAIL (expected)                        │
└─────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 2: GREEN（最速で通す実装）                         │
├─────────────────────────────────────────────────────────┤
│ 1. 仮実装（Fake It）: べた書きで通す                     │
│ 2. 三角測量（Triangulation）: テストケース追加で本実装   │
│ 3. 明白な実装（Obvious Implementation）: 自明なら直接   │
│ 4. テスト実行 → すべて通ることを確認                     │
│                                                          │
│ ✅ npm run test → PASS                                   │
└─────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 3: REFACTOR（重複除去、綺麗にする）                │
├─────────────────────────────────────────────────────────┤
│ 1. 重複コードを特定                                      │
│ 2. リファクタリング実施                                  │
│ 3. テスト実行 → すべて通ることを確認                     │
│ 4. TODOリストを更新（完了チェック、新TODO追加）          │
│                                                          │
│ ✅ npm run test → PASS (still green)                     │
└─────────────────────────────────────────────────────────┘
           ↓
       次のTODOへ
```

---

### 2. Test-First（テストファースト）

**原則**: 実装より先にテストを書く

**思考パターン**:
- 新機能追加 → 「テストを書いたか？」
- テストなしで実装開始 → 「STOP! まずテストを書く」
- テストが書けない → 「設計が悪い。インターフェースを見直す」

**Why Test-First**:
1. **設計改善**: テストしやすい = 疎結合で単一責任の設計
2. **仕様の明確化**: テストが仕様書になる
3. **バグの早期発見**: 実装前にエッジケースを考える
4. **リファクタリング容易性**: テストが守ってくれる

**Example**:
```javascript
// ❌ Bad: 実装ファーストでテスト後付け
// 1. TaskService.deleteTask() を実装
// 2. （後で）テストを追加 ← 忘れがち、エッジケースを見落とす

// ✅ Good: テストファーストで実装
// 1. テストを書く（失敗する）
describe('TaskService', () => {
  it('deleteTask呼び出し時_存在するタスク_DELETEDイベントが発火される', async () => {
    const emitted = [];
    eventBus.on(EVENTS.TASK_DELETED, (e) => emitted.push(e));

    await taskService.deleteTask('task-1');

    expect(emitted).toHaveLength(1);
    expect(emitted[0].detail.taskId).toBe('task-1');
  });

  it('deleteTask呼び出し時_存在しないタスク_エラーが投げられる', async () => {
    await expect(
      taskService.deleteTask('non-existent')
    ).rejects.toThrow('Task not found');
  });
});

// 2. 実装する（テストを通す）
export class TaskService {
  async deleteTask(taskId) {
    const task = await this.repository.findById(taskId);
    if (!task) throw new Error('Task not found');

    await this.repository.deleteTask(taskId);
    this.eventBus.emit(EVENTS.TASK_DELETED, { taskId });
  }
}
```

---

### 3. 小さいステップ（Baby Steps）

**原則**: 一度に1つの機能のみ追加

**思考パターン**:
- 大きな機能追加 → 「TODOリストに分解できないか？」
- テストが通らない → 「ステップが大きすぎないか？小さく分割する」
- 複数の変更を同時実施 → 「STOP! 1つずつ進める」

**Why Baby Steps**:
1. **デバッグ容易性**: 問題が起きても原因特定が簡単
2. **フィードバックループ**: 数分ごとにテストが通る快感
3. **手戻り最小化**: 失敗しても小さい範囲の巻き戻し

**Example**:
```
// ❌ Bad: 大きすぎるステップ
TODO: プロジェクト削除機能を追加
  → 1つのステップで全部実装 ❌（テストが通らない、デバッグ困難）

// ✅ Good: 小さいステップ
TODO: プロジェクト削除機能を追加
  ├─ [x] ProjectService.deleteProject() メソッド追加（エラーケースなし）
  ├─ [x] 存在しないプロジェクトのエラー処理追加
  ├─ [x] EVENTS.PROJECT_DELETED イベント発火
  ├─ [ ] UI: 削除ボタン追加
  └─ [ ] UI: 確認ダイアログ追加
```

---

### 4. TODOリスト駆動開発

**原則**: 実装すべき機能をTODOリストに書き、完了したらチェック

**思考パターン**:
- 機能追加開始 → 「TODOリストを作成したか？」
- 実装中に新しいTODOを発見 → 「リストに追加して後回し」
- テストが通った → 「TODOをチェックして次へ」

**TODOリストの形式**:
```markdown
## TODO List

### 1. プロジェクト削除機能
- [x] ProjectService.deleteProject() メソッド追加
- [x] ProjectRepository.deleteProject() メソッド追加
- [x] EVENTS.PROJECT_DELETED イベント定義
- [ ] UI: 削除ボタン追加
- [ ] UI: 確認ダイアログ追加
- [ ] API: DELETE /api/projects/:id エンドポイント追加

### 2. 実装中に発見したTODO
- [ ] プロジェクト削除時のカスケード削除（タスク、セッション）
- [ ] 削除履歴の記録（監査ログ）
```

**運用方法**:
1. **機能追加開始時**: Plan Modeで TODOリストを作成
2. **Red-Green-Refactor中**: 1つのTODOに集中、完了したらチェック
3. **新しいTODO発見時**: リストに追加して後回し（集中力を維持）

---

### 5. 仮実装→三角測量→明白な実装

**原則**: 実装方法に迷ったら仮実装から始める

**3つのアプローチ**:

#### 5.1 仮実装（Fake It）
「べた書きで通す」

**使うタイミング**: 実装方法が不明確、複雑なロジック

**Example**:
```javascript
// Step 1: Red（失敗するテスト）
it('タスク数取得_3件のタスクが返される', () => {
  const count = taskService.getTaskCount();
  expect(count).toBe(3);
});
// → FAIL: getTaskCount is not defined

// Step 2: Green（仮実装 - べた書き）
getTaskCount() {
  return 3; // ← べた書きで通す！
}
// → PASS ✅
```

#### 5.2 三角測量（Triangulation）
「テストケース追加で本実装を導出」

**使うタイミング**: 仮実装後、本実装が自明でない

**Example**:
```javascript
// Step 3: Red（2つ目のテストケース追加）
it('タスク数取得_5件のタスクが返される', () => {
  taskService.addTask({ title: 'Task 4' });
  taskService.addTask({ title: 'Task 5' });
  const count = taskService.getTaskCount();
  expect(count).toBe(5);
});
// → FAIL: expected 5, got 3 (仮実装のまま)

// Step 4: Green（本実装）
getTaskCount() {
  return this.tasks.length; // ← 2つのテストを通すために本実装
}
// → PASS ✅
```

#### 5.3 明白な実装（Obvious Implementation）
「実装が自明なら直接書く」

**使うタイミング**: 実装が単純明快

**Example**:
```javascript
// Step 1: Red
it('タスク追加_タスク一覧に追加される', () => {
  taskService.addTask({ title: 'New Task' });
  expect(taskService.tasks).toHaveLength(1);
});

// Step 2: Green（明白な実装）
addTask(task) {
  this.tasks.push(task); // ← 実装が自明なので直接書く
}
```

**判断基準**:
```
実装方法が不明確 → 仮実装 → 三角測量
実装が自明 → 明白な実装
```

---

### 6. development-workflowとの統合

**統合ポイント**: development-workflow の **Edit フェーズ** = tdd-workflow

**フロー全体**:
```
┌─────────────────────────────────────────────────────────┐
│ development-workflow                                     │
├─────────────────────────────────────────────────────────┤
│ 1. Explore → 既存コード理解                              │
│ 2. Plan    → 設計書作成 + TODOリスト作成                 │
│                                                          │
│ 3. Edit    ← ★ tdd-workflow統合                         │
│    ├─ Red       (失敗するテスト)                         │
│    ├─ Green     (仮実装 → 三角測量 → 明白な実装)         │
│    ├─ Refactor  (重複除去)                               │
│    └─ 繰り返し（TODOリスト完了まで）                     │
│                                                          │
│ 4. Test    → test-strategy準拠確認（カバレッジ80%+）     │
│ 5. Commit  → コミット・PR作成                            │
└─────────────────────────────────────────────────────────┘
```

**Skills装備**:
```javascript
// Edit フェーズ
装備: tdd-workflow, architecture-patterns, code-style, security-patterns

// tdd-workflow内部で参照
- test-strategy (Test Naming Convention, Test Pyramid)
- architecture-patterns (Event-Driven, Service Layer等)
```

**Example**:
```
User: "プロジェクト削除機能を追加したい"

Claude Code:
  1. [Explore Agent] 既存のプロジェクト管理機能を調査
  2. [Plan Mode] 設計書作成 + TODOリスト作成
     TODO:
       - [ ] ProjectService.deleteProject() メソッド追加
       - [ ] EVENTS.PROJECT_DELETED イベント定義
       - [ ] UI削除ボタン追加

  3. [Edit - tdd-workflow装備] ← ★ここでTDD開始

     ── Red ──
     describe('ProjectService', () => {
       it('deleteProject呼び出し時_DELETEDイベントが発火される', async () => {
         // テスト記述
       });
     });
     npm run test → FAIL ❌

     ── Green ──
     async deleteProject(id) {
       // 仮実装: べた書き
       this.eventBus.emit(EVENTS.PROJECT_DELETED, { projectId: id });
     }
     npm run test → PASS ✅

     ── Green（三角測量）──
     it('deleteProject呼び出し時_Repositoryのdelete呼び出し', async () => {
       // 2つ目のテストケース
     });
     npm run test → FAIL ❌

     async deleteProject(id) {
       // 本実装
       await this.repository.deleteProject(id);
       this.eventBus.emit(EVENTS.PROJECT_DELETED, { projectId: id });
     }
     npm run test → PASS ✅

     ── Refactor ──
     // 重複除去、綺麗にする
     npm run test → PASS ✅

     TODO: [x] ProjectService.deleteProject() メソッド追加

  4. [Test] カバレッジ確認（test-strategy準拠）
  5. [Commit] PR作成
```

---

## Usage

このSkillは以下のタイミングで使用される:

1. **実装時**: development-workflow の Edit フェーズ
2. **バグ修正時**: 失敗するテストを先に書く
3. **リファクタリング時**: テストが守ってくれる安心感

**使用例**:

```
User: "タスクアーカイブ機能を追加したい"

Claude Code: [tdd-workflow Skillを装備]

思考プロセス:
1. Test-First: まずテストを書く
2. Red-Green-Refactor: サイクルに従う
3. Baby Steps: 小さいステップで進める
4. TODO駆動: TODOリスト完了まで繰り返す

実装:
1. Red: archiveTask()の失敗するテストを書く
2. Green: 仮実装でテストを通す
3. Green: 三角測量で本実装
4. Refactor: 重複除去（_ensureTaskExists()共通化）
5. TODO: [x] TaskService.archiveTask() メソッド追加
```

---

## Success Criteria

- [ ] Test-Firstが100%実践されている（すべての新機能・バグ修正でテストを先に書く）
- [ ] Red-Green-Refactorサイクルが遵守されている
  - Red: 失敗するテストを確認してからGreenへ進む
  - Green: テストが通ってからRefactorへ進む
  - Refactor: テストが通ることを確認してから次のTODOへ
- [ ] TODOリスト駆動開発が実践されている
  - Plan ModeでTODOリストを作成
  - 1つのTODOに集中して実装
  - 完了したらチェック、次のTODOへ
- [ ] 小さいステップで進んでいる（1サイクル15分以内）
- [ ] 仮実装→三角測量→明白な実装の使い分けができている
- [ ] test-strategy準拠（Test Pyramid, Coverage 80%+, Test Naming）
- [ ] architecture-patterns準拠（Event-Driven, Service Layer等）

---

## Enforcement

### Local
- このSkillを装備したClaude Codeが自動チェック
- TDD準拠を促す
- Red-Green-Refactorサイクルの遵守確認

### CI（オプション）
- GitHub Actions で `tdd-check.yml` が実行
- PRマージ前にTDD準拠を確認

**チェック項目**:
```bash
# Test-First順序チェック（テストコミット→実装コミットの順序）
commits=$(git log origin/main..HEAD --pretty=format:"%H")

for commit in $commits; do
  test_files=$(git diff-tree --no-commit-id --name-only -r $commit | grep "tests/")
  impl_files=$(git diff-tree --no-commit-id --name-only -r $commit | grep -v "tests/")

  if [ -n "$impl_files" ] && [ -z "$test_files" ]; then
    echo "❌ Error: Implementation without test found in commit $commit"
    exit 1
  fi
done

echo "✅ Test-First compliance verified"
```

---

## Troubleshooting

TDD実践中に遭遇する問題の詳細な解決方法については、[references/troubleshooting.md](references/troubleshooting.md)を参照してください。

**主な問題**:
- **問題1: テストが書けない** → 設計の明確化、仕様から考える
- **問題2: 仮実装と本実装の区別がつかない** → 三角測量のタイミング（2つ目のテストケース追加）
- **問題3: リファクタリングが怖い** → カバレッジ80%以上、振る舞いテスト
- **問題4: TODOリストが膨大になる** → 分割（1機能=3-5個のTODO）と優先順位付け

---

## References

### 内部ドキュメント
- [CLAUDE.md](../../CLAUDE.md): 開発標準全体
- [.claude/skills/test-strategy/SKILL.md](../test-strategy/SKILL.md): テスト戦略
- [.claude/skills/development-workflow/SKILL.md](../development-workflow/SKILL.md): 開発フロー
- [.claude/skills/architecture-patterns/SKILL.md](../architecture-patterns/SKILL.md): アーキテクチャパターン

### 外部リソース
- [テスト駆動開発（Kent Beck著）](https://www.amazon.co.jp/dp/4274217884): TDDの原典
- [t_wada氏 TDD講演](https://www.youtube.com/watch?v=Q-FJ3XmFlT8): t_wada式TDDの解説
- [Vitest Documentation](https://vitest.dev/): Vitestテストフレームワーク

---

**最終更新**: 2025-12-29
**M5.3 - Development Workflow Standardization**
**TDD統合: tdd-workflow Skill**

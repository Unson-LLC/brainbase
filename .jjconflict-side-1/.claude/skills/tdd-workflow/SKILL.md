---
name: tdd-workflow
description: TDD（Test-Driven Development）のRed-Green-Refactorサイクルを自動化する4 Phase Orchestrator Skill。Test Designer（opus）→ Red → Green（仮実装→三角測量→明白な実装）→ Refactorの順で実行。
---

# TDD Workflow

**目的**: TDDのRed-Green-Refactorサイクルを自動化し、ベテラン開発者のTDD実践ロジックを外付け化する

このSkillは、CLAUDE.mdで定義されたTDD原則を自動的に実践し、新人開発者がベテランと同じ品質のコードを書けるようにします。

## Workflow Overview

```
Phase 1: Test Designer（テスト設計）
└── agents/phase1_test_designer.md (opus)
    └── どのテストケースを書くべきか判断
    └── エッジケースを特定
    └── テスト仕様を生成

Phase 2: Red（失敗するテストを書く）
└── agents/phase2_red_implementer.md (sonnet)
    └── Phase 1の仕様からテストコード生成
    └── npm run test → FAIL ❌

Phase 3: Green（仮実装→三角測量→明白な実装）
└── agents/phase3_green_implementer.md (sonnet)
    └── 仮実装（べた書き）
    └── 三角測量（エッジケース追加）
    └── 明白な実装
    └── npm run test → PASS ✅

Phase 4: Refactor（重複除去）
└── agents/phase4_refactorer.md (sonnet)
    └── 重複除去の方針を判断
    └── リファクタリング実施
    └── npm run test → PASS ✅ (still green)
```

## ベテランと新人の差（思考の外付け化）

### ベテラン開発者のTDD実践

```
新機能追加
  ↓
「まずどのテストケースを書くべきか？」
  ↓ Test Designer（判断）
「正常系、異常系、境界値をカバーする3つのテストが必要」
  ↓ Red
「失敗するテストを書く」
  ↓ npm run test → FAIL ❌
  ↓ Green（3段階）
「仮実装（べた書き）→ 三角測量 → 明白な実装」
  ↓ npm run test → PASS ✅
  ↓ Refactor
「この重複はヘルパー関数に抽出すべき」
  ↓ npm run test → PASS ✅
  ↓
✅ TDDサイクル完了
```

### 新人開発者のTDD実践（失敗例）

```
新機能追加
  ↓
「とりあえず1つテスト書く」
  ↓ Red
「正常系のみ」（エッジケースなし）
  ↓ Green
「いきなり明白な実装」（仮実装・三角測量スキップ）
  ↓
❌ TDDの本質を理解していない
```

→ **このSkillでベテランのTDD実践ロジックを再現**

## 判断による分岐例

```
新機能追加
  ↓
Phase 1: Test Designer（opus）
  ↓
「正常系・異常系・境界値をカバーする3つのテストが必要」
  ↓
Phase 2: Red
  ↓
3つのテストを書く
  ↓ npm run test → FAIL ❌
Phase 3: Green
  ↓
仮実装（べた書き）
  ↓ 1つ目のテストPASS
三角測量（2つ目のテスト追加）
  ↓ エッジケースを考慮した実装
明白な実装
  ↓ npm run test → PASS ✅
Phase 4: Refactor
  ↓
重複検出
  ↓ YES
├─→ [ヘルパー関数抽出] をQueueに追加
  ↓ Refactor実施
  └─→ npm run test → PASS ✅
```

→ **各Phaseで判断し、動的にQueueに積む** = Agenticにする価値がある

## Orchestration Logic

### Phase 1: Test Designer（テスト設計）

**Subagent**: `agents/phase1_test_designer.md`
**Model**: **opus**（設計タスクなので高精度モデル）

**Input**: 実装したい機能の仕様

**Process**:
1. 正常系・異常系・境界値を分析
2. カバーすべきテストケースを特定
3. エッジケースを考慮
4. テスト仕様を生成

**Output**: テストケース仕様（3-5個）

### Phase 2: Red（失敗するテストを書く）

**Subagent**: `agents/phase2_red_implementer.md`
**Model**: sonnet

**Input**: Phase 1のテスト仕様

**Process**:
1. テスト仕様からテストコードを生成
2. `npm run test` で実行
3. FAIL ❌ を確認

**Output**: テストコード（FAIL状態）

### Phase 3: Green（仮実装→三角測量→明白な実装）

**Subagent**: `agents/phase3_green_implementer.md`
**Model**: sonnet

**Input**: Phase 2のテストコード

**Process**:
1. **仮実装（Fake Implementation）**: べた書きで最速で通す
2. **三角測量（Triangulation）**: 2つ目のテストを追加してエッジケースを考慮
3. **明白な実装（Obvious Implementation）**: 正しい実装に置き換え
4. `npm run test` で PASS ✅ を確認

**Output**: 実装コード（PASS状態）

### Phase 4: Refactor（重複除去）

**Subagent**: `agents/phase4_refactorer.md`
**Model**: sonnet

**Input**: Phase 3の実装コード

**Process**:
1. 重複コードを検出
2. 抽出すべきヘルパー関数を判断
3. リファクタリング実施
4. `npm run test` で PASS ✅ を維持

**Output**: リファクタリング後のコード（PASS維持）

## Orchestrator Responsibilities

### Phase Management

**各Phaseの完了を確認**:
- Phase 1の成果物が存在するか（テストケース仕様）
- Phase 2の成果物が存在するか（FAILするテストコード）
- Phase 3の成果物が存在するか（PASSする実装コード）
- Phase 4の成果物が存在するか（Refactor後のコード、PASS維持）

**Phase間のデータ受け渡しを管理**:
- Phase 1のテストケース仕様をPhase 2に渡す
- Phase 2のテストコードをPhase 3に渡す
- Phase 3の実装コードをPhase 4に渡す

---

### Review & Replan

**Review実施** (各Phase完了後):

1. **ファイル存在確認**
   - Phase 1成果物: テストケース仕様（3-5個）
   - Phase 2成果物: テストコード（FAIL状態）
   - Phase 3成果物: 実装コード（PASS状態）
   - Phase 4成果物: Refactor後のコード（PASS維持）

2. **Success Criteriaチェック**
   - **Phase 1**:
     - SC-1: テストケースが3-5個定義されている
     - SC-2: エッジケースが含まれている
     - SC-3: 期待値が明確
   - **Phase 2**:
     - SC-1: テストが FAIL ❌ している
     - SC-2: エラーメッセージが明確
   - **Phase 3**:
     - SC-1: テストが PASS ✅ している
     - SC-2: 仮実装 → 三角測量 → 明白な実装の3段階を踏んでいる
   - **Phase 4**:
     - SC-1: Refactor後もテストが PASS ✅ している
     - SC-2: 重複コードが除去されている

3. **差分分析**
   - **Phase 1**: テストケースの網羅性
   - **Phase 2**: テストの失敗が適切か（実装が未完了のため）
   - **Phase 3**: 仮実装 → 三角測量 → 明白な実装の順序
   - **Phase 4**: リファクタリング後のテスト維持

4. **リスク判定**
   - **Critical**: リプラン実行（Subagentへ修正指示）
     - Phase 2でテストがPASSしてしまう（RED失敗）
     - Phase 3でテストがFAIL（GREEN失敗）
     - Phase 4でテストがFAIL（Refactor失敗）
     - テストケースが2個以下
   - **Minor**: 警告+進行許可
     - エッジケースがやや不足
   - **None**: 承認（次Phaseへ）

**Replan実行** (Critical判定時):

1. **Issue Detection（問題検出）**
   - Success Criteriaの不合格項目を特定
   - 例: "Phase 2でテストがPASSしてしまいました（FAIL ❌ 期待）"

2. **Feedback Generation（フィードバック生成）**
   - 何が要件と異なるか: "テストがFAILすべき段階でPASSしています"
   - どう修正すべきか: "実装コードを削除し、テストのみ残してください"
   - 修正チェックリスト:
     - [ ] 実装コードの削除
     - [ ] テスト実行確認（FAIL ❌）
     - [ ] エラーメッセージの確認

3. **Replan Prompt Creation（リプランプロンプト作成）**
   - 元のタスク + フィードバック
   - Success Criteriaの再定義

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

**TDDサイクルの特殊性**:
- TDD自体がReview & Replanループ（RED→GREEN→REFACTOR）
- 各PhaseでSuccess Criteriaを明示化することで、TDDサイクルの品質を保証

---

### Error Handling

**Phase実行失敗時のフォールバック**:
- Subagent起動失敗 → Task Tool再実行（1回）
- テスト実行失敗 → エラーログ確認 + ユーザーへ通知

**テストが PASS/FAIL しない場合**:
- Phase 2（RED）でPASSしてしまう → Phase 3（GREEN）へ進まない、リプラン実行
- Phase 3（GREEN）でFAILする → 仮実装から再開、リプラン実行
- Phase 4（Refactor）でFAILする → Refactor取り消し、Phase 3へ戻る

**Max Retries超過時の人間へのエスカレーション**:
- 3回のリプラン実行後も基準を満たさない → AskUserQuestion
- 質問内容: 問題の詳細、リプラン履歴、人間の判断を求める理由

## Success Criteria

- [ ] Phase 1 テスト設計が完了（3-5個のテストケース）
- [ ] Phase 2 テストが FAIL ❌
- [ ] Phase 3 テストが PASS ✅
- [ ] Phase 4 Refactor後もテストが PASS ✅
- [ ] TDDサイクルが完了

## Expected Output

```markdown
# TDD Workflow 実行結果

## Phase 1: Test Designer（opus）

### テストケース仕様

1. **正常系**: `archiveTask_タスクが存在する_ステータスがarchivedに更新される`
2. **異常系**: `archiveTask_タスクが存在しない_エラーが投げられる`
3. **境界値**: `archiveTask_既にarchivedのタスク_エラーが投げられる`

## Phase 2: Red（FAIL ❌）

```javascript
// task-service.test.js
describe('TaskService', () => {
  it('archiveTask_タスクが存在する_ステータスがarchivedに更新される', async () => {
    await taskService.archiveTask('task-1');
    expect(task.status).toBe('archived');
  });
});
```

```bash
$ npm run test
FAIL ❌ archiveTask is not defined
```

## Phase 3: Green（PASS ✅）

### 仮実装
```javascript
async archiveTask(taskId) {
  // べた書き
  this.tasks.find(t => t.id === 'task-1').status = 'archived';
}
```

### 三角測量
```javascript
it('archiveTask_タスクが存在しない_エラーが投げられる', async () => {
  await expect(taskService.archiveTask('non-existent')).rejects.toThrow();
});
```

### 明白な実装
```javascript
async archiveTask(taskId) {
  const task = await this.repository.findById(taskId);
  if (!task) throw new Error('Task not found');
  await this.repository.updateTaskStatus(taskId, 'archived');
  this.eventBus.emit(EVENTS.TASK_ARCHIVED, { taskId });
}
```

```bash
$ npm run test
PASS ✅ all tests passed
```

## Phase 4: Refactor（PASS ✅ 維持）

### 重複除去
```javascript
// 重複: findById + エラーチェック
async _ensureTaskExists(taskId) {
  const task = await this.repository.findById(taskId);
  if (!task) throw new Error('Task not found');
  return task;
}

async archiveTask(taskId) {
  await this._ensureTaskExists(taskId);
  await this.repository.updateTaskStatus(taskId, 'archived');
  this.eventBus.emit(EVENTS.TASK_ARCHIVED, { taskId });
}
```

```bash
$ npm run test
PASS ✅ all tests passed
```

## サマリー

- **テストケース**: 3個
- **Red**: FAIL ❌ → 成功
- **Green**: PASS ✅ → 成功
- **Refactor**: PASS ✅ 維持 → 成功
- **TDDサイクル**: 完了
```

## 使い方

```bash
# 新機能のTDD実装
/tdd-workflow "archiveTask機能を実装"

# 既存機能へのテスト追加
/tdd-workflow --existing "getTasks機能"
```

## Troubleshooting

### テストが PASS しない

**原因**: Green実装が不十分

**対処**: Phase 3を再実行

### Refactor後にテストが FAIL

**原因**: リファクタリングでバグ混入

**対処**: Refactorを取り消してPhase 4を再実行

## 参照

- **CLAUDE.md**: `§1.5 Test-Driven Development (TDD)`
- **Skills**: なし（独立動作）
- **Model**: opus（Phase 1）、sonnet（Phase 2-4）

---

最終更新: 2025-12-31
brainbase開発ワークフロー自動化

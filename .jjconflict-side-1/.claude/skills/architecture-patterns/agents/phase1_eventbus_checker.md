---
name: phase1-eventbus-checker
description: Event-Driven Architectureパターンへの準拠をチェック。Event発火、Event名規約、直接呼び出しアンチパターンを判断。
tools:
  - Read
  - Grep
  - Bash
model: claude-sonnet-4-5-20250929
---

# Phase 1: EventBus パターンチェック

**親Skill**: architecture-patterns
**Phase**: 1/4
**判断ポイント**: Event発火が適切か、Event名が規約に準拠しているか

## Purpose

brainbaseのEvent-Driven Architectureパターンへの準拠をチェックし、以下を判断する：
1. 状態変更時にEventが発火されているか
2. Event名が規約に準拠しているか（`EVENTS.TASK_COMPLETED`等）
3. 直接呼び出しのアンチパターンがないか

## Thinking Framework（ベテランの判断ロジック）

### ベテラン開発者の判断

```
状態変更コードを見つける
  ↓
「この状態変更は他のモジュールに影響するか？」
  ↓ YES
「EventBusで発火すべき」
  ↓
Event名は規約に準拠しているか？
  - EVENTS.TASK_COMPLETED ✅
  - 'task:completed' ❌（ハードコーディング）
  - taskCompleted ❌（定数なし）
```

### 新人開発者の判断

```
状態変更コードを書く
  ↓
「とりあえず直接呼び出し」
  ↓
taskService.onComplete(taskId) ❌
```

→ **このSubagentでベテランの判断を再現**

## Process

### Step 1: 状態変更コードの検出

**チェック対象パターン**:
```javascript
// タスク完了
task.status = 'completed'
await repository.updateTask(id, { status: 'completed' })

// セッション変更
currentSession = newSession
appStore.setState({ currentSessionId: newId })

// スケジュール更新
schedule.updated = true
```

**Grepパターン**:
```bash
# 状態変更を検出
grep -rn "\.status\s*=" public/modules/domain/
grep -rn "updateTask\|updateSession\|updateSchedule" public/modules/domain/
grep -rn "setState" public/modules/
```

### Step 2: EventBus使用の確認

**期待されるパターン**:
```javascript
// Good: EventBus使用
eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: '123' });
eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId: 'brainbase' });
```

**Grepパターン**:
```bash
# EventBus使用を検出
grep -rn "eventBus\.emit" public/modules/domain/
grep -rn "EVENTS\." public/modules/domain/
```

### Step 3: アンチパターンの検出

**アンチパターン1: 直接呼び出し**
```javascript
// Bad: 直接呼び出し
taskService.onComplete(taskId); // ❌ 密結合
```

**Grepパターン**:
```bash
# 直接呼び出しを検出（onXXXメソッド）
grep -rn "\.on[A-Z][a-zA-Z]*\(" public/modules/domain/
```

**アンチパターン2: Event名のハードコーディング**
```javascript
// Bad: ハードコーディング
eventBus.emit('task:completed', { taskId: '123' }); // ❌ 定数なし
```

**Grepパターン**:
```bash
# ハードコーディングを検出
grep -rn "eventBus\.emit(['\"][^'\"]*['\"]" public/modules/
```

### Step 4: 判断と修正提案

**判断ロジック**:
```
状態変更が見つかった
  ↓
同じファイル内にeventBus.emit()があるか？
  ↓ NO
  ├─→ Critical: Event発火なし
  │   └─→ 修正提案: eventBus.emit()追加
  ↓ YES
Event名はEVENTS定数を使用しているか？
  ↓ NO
  ├─→ Warning: ハードコーディング
  │   └─→ 修正提案: EVENTS定数使用
  ↓ YES
  └─→ ✅ 合格
```

## Expected Input

- **ファイルパス**: チェック対象のファイル（オプション）
- **--changed-only**: 変更ファイルのみチェック（git diff）

## Expected Output

```markdown
# Phase 1: EventBus パターンチェック結果

## ❌ Critical（必須修正）

### Event発火なし
- **ファイル**: `public/modules/domain/task/task-service.js:45`
- **コード**: `await this.repository.updateTask(id, { status: 'completed' });`
- **問題**: 状態変更後にEventが発火されていない
- **修正提案**:
  ```javascript
  // Before
  await this.repository.updateTask(id, { status: 'completed' });

  // After
  await this.repository.updateTask(id, { status: 'completed' });
  this.eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: id });
  ```

### 直接呼び出しアンチパターン
- **ファイル**: `public/modules/views/task-view.js:78`
- **コード**: `taskService.onComplete(taskId);`
- **問題**: 直接呼び出し（密結合）
- **修正提案**:
  ```javascript
  // Bad: 直接呼び出し
  taskService.onComplete(taskId);

  // Good: EventBus経由
  eventBus.emit(EVENTS.TASK_COMPLETED, { taskId });
  ```

## ⚠️ Warning（推奨修正）

### Event名のハードコーディング
- **ファイル**: `public/modules/domain/session/session-service.js:34`
- **コード**: `eventBus.emit('session:changed', { sessionId });`
- **問題**: Event名がハードコーディングされている
- **修正提案**:
  ```javascript
  // Bad: ハードコーディング
  eventBus.emit('session:changed', { sessionId });

  // Good: EVENTS定数使用
  eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId });
  ```

## ✅ 合格

- `public/modules/domain/task/task-repository.js`: Event発火あり、EVENTS定数使用
- `public/modules/domain/schedule/schedule-service.js`: Event発火あり、EVENTS定数使用

## サマリー

- **チェックファイル数**: 12
- **Critical**: 2件
- **Warning**: 1件
- **合格**: 9件

---
Phase 2へ渡すデータ:
- Critical違反: 2件
- Warning違反: 1件
```

## Success Criteria

- [ ] 状態変更コードを検出できた
- [ ] EventBus使用を確認できた
- [ ] アンチパターンを検出できた
- [ ] 修正提案が生成された
- [ ] Phase 2への引き継ぎデータが準備された

## Skills Integration

このSubagentは独立動作（他のSkills使用なし）

## Troubleshooting

### 誤検出が多い

**原因**:
- Grepパターンが厳しすぎる
- コメント行もマッチしている

**対処**:
```bash
# コメント除外
grep -v "^\s*//" | grep "\.status\s*="
```

### 検出漏れ

**原因**:
- パターンが不十分

**対処**:
- Grepパターンを追加
- 手動レビューと併用

## 次のステップ

Phase 2 Subagent（phase2_store_checker.md）へ:
- Critical違反件数を渡す
- Warning違反件数を渡す
- Phase 2でReactive Storeチェック

---

最終更新: 2025-12-31
brainbase Architecture Patterns - EventBus Checker

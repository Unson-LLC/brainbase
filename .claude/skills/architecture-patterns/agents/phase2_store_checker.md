---
name: phase2-store-checker
description: Reactive Storeパターンへの準拠をチェック。Store経由の状態更新、DOM直接操作アンチパターンを判断。
tools:
  - Read
  - Grep
  - Bash
model: claude-sonnet-4-5-20250929
---

# Phase 2: Reactive Store パターンチェック

**親Skill**: architecture-patterns
**Phase**: 2/4
**判断ポイント**: Store経由で状態更新しているか、DOM直接操作していないか

## Purpose

brainbaseのReactive Storeパターンへの準拠をチェックし、以下を判断する：
1. 状態更新がStore経由か
2. UI更新がStore購読で実現されているか
3. DOM直接操作のアンチパターンがないか

## Thinking Framework（ベテランの判断ロジック）

### ベテラン開発者の判断

```
UI更新が必要
  ↓
「状態をStoreに保存し、subscribeで自動更新すべき」
  ↓
appStore.setState({ currentSessionId: 'brainbase' })
appStore.subscribe((change) => render())
  ↓
✅ 状態とDOMが分離される
```

### 新人開発者の判断

```
UI更新が必要
  ↓
「とりあえずDOM操作」
  ↓
document.getElementById('session').textContent = 'brainbase'
  ↓
❌ 状態とDOMが分離されない
```

→ **このSubagentでベテランの判断を再現**

## Process

### Step 1: 状態更新コードの検出

**チェック対象パターン**:
```javascript
// 現在のセッション変更
currentSessionId = 'brainbase'

// タスクフィルタ変更
taskFilter = 'pending'

// UI状態変更
inboxOpen = true
```

**Grepパターン**:
```bash
# グローバル変数への代入
grep -rn "^[a-z][a-zA-Z]*\s*=" public/modules/
grep -rn "this\.[a-z][a-zA-Z]*\s*=" public/modules/
```

### Step 2: Store使用の確認

**期待されるパターン**:
```javascript
// Good: Store経由
appStore.setState({ currentSessionId: 'brainbase' });

// Good: Store購読
const unsubscribe = appStore.subscribe((change) => {
  console.log(`${change.key} changed:`, change.value);
  render(); // UI更新
});
```

**Grepパターン**:
```bash
# Store使用を検出
grep -rn "appStore\.setState" public/modules/
grep -rn "appStore\.subscribe" public/modules/
```

### Step 3: アンチパターンの検出

**アンチパターン1: DOM直接操作**
```javascript
// Bad: DOM直接操作
document.getElementById('session').textContent = 'brainbase'; // ❌
document.querySelector('.task-list').innerHTML = html; // ❌
```

**Grepパターン**:
```bash
# DOM直接操作を検出
grep -rn "document\.getElementById.*\.textContent\s*=" public/modules/
grep -rn "document\.querySelector.*\.innerHTML\s*=" public/modules/
grep -rn "\.textContent\s*=\|\.innerHTML\s*=" public/modules/
```

**アンチパターン2: 状態とDOMの分離なし**
```javascript
// Bad: 状態とDOMが同じ場所
function updateSession(sessionId) {
  currentSessionId = sessionId; // 状態更新
  document.getElementById('session').textContent = sessionId; // DOM更新
  // ❌ 状態管理とUI更新が混在
}
```

### Step 4: 判断と修正提案

**判断ロジック**:
```
状態更新が見つかった
  ↓
appStore.setState()を使用しているか？
  ↓ NO
  ├─→ Critical: Store未使用
  │   └─→ 修正提案: appStore.setState()使用
  ↓ YES
同じファイル内にDOM操作があるか？
  ↓ YES
  ├─→ Warning: DOM直接操作
  │   └─→ 修正提案: Store購読で自動更新
  ↓ NO
  └─→ ✅ 合格
```

## Expected Input

- **Phase 1の結果**: 違反件数（オプション）
- **ファイルパス**: チェック対象のファイル（オプション）

## Expected Output

```markdown
# Phase 2: Reactive Store パターンチェック結果

## ❌ Critical（必須修正）

### Store未使用
- **ファイル**: `public/modules/views/session-selector.js:23`
- **コード**: `currentSessionId = newSession;`
- **問題**: Store経由で状態更新していない
- **修正提案**:
  ```javascript
  // Before
  currentSessionId = newSession;
  document.getElementById('session').textContent = newSession;

  // After
  appStore.setState({ currentSessionId: newSession });
  // UI更新はStore購読で自動化
  ```

## ⚠️ Warning（推奨修正）

### DOM直接操作
- **ファイル**: `public/modules/views/task-list.js:56`
- **コード**: `document.querySelector('.task-list').innerHTML = html;`
- **問題**: DOM直接操作（状態とDOMが分離されていない）
- **修正提案**:
  ```javascript
  // Bad: DOM直接操作
  document.querySelector('.task-list').innerHTML = html;

  // Good: Store経由
  appStore.setState({ tasks: newTasks });

  // 別の場所でStore購読
  appStore.subscribe((change) => {
    if (change.key === 'tasks') {
      render(change.value);
    }
  });
  ```

## ✅ 合格

- `public/modules/domain/task/task-service.js`: Store使用、DOM操作なし
- `public/modules/views/app.js`: Store購読でUI更新

## サマリー

- **チェックファイル数**: 15
- **Critical**: 1件
- **Warning**: 1件
- **合格**: 13件

---
Phase 3へ渡すデータ:
- Critical違反: 1件（累計: 3件）
- Warning違反: 1件（累計: 2件）
```

## Success Criteria

- [ ] 状態更新コードを検出できた
- [ ] Store使用を確認できた
- [ ] DOM直接操作アンチパターンを検出できた
- [ ] 修正提案が生成された
- [ ] Phase 3への引き継ぎデータが準備された

## Store構造の参照

```javascript
// public/modules/core/store.js
{
  sessions: [],          // セッション一覧
  currentSessionId: null, // 現在のセッションID
  tasks: [],             // タスク一覧
  schedule: null,        // スケジュール
  inbox: [],             // Inbox項目
  filters: {             // フィルタ設定
    taskFilter: '',
    showAllTasks: false
  },
  ui: {                  // UI状態
    inboxOpen: false,
    draggedSessionId: null
  }
}
```

## Skills Integration

このSubagentは独立動作（他のSkills使用なし）

## Troubleshooting

### textContentの誤検出

**原因**:
- Readでの代入も検出している

**対処**:
```bash
# 代入のみ検出
grep "\.textContent\s*=" | grep -v "const\|let\|var"
```

### innerHTML正当利用の誤検出

**原因**:
- DOMPurifyでサニタイズしている場合も検出

**対処**:
- DOMPurify使用ケースを除外
- ホワイトリストに追加

## 次のステップ

Phase 3 Subagent（phase3_di_checker.md）へ:
- 累計Critical違反件数を渡す
- 累計Warning違反件数を渡す
- Phase 3でDI Containerチェック

---

最終更新: 2025-12-31
brainbase Architecture Patterns - Reactive Store Checker

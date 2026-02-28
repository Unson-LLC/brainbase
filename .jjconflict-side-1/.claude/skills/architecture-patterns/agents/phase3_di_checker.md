---
name: phase3-di-checker
description: DI Containerパターンへの準拠をチェック。DI経由の依存解決、直接importアンチパターン、循環依存を判断。
tools:
  - Read
  - Grep
  - Bash
model: claude-sonnet-4-5-20250929
---

# Phase 3: DI Container パターンチェック

**親Skill**: architecture-patterns
**Phase**: 3/4
**判断ポイント**: サービス間の依存がDI経由か、直接importしていないか、循環依存がないか

## Purpose

brainbaseのDI Containerパターンへの準拠をチェックし、以下を判断する：
1. サービス間の依存がDI Container経由か
2. 直接importのアンチパターンがないか
3. 循環依存が発生していないか

## Thinking Framework（ベテランの判断ロジック）

### ベテラン開発者の判断

```
サービス間の依存が必要
  ↓
「DI Containerで解決すべき」
  ↓
constructor({ repository, eventBus }) {
  this.repository = repository;
  this.eventBus = eventBus;
}

const taskService = container.get('taskService');
  ↓
✅ テスト時のモック化が容易
✅ 循環依存を防止
```

### 新人開発者の判断

```
サービス間の依存が必要
  ↓
「とりあえず直接import」
  ↓
import { taskService } from './services/task.js';
  ↓
❌ 密結合
❌ テスト困難
```

→ **このSubagentでベテランの判断を再現**

## Process

### Step 1: サービス間の依存検出

**チェック対象パターン**:
```javascript
// Service内での他サービス使用
class TaskService {
  constructor({ repository, eventBus }) { ... }
}

// View内でのService使用
class TaskView {
  constructor({ service, eventBus }) { ... }
}
```

**Grepパターン**:
```bash
# constructorでの依存注入
grep -rn "constructor({" public/modules/domain/
grep -rn "constructor({" public/modules/views/
```

### Step 2: DI Container使用の確認

**期待されるパターン**:
```javascript
// Good: DI Container経由
const taskService = container.get('taskService');

// Good: DI Container登録
container.register('taskService', () => new TaskService({
  repository: container.get('taskRepository'),
  eventBus: container.get('eventBus')
}));
```

**Grepパターン**:
```bash
# DI Container使用を検出
grep -rn "container\.get\(" public/modules/
grep -rn "container\.register\(" public/app.js
```

### Step 3: アンチパターンの検出

**アンチパターン1: 直接import**
```javascript
// Bad: 直接import
import { taskService } from './services/task.js'; // ❌ 密結合
```

**Grepパターン**:
```bash
# 直接importを検出（Serviceの直接import）
grep -rn "import.*Service.*from" public/modules/
grep -rn "import.*Repository.*from" public/modules/
```

**アンチパターン2: 循環依存**
```javascript
// Bad: 循環依存
// task-service.js
import { sessionService } from './session-service.js';

// session-service.js
import { taskService } from './task-service.js'; // ❌ 循環依存
```

**検出方法**:
```bash
# importグラフを作成して循環検出
npm run check:circular-deps
# または手動でimport chainを追跡
```

### Step 4: 判断と修正提案

**判断ロジック**:
```
Service間の依存が見つかった
  ↓
constructor引数で受け取っているか？
  ↓ NO
  ├─→ Critical: 直接import
  │   └─→ 修正提案: DI経由に変更
  ↓ YES
container.get()で取得しているか？
  ↓ NO
  ├─→ Warning: DI未使用
  │   └─→ 修正提案: container.get()使用
  ↓ YES
循環依存はないか？
  ↓ YES
  ├─→ Critical: 循環依存
  │   └─→ 修正提案: EventBusで間接化
  ↓ NO
  └─→ ✅ 合格
```

## Expected Input

- **Phase 2の結果**: 累計違反件数（オプション）
- **ファイルパス**: チェック対象のファイル（オプション）

## Expected Output

```markdown
# Phase 3: DI Container パターンチェック結果

## ❌ Critical（必須修正）

### 直接import
- **ファイル**: `public/modules/views/task-list.js:3`
- **コード**: `import { taskService } from '../domain/task/task-service.js';`
- **問題**: Serviceを直接import（密結合）
- **修正提案**:
  ```javascript
  // Bad: 直接import
  import { taskService } from '../domain/task/task-service.js';

  // Good: DI Container経由
  import { container } from '/modules/core/di-container.js';

  class TaskList {
    constructor() {
      this.taskService = container.get('taskService');
    }
  }
  ```

### 循環依存
- **ファイル**: `public/modules/domain/task/task-service.js` ↔ `public/modules/domain/session/session-service.js`
- **問題**: task-service.js と session-service.js が相互にimport
- **修正提案**:
  ```javascript
  // Bad: 循環依存
  // task-service.js
  import { sessionService } from '../session/session-service.js';

  // Good: EventBusで間接化
  // task-service.js
  this.eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId });

  // session-service.js
  this.eventBus.on(EVENTS.SESSION_CHANGED, (event) => { ... });
  ```

## ⚠️ Warning（推奨修正）

### DI未使用
- **ファイル**: `public/app.js:45`
- **コード**: `const taskView = new TaskView(taskService);`
- **問題**: container.get()を使用していない
- **修正提案**:
  ```javascript
  // Bad: 直接new
  const taskView = new TaskView(taskService);

  // Good: DI Container経由
  const taskView = container.get('taskView');
  ```

## ✅ 合格

- `public/modules/domain/task/task-service.js`: DI経由、循環依存なし
- `public/app.js`: container.register使用

## サマリー

- **チェックファイル数**: 18
- **Critical**: 2件
- **Warning**: 1件
- **合格**: 15件

---
Phase 4へ渡すデータ:
- Critical違反: 2件（累計: 5件）
- Warning違反: 1件（累計: 3件）
```

## Success Criteria

- [ ] サービス間の依存を検出できた
- [ ] DI Container使用を確認できた
- [ ] 直接importアンチパターンを検出できた
- [ ] 循環依存を検出できた
- [ ] 修正提案が生成された
- [ ] Phase 4への引き継ぎデータが準備された

## DI Containerの登録パターン

```javascript
// public/app.js
function registerServices() {
  // Core
  container.register('eventBus', () => eventBus);
  container.register('store', () => appStore);

  // Repositories
  container.register('taskRepository', () => new TaskRepository());

  // Services
  container.register('taskService', () => new TaskService({
    repository: container.get('taskRepository'),
    store: container.get('store'),
    eventBus: container.get('eventBus')
  }));

  // Views
  container.register('taskView', () => new TaskView({
    service: container.get('taskService'),
    eventBus: container.get('eventBus')
  }));
}
```

## Skills Integration

このSubagentは独立動作（他のSkills使用なし）

## Troubleshooting

### 循環依存の誤検出

**原因**:
- importはあるが実際には使用していない

**対処**:
- 未使用importを削除（linter）
- 手動でimport chainを確認

### Core modulesの誤検出

**原因**:
- eventBus, storeなどのCore modulesも検出

**対処**:
- Core modules（core/配下）をホワイトリストに追加

## 次のステップ

Phase 4 Subagent（phase4_service_layer_checker.md）へ:
- 累計Critical違反件数を渡す
- 累計Warning違反件数を渡す
- Phase 4でService Layerチェック

---

最終更新: 2025-12-31
brainbase Architecture Patterns - DI Container Checker

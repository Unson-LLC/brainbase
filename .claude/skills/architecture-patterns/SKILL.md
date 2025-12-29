---
name: architecture-patterns
description: brainbaseのアーキテクチャパターン（Event-Driven, Reactive Store, DI Container, Service Layer）を強制する思考フレームワーク
setting_sources: ["user", "project"]
---

# brainbase Architecture Patterns

## Purpose

brainbaseの4つのコアパターンを開発時に強制し、設計一貫性を保つ。

**適用タイミング**:
- 新機能追加時
- 既存機能修正時
- コードレビュー時
- リファクタリング時

## Thinking Framework

### 1. Event-Driven Architecture

**思考パターン**:
- 状態変更が発生する → 「このEventをどう定義するか？」
- 他モジュールに通知が必要 → 「EventBusで発火するか？」
- 直接呼び出しを見つけた → 「Event経由に変更できないか？」

**判断基準**:
```javascript
// ✅ Good: EventBus使用
import { eventBus, EVENTS } from '/modules/core/event-bus.js';

// タスク完了時
eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: '123', project: 'brainbase' });

// 別モジュールでリスニング
eventBus.on(EVENTS.TASK_COMPLETED, (event) => {
  console.log('Task completed:', event.detail);
  // 他の処理（UI更新、通知等）
});

// ❌ Bad: 直接呼び出し
taskService.onComplete(taskId); // 密結合
```

**Why**:
- モジュール間の疎結合
- テスタビリティ向上（イベントリスナーをモック化可能）
- デバッグ容易性（イベントログで状態変化を追跡）

**利用可能なイベント**:
```javascript
// Task関連
EVENTS.TASK_LOADED          // タスク読み込み完了
EVENTS.TASK_COMPLETED       // タスク完了
EVENTS.TASK_UPDATED         // タスク更新
EVENTS.TASK_DELETED         // タスク削除
EVENTS.TASK_FILTER_CHANGED  // フィルタ変更

// Session関連
EVENTS.SESSION_LOADED       // セッション読み込み完了
EVENTS.SESSION_CHANGED      // セッション切り替え
EVENTS.SESSION_CREATED      // セッション作成
EVENTS.SESSION_ARCHIVED     // セッションアーカイブ
EVENTS.SESSION_DELETED      // セッション削除

// Schedule関連
EVENTS.SCHEDULE_LOADED      // スケジュール読み込み完了
EVENTS.SCHEDULE_UPDATED     // スケジュール更新

// Inbox関連
EVENTS.INBOX_LOADED         // Inbox読み込み完了
EVENTS.INBOX_ITEM_COMPLETED // Inbox項目完了
```

**ファイル**: `public/modules/core/event-bus.js`

---

### 2. Reactive Store Pattern

**思考パターン**:
- UI更新が必要 → 「Storeを更新すればUIが自動反映されるか？」
- データフローが複雑 → 「Storeで一元管理できないか？」
- DOM直接操作を見つけた → 「Store経由に変更できないか？」

**判断基準**:
```javascript
// ✅ Good: Store経由
import { appStore } from '/modules/core/store.js';

// 状態更新
appStore.setState({ currentSessionId: 'brainbase' });

// 状態購読（UI更新）
const unsubscribe = appStore.subscribe((change) => {
  if (change.key === 'currentSessionId') {
    console.log(`Session changed to: ${change.value}`);
    renderUI(); // UI更新
  }
});

// クリーンアップ
// unsubscribe();

// ❌ Bad: DOM直接操作
document.getElementById('session').textContent = 'brainbase'; // 状態とDOMが分離
```

**Why**:
- 予測可能なデータフロー（Single Source of Truth）
- UIとデータの分離（テスト容易性）
- デバッグ容易性（状態変化を一箇所で監視）

**Store構造**:
```javascript
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
    draggedSessionId: null,
    draggedSessionProject: null
  }
}
```

**ファイル**: `public/modules/core/store.js`

---

### 3. Dependency Injection Container

**思考パターン**:
- サービス間の依存が発生 → 「DI Containerで解決できるか？」
- テストでモックが必要 → 「DI Containerに登録されているか？」
- 循環依存を検出 → 「DI Containerで初期化順序を管理できないか？」

**判断基準**:
```javascript
// ✅ Good: DI Container経由
import { container } from '/modules/core/di-container.js';

// サービス登録（app.js）
container.register('taskService', () => new TaskService({
  repository: container.get('taskRepository'),
  store: container.get('store'),
  eventBus: container.get('eventBus')
}));

// サービス取得
const taskService = container.get('taskService');

// ❌ Bad: 直接import
import { taskService } from './services/task.js'; // 密結合、テスト困難
```

**Why**:
- テスト時のモック化が容易
- 循環依存の防止
- 初期化順序の自動管理
- シングルトンの保証

**登録パターン**:
```javascript
// app.js で一括登録
function registerServices() {
  // Core
  container.register('eventBus', () => eventBus);
  container.register('store', () => appStore);

  // Repositories
  container.register('taskRepository', () => new TaskRepository());
  container.register('sessionRepository', () => new SessionRepository());

  // Services
  container.register('taskService', () => new TaskService({
    repository: container.get('taskRepository'),
    store: container.get('store'),
    eventBus: container.get('eventBus')
  }));

  container.register('sessionService', () => new SessionService({
    repository: container.get('sessionRepository'),
    store: container.get('store'),
    eventBus: container.get('eventBus')
  }));

  // Views
  container.register('taskView', () => new TaskView({
    service: container.get('taskService'),
    eventBus: container.get('eventBus')
  }));

  container.register('sessionView', () => new SessionView({
    service: container.get('sessionService'),
    eventBus: container.get('eventBus')
  }));
}
```

**ファイル**: `public/modules/core/di-container.js`

---

### 4. Service Layer Pattern

**思考パターン**:
- ビジネスロジックを書く → 「Serviceレイヤに配置されているか？」
- UI Componentが肥大化 → 「ロジックをServiceに抽出できないか？」
- データアクセスロジック → 「Repositoryレイヤに分離されているか？」

**判断基準**:
```javascript
// ✅ Good: Service Layer Pattern
// public/modules/domain/task/task-service.js
export class TaskService {
  constructor({ repository, store, eventBus }) {
    this.repository = repository;
    this.store = store;
    this.eventBus = eventBus;
  }

  async getTasks(filters) {
    // Repository経由でデータ取得
    const tasks = await this.repository.fetchTasks();

    // ビジネスロジック（フィルタリング）
    const filtered = this._applyFilters(tasks, filters);

    // Store更新
    this.store.setState({ tasks: filtered });

    // Event発火
    this.eventBus.emit(EVENTS.TASK_LOADED, { tasks: filtered });

    return filtered;
  }

  async completeTask(id) {
    // Repository経由でデータ更新
    await this.repository.updateTask(id, { status: 'completed' });

    // Event発火
    this.eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: id });
  }

  _applyFilters(tasks, filters) {
    // ビジネスロジック
    return tasks.filter(task => {
      if (filters.status && task.status !== filters.status) return false;
      if (filters.project && task.project !== filters.project) return false;
      return true;
    });
  }
}

// ❌ Bad: ロジックがView層に混在
class TaskView {
  async loadTasks() {
    // データ取得、フィルタリング、UI更新が混在 ❌
    const response = await fetch('/api/tasks');
    const tasks = await response.json();
    const filtered = tasks.filter(t => t.status === 'pending');
    this.renderTasks(filtered);
  }
}
```

**Why**:
- 関心の分離（UI、ビジネスロジック、データアクセス）
- テスタビリティ（Service層を単体テスト可能）
- 再利用性（複数のViewから同じServiceを利用）

**レイヤ構造**:
```
UI Components (View)
    ↓ ServiceをDI経由で取得
Services (Business Logic)
    ↓ RepositoryをDI経由で取得
Repositories (Data Access)
    ↓ APIコール、ローカルストレージアクセス
EventBus (Cross-Cutting)
    ← すべてのレイヤから発火可能
```

**ディレクトリ構造**:
```
public/modules/domain/
├── task/
│   ├── task-service.js      # ビジネスロジック
│   └── task-repository.js   # データアクセス
├── session/
│   ├── session-service.js
│   └── session-repository.js
└── schedule/
    └── schedule-service.js
```

---

## Usage

このSkillは以下のタイミングで使用される:

1. **コード実装時**: 新規機能追加・既存機能修正
2. **コードレビュー時**: PR作成時に準拠確認
3. **リファクタリング時**: 既存コードをパターンに適合

**使用例**:

```
User: "タスク削除機能を追加したい"

Claude Code: [architecture-patterns Skillを装備]

思考プロセス:
1. Event-Driven: タスク削除時に TASK_DELETED イベントを発火する必要がある
2. Store: タスク一覧から削除したタスクを除外してStoreを更新する
3. DI Container: TaskService, TaskRepository をDI経由で取得
4. Service Layer: ビジネスロジックはTaskServiceに、データアクセスはTaskRepositoryに配置

実装:
- TaskService.deleteTask() メソッド追加
- TaskRepository.deleteTask() メソッド追加
- EVENTS.TASK_DELETED イベント定義追加
- UI: TaskViewでイベントをリスニングしてUI更新
```

---

## Success Criteria

- [ ] すべての状態変更がEventとして発火されている
- [ ] UI更新がReactive Store経由で行われている
- [ ] サービス間の依存がDI Containerで解決されている
- [ ] ビジネスロジックがServiceレイヤに配置されている
- [ ] レイヤ間の依存方向が正しい（UI → Service → Repository → EventBus）
- [ ] 直接import、直接呼び出し、DOM直接操作が0件
- [ ] 循環依存が0件

---

## Enforcement

### Local
- このSkillを装備したClaude Codeが自動チェック
- コーディング中にパターン違反を指摘

### CI
- GitHub Actions で `architecture-check.yml` が実行
- PRマージ前にパターン準拠を強制

**チェック項目**:
```bash
# EventBus usage: 直接呼び出しを検出
grep -rn "import.*Service.*from" public/modules --include="*.js" | grep -v "container.get"

# Store usage: DOM直接操作を検出
grep -rn "\.innerHTML\s*=" public/modules --include="*.js" | grep -v "DOMPurify"

# DI Container usage: 直接instantiationを検出
grep -rn "new.*Service\(" public/modules --include="*.js"
```

---

## Troubleshooting

### 問題1: EventBusが動作しない

**症状**: イベントを発火してもリスナーが反応しない

**原因**:
- イベント名の綴り間違い
- リスナー登録前にイベント発火

**対処**:
```javascript
// ❌ Bad: イベント名の綴り間違い
eventBus.emit('task:complete', { taskId }); // 'task:completed' が正しい

// ✅ Good: EVENTS定数を使用（タイポ防止）
eventBus.emit(EVENTS.TASK_COMPLETED, { taskId });

// ❌ Bad: リスナー登録前に発火
eventBus.emit(EVENTS.TASK_LOADED, { tasks });
eventBus.on(EVENTS.TASK_LOADED, handler); // 遅い

// ✅ Good: リスナー登録後に発火
eventBus.on(EVENTS.TASK_LOADED, handler);
eventBus.emit(EVENTS.TASK_LOADED, { tasks });
```

---

### 問題2: Store更新がUI反映されない

**症状**: `appStore.setState()` を呼んでもUIが更新されない

**原因**:
- `subscribe()` が呼ばれていない
- レンダリング関数が呼ばれていない

**対処**:
```javascript
// ❌ Bad: subscribeせずにgetStateのみ
const state = appStore.getState();
console.log(state.tasks); // 初回のみ取得

// ✅ Good: subscribeしてUI更新
appStore.subscribe((change) => {
  if (change.key === 'tasks') {
    renderTasks(change.value);
  }
});
```

---

### 問題3: 循環依存エラー

**症状**: `Cannot access 'X' before initialization`

**原因**:
- DI Containerを使わずに直接import
- サービス間で相互依存

**対処**:
```javascript
// ❌ Bad: 循環依存
// task-service.js
import { sessionService } from './session-service.js';

// session-service.js
import { taskService } from './task-service.js'; // 循環！

// ✅ Good: DI Container経由
// task-service.js
export class TaskService {
  constructor({ container }) {
    this.container = container;
  }

  getSessionService() {
    return this.container.get('sessionService'); // lazy取得
  }
}
```

---

### 問題4: Service層が肥大化

**症状**: TaskServiceが1000行を超える

**原因**:
- すべてのロジックを1つのServiceに集約
- ドメイン分割が不十分

**対処**:
```javascript
// ❌ Bad: すべてのロジックをTaskServiceに
class TaskService {
  async getTasks() { }
  async completeTask() { }
  async deleteTask() { }
  async archiveTask() { }
  async filterByProject() { }
  async filterByStatus() { }
  async sortByDue() { }
  // ... 100+ methods
}

// ✅ Good: ドメイン別に分割
// task-service.js (CRUD)
class TaskService {
  async getTasks() { }
  async createTask() { }
  async updateTask() { }
  async deleteTask() { }
}

// task-filter-service.js (フィルタリング)
class TaskFilterService {
  filterByProject() { }
  filterByStatus() { }
  filterByDue() { }
}

// task-archive-service.js (アーカイブ)
class TaskArchiveService {
  archiveTask() { }
  unarchiveTask() { }
  getArchivedTasks() { }
}
```

---

## References

### 内部ドキュメント
- [CLAUDE.md](../../CLAUDE.md): 開発標準全体
- [docs/REFACTORING_PLAN.md](../../docs/REFACTORING_PLAN.md): リファクタリング詳細

### コアファイル
- `public/modules/core/event-bus.js`: EventBus実装
- `public/modules/core/store.js`: Reactive Store実装
- `public/modules/core/di-container.js`: DI Container実装

### 参考実装
- `public/modules/domain/task/task-service.js`: Service Layer実装例
- `public/modules/domain/task/task-repository.js`: Repository Layer実装例

---

**最終更新**: 2025-12-29
**M5.3 - Development Workflow Standardization**
**Week 2 Day 1: architecture-patterns Skill**

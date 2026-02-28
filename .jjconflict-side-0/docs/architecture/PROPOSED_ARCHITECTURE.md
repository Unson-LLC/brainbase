# brainbase-ui 新アーキテクチャ設計書

**バージョン**: v0.2.0
**作成日**: 2025-12-22

---

## 目次

1. [アーキテクチャ概要](#アーキテクチャ概要)
2. [レイヤー構造](#レイヤー構造)
3. [データフロー](#データフロー)
4. [主要コンポーネント](#主要コンポーネント)
5. [状態管理](#状態管理)
6. [イベントシステム](#イベントシステム)
7. [依存関係管理](#依存関係管理)

---

## アーキテクチャ概要

### パターン

**Event-Driven Architecture + Service Layer Pattern**

```
┌─────────────────────────────────────────────────────────────┐
│                     Presentation Layer                       │
│                    (UI Components/Views)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  TaskView    │  │ SessionView  │  │ TimelineView │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                      Event Bus Layer                         │
│              (Publish/Subscribe Communication)               │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    Business Logic Layer                      │
│                     (Domain Services)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ TaskService  │  │SessionService│  │ScheduleService│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    Data Access Layer                         │
│                      (Repositories)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  TaskRepo    │  │ SessionRepo  │  │ ScheduleRepo │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                       HTTP/API Layer                         │
│                     (Backend Server)                         │
└─────────────────────────────────────────────────────────────┘
```

### 設計原則

1. **単一責任の原則**: 各モジュールは1つの責務のみを持つ
2. **疎結合**: Event Busによるコンポーネント間通信
3. **高凝集**: 関連する機能を同じモジュールに配置
4. **依存性逆転**: 抽象に依存し、具象に依存しない
5. **テスタビリティ**: DI活用による単体テスト容易性

---

## レイヤー構造

### 1. Presentation Layer（プレゼンテーション層）

**責務**: UIレンダリングとユーザーインタラクション

**構成要素**:
- **Views**: ページレベルのコンポーネント
- **Components**: 再利用可能なUIパーツ
- **Renderers**: 純粋な描画関数

**ルール**:
- ビジネスロジックを含まない
- Service層を通じてデータアクセス
- Event Busで状態変更を購読

```
ui/
├── views/              # ページレベルビュー
│   ├── task-view.js
│   ├── session-view.js
│   └── timeline-view.js
├── components/         # 再利用可能コンポーネント
│   ├── toast.js
│   ├── modal.js
│   └── confirm-dialog.js
└── renderers/          # 純粋レンダリング関数
    ├── task-renderer.js
    └── session-renderer.js
```

### 2. Event Bus Layer（イベントバス層）

**責務**: コンポーネント間の疎結合な通信

**構成要素**:
- **EventBus**: グローバルイベントディスパッチャー
- **EVENTS**: イベント名定数

**ルール**:
- すべての状態変更はイベントとして発行
- 各コンポーネントは関心のあるイベントのみ購読
- イベントペイロードは不変オブジェクト

```javascript
// イベント発行
eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: 'task-123' });

// イベント購読
eventBus.on(EVENTS.TASK_COMPLETED, ({ detail }) => {
    console.log('Task completed:', detail.taskId);
});
```

### 3. Business Logic Layer（ビジネスロジック層）

**責務**: アプリケーションのビジネスルール実行

**構成要素**:
- **Services**: ドメインロジックのカプセル化

**ルール**:
- UI層から独立
- Repository経由でデータアクセス
- 複雑な計算や変換を実行
- 状態変更時はEvent発行

```
domain/
├── task/
│   ├── task-service.js
│   └── task-repository.js
├── session/
│   ├── session-service.js
│   └── session-repository.js
└── schedule/
    └── schedule-service.js
```

### 4. Data Access Layer（データアクセス層）

**責務**: 外部データソースへのアクセス

**構成要素**:
- **Repositories**: データ取得・保存の抽象化

**ルール**:
- APIやファイルI/Oの詳細を隠蔽
- Service層に対してシンプルなインターフェース提供
- データの変換やキャッシングを担当

```javascript
// Repository Interface
class TaskRepository {
    async findAll()
    async findById(id)
    async create(data)
    async update(id, data)
    async delete(id)
}
```

---

## データフロー

### ユーザーアクション → 状態更新フロー

```
[User Click]
    ↓
[View Event Handler]
    ↓
[Service Method Call]
    ↓
[Repository Data Access]
    ↓
[API Request]
    ↓
[API Response]
    ↓
[Repository Return Data]
    ↓
[Service Update Store]
    ↓
[Service Emit Event]
    ↓
[View Receives Event]
    ↓
[View Re-render]
    ↓
[UI Updated]
```

### 具体例: タスク完了フロー

```javascript
// 1. User Click
<button data-action="complete" data-task-id="task-123">Complete</button>

// 2. View Event Handler
async handleComplete(taskId) {
    await this.taskService.completeTask(taskId);
}

// 3. Service Method
async completeTask(taskId) {
    // 4. Repository Data Access & 5. API Request
    await this.repository.completeTask(taskId);

    // 6-7. Repository Return & Service Update Store
    const tasks = await this.repository.findAll();
    this.store.setState({ tasks });

    // 8. Service Emit Event
    this.eventBus.emit(EVENTS.TASK_COMPLETED, { taskId });
}

// 9. View Receives Event & 10. View Re-render
this.eventBus.on(EVENTS.TASK_COMPLETED, () => {
    this.render(); // 11. UI Updated
});
```

---

## 主要コンポーネント

### Event Bus

**ファイル**: `public/modules/core/event-bus.js`

```javascript
class EventBus extends EventTarget {
    emit(eventName, detail)
    on(eventName, callback)
    off(eventName, callback)
}
```

**特徴**:
- Native EventTargetを継承（軽量）
- カスタムイベントでデータ伝播
- メモリリーク防止のためoff()を提供

**使用例**:
```javascript
// グローバルインスタンス
import { eventBus, EVENTS } from './modules/core/event-bus.js';

// イベント発行
eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: 'abc' });

// イベント購読
const unsubscribe = eventBus.on(EVENTS.TASK_COMPLETED, handler);

// 購読解除
unsubscribe();
```

---

### Reactive Store

**ファイル**: `public/modules/core/store.js`

```javascript
class Store {
    constructor(initialState)
    getState()
    setState(updates)
    subscribe(listener)
}
```

**特徴**:
- Proxyベースの変更検知
- 不変性を強制しない（パフォーマンス優先）
- 購読者への自動通知

**状態構造**:
```javascript
{
    sessions: [],           // セッション一覧
    currentSessionId: null, // 現在のセッションID
    tasks: [],              // タスク一覧
    schedule: null,         // スケジュール
    inbox: [],              // 受信トレイ
    filters: {
        taskFilter: '',     // タスク検索フィルター
        showAllTasks: false // 完了タスク表示フラグ
    },
    ui: {
        inboxOpen: false,   // 受信トレイの開閉状態
        draggedSessionId: null,
        draggedSessionProject: null
    }
}
```

**使用例**:
```javascript
import { appStore } from './modules/core/store.js';

// 状態更新
appStore.setState({ currentSessionId: 'session-123' });

// 状態取得
const { tasks } = appStore.getState();

// 変更購読
appStore.subscribe(({ key, value, oldValue }) => {
    console.log(`${key} changed from ${oldValue} to ${value}`);
});
```

---

### DI Container

**ファイル**: `public/modules/core/di-container.js`

```javascript
class DIContainer {
    register(name, factory)
    get(name)
    has(name)
}
```

**特徴**:
- シングルトンインスタンス管理
- 遅延初期化（Lazy Initialization）
- 循環依存の検出（将来実装）

**使用例**:
```javascript
const container = new DIContainer();

// サービス登録
container.register('taskService', (c) =>
    new TaskService({
        repository: c.get('taskRepository'),
        store: c.get('store')
    })
);

// サービス取得
const taskService = container.get('taskService');
```

---

### HTTP Client

**ファイル**: `public/modules/core/http-client.js`

```javascript
class HttpClient {
    constructor(baseURL)
    request(url, options)
    get(url, options)
    post(url, data, options)
    patch(url, data, options)
    delete(url, options)
}
```

**特徴**:
- fetchのラッパー
- デフォルトヘッダー設定
- エラーハンドリング統一
- JSONシリアライズ自動化

**使用例**:
```javascript
import { httpClient } from './modules/core/http-client.js';

// GET
const tasks = await httpClient.get('/tasks');

// POST
const newTask = await httpClient.post('/tasks', {
    title: 'New Task',
    priority: 'high'
});

// PATCH
await httpClient.patch('/tasks/123', { status: 'done' });

// DELETE
await httpClient.delete('/tasks/123');
```

---

### TaskView

**ファイル**: `public/modules/ui/views/task-view.js`

```javascript
class TaskView {
    constructor({ taskService })
    mount(element)
    setupEventListeners()
    render()
    handleComplete(taskId)
}
```

**責務**:
- タスクUIのレンダリング
- ユーザーインタラクション処理
- イベント購読と再描画

**ライフサイクル**:
1. インスタンス作成（コンストラクタ）
2. イベント購読登録
3. mount()でDOMに配置
4. setupEventListeners()でイベント委譲
5. render()で初回描画
6. イベント受信時に自動再描画

**使用例**:
```javascript
const taskView = new TaskView({
    taskService: container.get('taskService')
});

taskView.mount(document.getElementById('task-container'));
```

---

### TaskService

**ファイル**: `public/modules/domain/task/task-service.js`

```javascript
class TaskService {
    constructor()
    async loadTasks()
    async completeTask(taskId)
    getFilteredTasks()
    getFocusTask()
}
```

**責務**:
- タスクのビジネスロジック
- フィルタリング・ソート
- Repository経由のデータアクセス
- 状態更新とイベント発行

**メソッド詳細**:

#### loadTasks()
```javascript
async loadTasks() {
    const tasks = await httpClient.get('/tasks');
    this.store.setState({ tasks });
    this.eventBus.emit(EVENTS.TASK_LOADED, { tasks });
    return tasks;
}
```

#### completeTask(taskId)
```javascript
async completeTask(taskId) {
    await httpClient.post(`/tasks/${taskId}/complete`);
    await this.loadTasks(); // リロード
    this.eventBus.emit(EVENTS.TASK_COMPLETED, { taskId });
}
```

#### getFilteredTasks()
```javascript
getFilteredTasks() {
    const { tasks, filters } = this.store.getState();
    let filtered = tasks;

    if (filters.taskFilter) {
        filtered = filtered.filter(t =>
            t.title.includes(filters.taskFilter)
        );
    }

    if (!filters.showAllTasks) {
        filtered = filtered.filter(t => t.status !== 'done');
    }

    return this._sortByPriority(filtered);
}
```

---

## 状態管理

### 状態の分類

#### 1. アプリケーション状態（Global State）

**管理**: Reactive Store（appStore）

**内容**:
- sessions: セッション一覧
- tasks: タスク一覧
- schedule: スケジュールデータ
- inbox: 受信トレイアイテム

**アクセス**:
```javascript
const { tasks, currentSessionId } = appStore.getState();
appStore.setState({ currentSessionId: 'session-123' });
```

#### 2. UI状態（UI State）

**管理**: Reactive Store（appStore.ui）

**内容**:
- inboxOpen: 受信トレイの開閉
- draggedSessionId: ドラッグ中のセッション
- モーダルの表示状態

**アクセス**:
```javascript
appStore.setState({
    ui: { ...appStore.getState().ui, inboxOpen: true }
});
```

#### 3. ローカル状態（Component State）

**管理**: コンポーネント内部

**内容**:
- 入力フォームの値
- アニメーション状態
- 一時的なフラグ

**アクセス**:
```javascript
class TaskView {
    constructor() {
        this.isSubmitting = false; // ローカル状態
    }
}
```

### 状態更新フロー

```
User Action
    ↓
View Method
    ↓
Service Method
    ↓
Store.setState()
    ↓
Store Notify Subscribers
    ↓
Event Bus Emit
    ↓
View Receives Event
    ↓
View Re-render
```

---

## イベントシステム

### イベント命名規則

```
{entity}:{action}
```

**例**:
- `task:loaded` - タスク読み込み完了
- `task:completed` - タスク完了
- `session:changed` - セッション変更
- `filter:changed` - フィルター変更

### イベント一覧

```javascript
export const EVENTS = {
    // Task
    TASK_LOADED: 'task:loaded',
    TASK_COMPLETED: 'task:completed',
    TASK_UPDATED: 'task:updated',
    TASK_DELETED: 'task:deleted',
    TASK_FILTER_CHANGED: 'task:filter-changed',

    // Session
    SESSION_LOADED: 'session:loaded',
    SESSION_CHANGED: 'session:changed',
    SESSION_CREATED: 'session:created',
    SESSION_ARCHIVED: 'session:archived',

    // Schedule
    SCHEDULE_LOADED: 'schedule:loaded',
    SCHEDULE_UPDATED: 'schedule:updated',

    // Inbox
    INBOX_LOADED: 'inbox:loaded',
    INBOX_ITEM_COMPLETED: 'inbox:item-completed'
};
```

### イベントペイロード

**ルール**:
- 常に`{ detail: {...} }`の形式
- 不変オブジェクト（変更不可）
- 最小限の情報（IDのみ、または変更データ）

**例**:
```javascript
// Good
eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: 'task-123' });

// Bad（大きすぎるペイロード）
eventBus.emit(EVENTS.TASK_COMPLETED, {
    task: { ...全データ... },
    allTasks: [...],
    session: {...}
});
```

---

## 依存関係管理

### 依存関係グラフ

```
app.js
  ├─→ DIContainer
  ├─→ TaskView
  │    ├─→ TaskService
  │    │    ├─→ HttpClient
  │    │    ├─→ EventBus
  │    │    └─→ Store
  │    └─→ EventBus
  ├─→ SessionView
  │    ├─→ SessionService
  │    └─→ EventBus
  └─→ TimelineView
       ├─→ ScheduleService
       └─→ EventBus
```

### 依存関係のルール

1. **上位層は下位層に依存可能**
   - View → Service → Repository

2. **下位層は上位層に依存不可**
   - Repository ✗→ Service
   - Service ✗→ View

3. **同レベル間の依存は禁止**
   - TaskView ✗→ SessionView
   - TaskService ✗→ SessionService

4. **Event Busのみ例外**
   - すべての層がEvent Busに依存可能
   - Event Bus経由で間接的に通信

---

## サーバーサイドアーキテクチャ

### レイヤー構造

```
Request
  ↓
Routes (ルーティング)
  ↓
Controllers (リクエスト処理)
  ↓
Services (ビジネスロジック)
  ↓
Repositories (データアクセス)
  ↓
Parsers (ファイルI/O)
```

### ディレクトリ構造

```
brainbase-ui/
├── server.js (200行)
├── routes/
│   ├── index.js
│   ├── tasks.js
│   ├── sessions.js
│   └── schedule.js
├── controllers/
│   ├── task-controller.js
│   ├── session-controller.js
│   └── schedule-controller.js
├── services/
│   ├── task-service.js
│   ├── session-service.js
│   └── schedule-service.js
├── repositories/
│   ├── task-repository.js
│   └── state-repository.js
├── middleware/
│   ├── error-handler.js
│   ├── cache-control.js
│   └── logger.js
└── lib/
    └── parsers/
        ├── task-parser.js
        ├── schedule-parser.js
        └── config-parser.js
```

### サーバーサイドDI

```javascript
// server.js
const container = new DIContainer();

// Parsers
container.register('taskParser', () => new TaskParser(TASKS_FILE));

// Repositories
container.register('taskRepository', (c) =>
    new TaskRepository({ taskParser: c.get('taskParser') })
);

// Services
container.register('taskService', (c) =>
    new TaskService({ taskRepository: c.get('taskRepository') })
);

// Controllers
container.register('taskController', (c) =>
    new TaskController({ taskService: c.get('taskService') })
);
```

---

## パフォーマンス最適化

### 1. イベントリスナーの最適化

**イベント委譲の活用**:
```javascript
// Bad: 各要素にリスナー登録
tasks.forEach(task => {
    const btn = document.querySelector(`#task-${task.id}`);
    btn.addEventListener('click', () => completeTask(task.id));
});

// Good: 親要素で委譲
container.addEventListener('click', (e) => {
    if (e.target.dataset.action === 'complete') {
        completeTask(e.target.dataset.taskId);
    }
});
```

### 2. 再レンダリングの最小化

**仮想DOM的アプローチ**:
```javascript
// 将来的な改善案
class TaskView {
    render() {
        const newHTML = this.generateHTML();
        if (newHTML !== this.lastHTML) {
            this.container.innerHTML = newHTML;
            this.lastHTML = newHTML;
        }
    }
}
```

### 3. メモ化

```javascript
import { memoize } from './utils/memoize.js';

const expensiveFilter = memoize((tasks, filter) => {
    return tasks.filter(t => t.title.includes(filter));
});
```

---

## テスト戦略

### テストピラミッド

```
        /\
       /E2E\      (5%)
      /------\
     /  API   \   (15%)
    /----------\
   / Unit Tests \ (80%)
  /--------------\
```

### ユニットテスト（Vitest）

**対象**:
- Service層の純粋関数
- Renderer関数
- Utility関数

**例**:
```javascript
// tests/domain/task/task-service.test.js
import { describe, it, expect } from 'vitest';
import { TaskService } from '../../../public/modules/domain/task/task-service.js';

describe('TaskService', () => {
    it('should filter tasks by title', () => {
        const service = new TaskService();
        // テストロジック
    });
});
```

### 統合テスト

**対象**:
- View + Service の連携
- API エンドポイント

### E2Eテスト（Playwright）

**対象**:
- 主要ユーザーフロー
- タスク完了フロー
- セッション切り替えフロー

---

## マイグレーション戦略

### 段階的移行

**Phase 1**: インフラ整備
- Event Bus, Store, DI Container導入
- 既存コードと並行稼働

**Phase 2**: クライアント分割
- TaskView, SessionView作成
- 徐々に旧コードから機能移行

**Phase 3**: サーバー分割
- MVC構造に分割
- 旧server.jsから機能移行

### 互換性レイヤー

一時的に新旧コードを橋渡しするアダプター:
```javascript
// legacy-adapter.js
export function bridgeOldToNew() {
    // 旧グローバル変数を新Storeに同期
    window.addEventListener('taskUpdated', () => {
        appStore.setState({ tasks: window.tasks });
    });
}
```

---

## 今後の拡張性

### Web Components化

将来的にはWeb Componentsへの移行を検討:
```javascript
class TaskListElement extends HTMLElement {
    connectedCallback() {
        this.render();
    }
}
customElements.define('task-list', TaskListElement);
```

### TypeScript移行

型安全性向上のためのTypeScript化:
```typescript
interface Task {
    id: string;
    title: string;
    priority: 'high' | 'medium' | 'low';
    status: 'todo' | 'doing' | 'done';
}

class TaskService {
    async loadTasks(): Promise<Task[]> {
        // ...
    }
}
```

### バンドル最適化

Viteによるビルド最適化:
- コード分割
- ツリーシェイキング
- 動的インポート

---

**作成者**: Claude (brainbase AI)
**最終更新**: 2025-12-22

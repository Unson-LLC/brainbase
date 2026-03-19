# brainbase-ui リファクタリング計画書

**作成日**: 2025-12-22
**対象バージョン**: v0.1.35
**目標**: app.js (2,203行) と server.js (1,384行) の密結合を解消し、保守性・拡張性の高いアーキテクチャへ移行

---

## 📋 目次

1. [背景と目的](#背景と目的)
2. [現状分析](#現状分析)
3. [あるべき姿](#あるべき姿)
4. [移行戦略](#移行戦略)
5. [Phase 1: インフラ整備](#phase-1-インフラ整備)
6. [Phase 2: クライアント側分割](#phase-2-クライアント側分割)
7. [Phase 3: サーバー側分割](#phase-3-サーバー側分割)
8. [リスクと対策](#リスクと対策)
9. [成功指標](#成功指標)

---

## 背景と目的

### 現在の課題

**以前のリファクタリング（900行まで削減）の限界**
- app.jsを900行まで削減したが、それ以上は分割不可能
- 理由: グローバル変数への強い依存、循環参照、状態とレンダリングの混在

**コードメトリクス**
```
app.js          : 2,203行（全体の32%）
server.js       : 1,384行
cyclomatic complexity:
  - app.js      : ~120
  - server.js   : ~45
```

### 目的

1. **保守性の向上**: 各モジュールを200行以内に抑え、理解しやすいコードベースへ
2. **テスト可能性**: 純粋関数とDIによる単体テスト可能な設計
3. **拡張性**: 新機能追加時の影響範囲を最小化
4. **パフォーマンス**: 不要な再レンダリングの削減

---

## 現状分析

### 密結合の根本原因

#### 1. グローバル状態の多層構造

**app.js内のグローバル変数（30+個）**
```javascript
// DOMContentLoaded内でスコープされているが実質グローバル
let sessions = [];
let currentSessionId = null;
let tasks = [];
let schedule = null;
let showAllTasks = false;
let taskFilter = '';
// ... 他24個
```

**問題点**:
- これらの変数が相互に参照し合う「密結合の網」を形成
- 関数を分離しても変数へのアクセスで依存が残る
- 状態変更の追跡が困難（どこでどう変更されたかわからない）

#### 2. 循環依存パターン

```
loadSessions()
  → renderSessionList() (328行)
    → switchSession()
      → loadSessions() ★循環

loadTasks()
  → renderRightPanel()
    → renderFocusTask()
      → startTaskSession()
        → updateTaskStatus()
          → loadTasks() ★循環
```

**問題点**:
- renderSessionList()単独で328行（分離不可能）
- 20+個のイベントリスナーを内包
- 呼び出される度に全イベントリスナーが再登録（メモリリーク）

#### 3. DOM更新と状態の二重管理

```javascript
// 現状の問題
renderSessionList() {
    sessionList.innerHTML = ''; // DOM全削除
    sessions.forEach(session => {
        // DOM生成
        // イベントリスナー登録（20+個）
    });
    lucide.createIcons(); // 全アイコン再スキャン
}
```

**問題点**:
- 状態変更 → DOM全削除 → 再構築 → イベント再登録の繰り返し
- GC負荷とパフォーマンス劣化
- 状態とDOMが同期していない瞬間がある（race condition）

#### 4. server.jsの肥大化

**単一ファイルに60+個のAPIルート**
```javascript
app.get('/api/tasks', ...)
app.post('/api/tasks/:id/complete', ...)
app.get('/api/sessions', ...)
app.post('/api/sessions/start', ...)
// ... 計60+個
```

**問題点**:
- ルーティング、ビジネスロジック、データアクセスが混在
- 責務の分離ができていない
- テストが困難

### コード重複の検出結果

| パターン | 発生箇所数 | 改善案 |
|---------|-----------|--------|
| `escapeHtml()` | 2箇所（app.js, ui-helpers.js） | app.jsから削除 |
| fetch() ボイラープレート | 60+箇所 | HttpClient作成 |
| キャッシュヘッダー設定 | 3箇所（server.js） | ミドルウェア化 |
| DOM querySelector | 164箇所 | DOMManagerで一元化 |
| addEventListener | 43箇所 | イベント委譲パターン |

---

## あるべき姿

### 新アーキテクチャ概要

**Event-Driven + Service Layer Pattern**

```
┌─────────────────────────────────────┐
│      app.js (100行以内)              │
│  ・DIコンテナ設定                     │
│  ・ビューのマウント                   │
│  ・初期データロード                   │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│    Event Bus (イベント駆動基盤)       │
│  ・状態変更をpublish/subscribe       │
│  ・グローバル変数の排除               │
└─────────────────────────────────────┘
       ↓           ↓           ↓
┌──────────┐ ┌──────────┐ ┌──────────┐
│ TaskView │ │SessionView│ │Timeline  │
│ (150行)  │ │ (150行)  │ │View      │
│          │ │          │ │ (100行)  │
└──────────┘ └──────────┘ └──────────┘
       ↓           ↓           ↓
┌─────────────────────────────────────┐
│   Service Layer (ビジネスロジック)    │
│ TaskService │ SessionService │ etc  │
└─────────────────────────────────────┘
       ↓           ↓           ↓
┌─────────────────────────────────────┐
│  Repository Layer (データアクセス)    │
│ TaskRepo │ SessionRepo │ etc        │
└─────────────────────────────────────┘
```

### 主要コンポーネント

#### 1. Event Bus (core/event-bus.js)
```javascript
class EventBus extends EventTarget {
    emit(eventName, detail)
    on(eventName, callback)
    off(eventName, callback)
}
```

**役割**: コンポーネント間の疎結合な通信

#### 2. Reactive Store (core/store.js)
```javascript
class Store {
    constructor(initialState)
    subscribe(listener)
    getState()
    setState(updates)
}
```

**役割**: アプリケーション状態の一元管理と変更通知

#### 3. DI Container (core/di-container.js)
```javascript
class DIContainer {
    register(name, factory)
    get(name)
}
```

**役割**: 依存関係の明示的な管理

#### 4. View Components (ui/views/*.js)
```javascript
class TaskView {
    constructor({ taskService, eventBus })
    mount(element)
    render()
    setupEventListeners()
}
```

**役割**: UIレンダリングとユーザーインタラクション

#### 5. Service Layer (domain/*/service.js)
```javascript
class TaskService {
    constructor({ repository, store, eventBus })
    async getTasks(filters)
    async completeTask(id)
}
```

**役割**: ビジネスロジックの実行

### ディレクトリ構造

**クライアント側（public/）**
```
public/
├── app.js (100行) ← エントリーポイント
├── modules/
│   ├── core/                    # コアシステム
│   │   ├── event-bus.js
│   │   ├── di-container.js
│   │   ├── store.js
│   │   └── http-client.js
│   ├── domain/                  # ドメインロジック
│   │   ├── task/
│   │   │   ├── task-service.js
│   │   │   └── task-repository.js
│   │   ├── session/
│   │   │   ├── session-service.js
│   │   │   └── session-repository.js
│   │   └── schedule/
│   │       └── schedule-service.js
│   ├── ui/                      # UI Components
│   │   ├── views/               # ページレベル
│   │   │   ├── task-view.js
│   │   │   ├── session-view.js
│   │   │   └── timeline-view.js
│   │   ├── components/          # 再利用可能
│   │   │   ├── toast.js
│   │   │   ├── modal.js
│   │   │   └── confirm-dialog.js
│   │   └── renderers/           # 純粋レンダリング
│   │       ├── task-renderer.js
│   │       └── session-renderer.js
│   └── utils/
│       ├── dom-helpers.js
│       └── validators.js
└── styles/
```

**サーバー側（brainbase-ui/）**
```
brainbase-ui/
├── server.js (200行) ← エントリーポイント
├── routes/                      # ルート定義
│   ├── index.js
│   ├── tasks.js
│   ├── sessions.js
│   └── schedule.js
├── controllers/                 # リクエスト処理
│   ├── task-controller.js
│   ├── session-controller.js
│   └── schedule-controller.js
├── services/                    # ビジネスロジック
│   ├── task-service.js
│   ├── session-service.js
│   └── schedule-service.js
├── repositories/                # データアクセス
│   ├── task-repository.js
│   └── state-repository.js
├── middleware/                  # ミドルウェア
│   ├── error-handler.js
│   ├── cache-control.js
│   └── logger.js
└── lib/                         # 既存のパーサー等
    └── parsers/
```

---

## 移行戦略

### 原則

1. **段階的移行**: 一度に全てを書き換えない
2. **互換性維持**: 各フェーズで動作する状態を保つ
3. **テスト駆動**: 新モジュールには必ずテストを追加
4. **ドキュメント更新**: コード変更と同時にドキュメント更新

### ブランチ戦略

```
main (production)
  ↓
  refactor/architecture-v2 (統合ブランチ)
    ↓
    ├── refactor/phase1-infrastructure
    ├── refactor/phase2-client-views
    └── refactor/phase3-server-mvc
```

### ロールバック計画

各フェーズ完了時にタグを打つ:
- `v0.2.0-phase1-complete`
- `v0.2.0-phase2-complete`
- `v0.2.0-phase3-complete`

問題発生時は該当タグに戻す。

---

## Phase 1: インフラ整備

**期間**: 2-3日
**目標**: Event Bus, Store, DI Containerの導入

### 1.1 Event Bus実装

**ファイル**: `public/modules/core/event-bus.js`

```javascript
/**
 * アプリケーション全体のイベント通信基盤
 * Native EventTargetを活用したシンプルな実装
 */
class EventBus extends EventTarget {
    /**
     * イベント発火
     * @param {string} eventName - イベント名（例: 'task:completed'）
     * @param {any} detail - イベントデータ
     */
    emit(eventName, detail) {
        this.dispatchEvent(new CustomEvent(eventName, { detail }));
    }

    /**
     * イベント購読
     * @param {string} eventName - イベント名
     * @param {Function} callback - コールバック関数
     */
    on(eventName, callback) {
        this.addEventListener(eventName, callback);
    }

    /**
     * イベント購読解除
     * @param {string} eventName - イベント名
     * @param {Function} callback - コールバック関数
     */
    off(eventName, callback) {
        this.removeEventListener(eventName, callback);
    }
}

export const eventBus = new EventBus();

// イベント名定数
export const EVENTS = {
    // Task関連
    TASK_LOADED: 'task:loaded',
    TASK_COMPLETED: 'task:completed',
    TASK_UPDATED: 'task:updated',
    TASK_DELETED: 'task:deleted',
    TASK_FILTER_CHANGED: 'task:filter-changed',

    // Session関連
    SESSION_LOADED: 'session:loaded',
    SESSION_CHANGED: 'session:changed',
    SESSION_CREATED: 'session:created',
    SESSION_ARCHIVED: 'session:archived',
    SESSION_DELETED: 'session:deleted',

    // Schedule関連
    SCHEDULE_LOADED: 'schedule:loaded',
    SCHEDULE_UPDATED: 'schedule:updated',

    // Inbox関連
    INBOX_LOADED: 'inbox:loaded',
    INBOX_ITEM_COMPLETED: 'inbox:item-completed'
};
```

### 1.2 Reactive Store実装

**ファイル**: `public/modules/core/store.js`

```javascript
/**
 * Proxyベースのリアクティブストア
 * 状態変更を自動検知してリスナーに通知
 */
export class Store {
    constructor(initialState) {
        this._listeners = new Set();
        this._state = this._createProxy(initialState);
    }

    _createProxy(target) {
        return new Proxy(target, {
            set: (obj, key, value) => {
                const oldValue = obj[key];
                obj[key] = value;
                if (oldValue !== value) {
                    this._notify({ key, value, oldValue });
                }
                return true;
            }
        });
    }

    /**
     * 状態取得
     */
    getState() {
        return this._state;
    }

    /**
     * 状態更新
     * @param {Object} updates - 更新内容
     */
    setState(updates) {
        Object.assign(this._state, updates);
    }

    /**
     * 変更購読
     * @param {Function} listener - リスナー関数
     * @returns {Function} - 購読解除関数
     */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _notify(change) {
        this._listeners.forEach(listener => listener(change));
    }
}

// アプリケーション全体のストア
export const appStore = new Store({
    sessions: [],
    currentSessionId: null,
    tasks: [],
    schedule: null,
    inbox: [],
    filters: {
        taskFilter: '',
        showAllTasks: false
    },
    ui: {
        inboxOpen: false,
        draggedSessionId: null,
        draggedSessionProject: null
    }
});
```

### 1.3 DI Container実装

**ファイル**: `public/modules/core/di-container.js`

```javascript
/**
 * 依存性注入コンテナ
 * シングルトンインスタンスの管理
 */
export class DIContainer {
    constructor() {
        this.services = new Map();
    }

    /**
     * サービス登録
     * @param {string} name - サービス名
     * @param {Function} factory - ファクトリ関数
     */
    register(name, factory) {
        this.services.set(name, { factory, instance: null });
    }

    /**
     * サービス取得（遅延初期化）
     * @param {string} name - サービス名
     * @returns {any} - サービスインスタンス
     */
    get(name) {
        const service = this.services.get(name);
        if (!service) {
            throw new Error(`Service "${name}" not found in DI container`);
        }

        if (!service.instance) {
            service.instance = service.factory(this);
        }
        return service.instance;
    }

    /**
     * サービスの存在確認
     * @param {string} name - サービス名
     * @returns {boolean}
     */
    has(name) {
        return this.services.has(name);
    }
}
```

### 1.4 HTTP Client実装

**ファイル**: `public/modules/core/http-client.js`

```javascript
/**
 * fetchのラッパークラス
 * ボイラープレートを削減
 */
export class HttpClient {
    constructor(baseURL = '') {
        this.baseURL = baseURL;
        this.defaultHeaders = {
            'Content-Type': 'application/json'
        };
    }

    async request(url, options = {}) {
        const config = {
            ...options,
            headers: {
                ...this.defaultHeaders,
                ...options.headers
            }
        };

        const response = await fetch(this.baseURL + url, config);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.json();
    }

    get(url, options = {}) {
        return this.request(url, { ...options, method: 'GET' });
    }

    post(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    patch(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    }

    delete(url, options = {}) {
        return this.request(url, { ...options, method: 'DELETE' });
    }
}

export const httpClient = new HttpClient('/api');
```

### 1.5 統合とテスト

**タスク**:
1. 上記4ファイルを実装
2. 簡単な動作確認テストを作成
3. 既存のapp.jsに影響を与えないことを確認

**テストファイル**: `tests/core/event-bus.test.js`
```javascript
import { describe, it, expect } from 'vitest';
import { EventBus } from '../../public/modules/core/event-bus.js';

describe('EventBus', () => {
    it('should emit and receive events', () => {
        const bus = new EventBus();
        let received = null;

        bus.on('test:event', ({ detail }) => {
            received = detail;
        });

        bus.emit('test:event', { data: 'hello' });

        expect(received).toEqual({ data: 'hello' });
    });
});
```

**完了条件**:
- [ ] Event Bus実装完了
- [ ] Store実装完了
- [ ] DI Container実装完了
- [ ] HTTP Client実装完了
- [ ] 各コンポーネントのテスト通過
- [ ] 既存機能が正常動作

---

## Phase 2: クライアント側分割

**期間**: 3-4日
**目標**: app.jsをView層に分割、Service層の抽出

### 2.1 TaskServiceの実装

**ファイル**: `public/modules/domain/task/task-service.js`

```javascript
import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * タスクのビジネスロジック
 */
export class TaskService {
    constructor() {
        this.store = appStore;
        this.eventBus = eventBus;
    }

    /**
     * タスク一覧取得
     */
    async loadTasks() {
        const tasks = await httpClient.get('/tasks');
        this.store.setState({ tasks });
        this.eventBus.emit(EVENTS.TASK_LOADED, { tasks });
        return tasks;
    }

    /**
     * タスク完了
     */
    async completeTask(taskId) {
        await httpClient.post(`/tasks/${taskId}/complete`);
        await this.loadTasks(); // リロード
        this.eventBus.emit(EVENTS.TASK_COMPLETED, { taskId });
    }

    /**
     * フィルタリング済みタスク取得
     */
    getFilteredTasks() {
        const { tasks, filters } = this.store.getState();
        const { taskFilter, showAllTasks } = filters;

        let filtered = tasks;

        if (taskFilter) {
            filtered = filtered.filter(t =>
                t.title?.includes(taskFilter) ||
                t.content?.includes(taskFilter)
            );
        }

        if (!showAllTasks) {
            filtered = filtered.filter(t => t.status !== 'done');
        }

        return filtered;
    }

    /**
     * フォーカスタスク取得
     */
    getFocusTask() {
        const tasks = this.getFilteredTasks();
        return tasks.find(t => t.priority === 'high') || tasks[0];
    }
}
```

### 2.2 TaskViewの実装

**ファイル**: `public/modules/ui/views/task-view.js`

```javascript
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { renderFocusTaskHTML, renderNextTaskItemHTML } from '../renderers/task-renderer.js';

/**
 * タスクビュー
 * UIレンダリングとイベント処理
 */
export class TaskView {
    constructor({ taskService }) {
        this.taskService = taskService;
        this.container = null;

        // イベント購読
        this.eventBus = eventBus;
        this.eventBus.on(EVENTS.TASK_LOADED, () => this.render());
        this.eventBus.on(EVENTS.TASK_COMPLETED, () => this.render());
        this.eventBus.on(EVENTS.TASK_FILTER_CHANGED, () => this.render());
    }

    /**
     * DOMにマウント
     */
    mount(element) {
        this.container = element;
        this.setupEventListeners();
        this.render();
    }

    /**
     * イベントリスナー設定（イベント委譲）
     */
    setupEventListeners() {
        this.container.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            const taskId = e.target.dataset.taskId;

            if (action === 'complete' && taskId) {
                await this.handleComplete(taskId);
            } else if (action === 'defer' && taskId) {
                await this.handleDefer(taskId);
            }
        });
    }

    /**
     * タスク完了処理
     */
    async handleComplete(taskId) {
        await this.taskService.completeTask(taskId);
    }

    /**
     * タスク延期処理
     */
    async handleDefer(taskId) {
        await this.taskService.deferTask(taskId);
    }

    /**
     * レンダリング
     */
    render() {
        const focusTask = this.taskService.getFocusTask();
        const nextTasks = this.taskService.getFilteredTasks().slice(1, 6);

        this.container.innerHTML = `
            <div class="focus-task">
                ${focusTask ? renderFocusTaskHTML(focusTask) : '<p>No tasks</p>'}
            </div>
            <div class="next-tasks">
                ${nextTasks.map(renderNextTaskItemHTML).join('')}
            </div>
        `;

        // アイコン再描画
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
}
```

### 2.3 app.jsのリファクタリング

**ファイル**: `public/app.js` (新バージョン)

```javascript
import { DIContainer } from './modules/core/di-container.js';
import { TaskService } from './modules/domain/task/task-service.js';
import { SessionService } from './modules/domain/session/session-service.js';
import { TaskView } from './modules/ui/views/task-view.js';
import { SessionView } from './modules/ui/views/session-view.js';

/**
 * DIコンテナのセットアップ
 */
function setupDI() {
    const container = new DIContainer();

    // サービス登録
    container.register('taskService', () => new TaskService());
    container.register('sessionService', () => new SessionService());

    // ビュー登録
    container.register('taskView', (c) =>
        new TaskView({ taskService: c.get('taskService') })
    );
    container.register('sessionView', (c) =>
        new SessionView({ sessionService: c.get('sessionService') })
    );

    return container;
}

/**
 * 初期データロード
 */
async function loadInitialData(container) {
    const taskService = container.get('taskService');
    const sessionService = container.get('sessionService');

    await Promise.all([
        taskService.loadTasks(),
        sessionService.loadSessions()
    ]);
}

/**
 * アプリケーション初期化
 */
document.addEventListener('DOMContentLoaded', async () => {
    // DIコンテナ
    const container = setupDI();

    // 初期データロード
    await loadInitialData(container);

    // ビューのマウント
    const taskView = container.get('taskView');
    taskView.mount(document.getElementById('right-panel'));

    const sessionView = container.get('sessionView');
    sessionView.mount(document.getElementById('session-list'));
});
```

### 2.4 段階的移行

**移行順序**:
1. TaskService + TaskView
2. SessionService + SessionView
3. TimelineView
4. InboxView
5. 旧コードの削除

**完了条件**:
- [ ] TaskService実装完了
- [ ] TaskView実装完了
- [ ] SessionService実装完了
- [ ] SessionView実装完了
- [ ] 新app.js動作確認
- [ ] 旧app.jsのタスク関連コード削除
- [ ] 全機能が正常動作

---

## Phase 3: サーバー側分割

**期間**: 2-3日
**目標**: server.jsをMVC構造に分割

### 3.1 ルーターの分離

**ファイル**: `routes/tasks.js`

```javascript
import express from 'express';

export function createTaskRouter({ taskController }) {
    const router = express.Router();

    router.get('/', taskController.list.bind(taskController));
    router.get('/:id', taskController.get.bind(taskController));
    router.post('/:id/complete', taskController.complete.bind(taskController));
    router.patch('/:id', taskController.update.bind(taskController));
    router.delete('/:id', taskController.delete.bind(taskController));

    return router;
}
```

### 3.2 コントローラーの実装

**ファイル**: `controllers/task-controller.js`

```javascript
/**
 * タスクコントローラー
 * HTTPリクエスト処理
 */
export class TaskController {
    constructor({ taskService }) {
        this.taskService = taskService;
    }

    async list(req, res, next) {
        try {
            const { filter, status } = req.query;
            const tasks = await this.taskService.getTasks({ filter, status });
            res.json(tasks);
        } catch (error) {
            next(error);
        }
    }

    async get(req, res, next) {
        try {
            const task = await this.taskService.getTaskById(req.params.id);
            if (!task) {
                return res.status(404).json({ error: 'Task not found' });
            }
            res.json(task);
        } catch (error) {
            next(error);
        }
    }

    async complete(req, res, next) {
        try {
            const task = await this.taskService.completeTask(req.params.id);
            res.json(task);
        } catch (error) {
            next(error);
        }
    }
}
```

### 3.3 サービス層の実装

**ファイル**: `services/task-service.js`

```javascript
/**
 * タスクサービス（サーバー側）
 * ビジネスロジック
 */
export class TaskService {
    constructor({ taskRepository }) {
        this.taskRepository = taskRepository;
    }

    async getTasks(options = {}) {
        let tasks = await this.taskRepository.findAll();

        if (options.filter) {
            tasks = tasks.filter(t =>
                t.title?.includes(options.filter) ||
                t.content?.includes(options.filter)
            );
        }

        if (options.status) {
            tasks = tasks.filter(t => t.status === options.status);
        }

        return this._sortByPriority(tasks);
    }

    async completeTask(id) {
        const task = await this.taskRepository.findById(id);
        if (!task) throw new Error('Task not found');

        task.status = 'done';
        task.completedAt = new Date().toISOString();

        await this.taskRepository.update(id, task);
        return task;
    }

    _sortByPriority(tasks) {
        const order = { high: 0, medium: 1, low: 2 };
        return tasks.sort((a, b) => order[a.priority] - order[b.priority]);
    }
}
```

### 3.4 リポジトリ層の実装

**ファイル**: `repositories/task-repository.js`

```javascript
import { TaskParser } from '../lib/parsers/task-parser.js';

/**
 * タスクリポジトリ
 * データアクセス層
 */
export class TaskRepository {
    constructor({ taskParser }) {
        this.parser = taskParser;
    }

    async findAll() {
        return await this.parser.loadTasks();
    }

    async findById(id) {
        const tasks = await this.findAll();
        return tasks.find(t => t.id === id);
    }

    async update(id, data) {
        // TODO: ファイル書き込み実装
        throw new Error('Update not implemented - read-only mode');
    }
}
```

### 3.5 server.jsのリファクタリング

**ファイル**: `server.js` (新バージョン)

```javascript
import express from 'express';
import { DIContainer } from './lib/di-container.js';
import { createTaskRouter } from './routes/tasks.js';
import { createSessionRouter } from './routes/sessions.js';
import { errorHandler } from './middleware/error-handler.js';
import { cacheControl } from './middleware/cache-control.js';

// パーサーとクラスのインポート
import { TaskParser } from './lib/parsers/task-parser.js';
import { TaskRepository } from './repositories/task-repository.js';
import { TaskService } from './services/task-service.js';
import { TaskController } from './controllers/task-controller.js';

const app = express();
const container = new DIContainer();

// 依存関係の登録
container.register('taskParser', () => new TaskParser(TASKS_FILE));
container.register('taskRepository', (c) =>
    new TaskRepository({ taskParser: c.get('taskParser') })
);
container.register('taskService', (c) =>
    new TaskService({ taskRepository: c.get('taskRepository') })
);
container.register('taskController', (c) =>
    new TaskController({ taskService: c.get('taskService') })
);

// ミドルウェア
app.use(express.json());
app.use(cacheControl);
app.use(express.static('public'));

// ルート
app.use('/api/tasks', createTaskRouter({
    taskController: container.get('taskController')
}));
app.use('/api/sessions', createSessionRouter({
    sessionController: container.get('sessionController')
}));

// エラーハンドリング
app.use(errorHandler);

const PORT = process.env.PORT || 31013;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
```

### 3.6 ミドルウェアの実装

**ファイル**: `middleware/cache-control.js`

```javascript
/**
 * キャッシュ制御ミドルウェア
 * 重複コードを一元化
 */
export function cacheControl(req, res, next) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
}
```

**ファイル**: `middleware/error-handler.js`

```javascript
/**
 * エラーハンドリングミドルウェア
 */
export function errorHandler(err, req, res, next) {
    console.error(err.stack);

    const isDev = process.env.NODE_ENV !== 'production';

    res.status(err.status || 500).json({
        error: {
            message: err.message,
            ...(isDev && { stack: err.stack })
        }
    });
}
```

### 3.7 段階的移行

**移行順序**:
1. ミドルウェア分離
2. Task関連のMVC化
3. Session関連のMVC化
4. Schedule関連のMVC化
5. 旧server.jsのコード削除

**完了条件**:
- [ ] routes/ディレクトリ作成完了
- [ ] controllers/実装完了
- [ ] services/実装完了
- [ ] repositories/実装完了
- [ ] 新server.js動作確認
- [ ] 旧server.jsのコード削除
- [ ] 全APIが正常動作

---

## リスクと対策

### リスク1: 既存機能の破壊

**対策**:
- 各フェーズでE2Eテストを実行
- 段階的移行（新旧コードを並行稼働）
- ロールバック計画の準備

### リスク2: パフォーマンス劣化

**対策**:
- イベントリスナーの適切な管理（購読解除）
- メモ化の活用
- 不要な再レンダリング防止

### リスク3: スケジュール遅延

**対策**:
- 各フェーズを独立して完了可能に
- 優先度の高い部分から着手
- 定期的な進捗確認

### リスク4: チーム理解不足

**対策**:
- ドキュメントの充実
- コードコメントの追加
- アーキテクチャ図の作成

---

## 成功指標

### コードメトリクス

| 指標 | 現状 | 目標 |
|------|------|------|
| app.js行数 | 2,203行 | 100行以下 |
| server.js行数 | 1,384行 | 200行以下 |
| 最大ファイルサイズ | 2,203行 | 300行以下 |
| Cyclomatic Complexity (app.js) | ~120 | ~20 |
| Cyclomatic Complexity (server.js) | ~45 | ~10 |
| コード重複率 | ~15% | ~5% |

### 品質指標

- [ ] 全モジュールにテストカバレッジ80%以上
- [ ] E2Eテスト全通過
- [ ] パフォーマンス劣化なし（Lighthouse Score維持）
- [ ] メモリリークなし

### 開発者体験

- [ ] 新機能追加時の変更ファイル数が3個以下
- [ ] バグ修正時の影響範囲が明確
- [ ] コードレビュー時間が50%削減

---

## タイムライン

```
Week 1
├─ Day 1-2: Phase 1.1-1.4 (Event Bus, Store, DI, HTTP Client)
└─ Day 3: Phase 1.5 (統合とテスト)

Week 2
├─ Day 1-2: Phase 2.1-2.2 (TaskService, TaskView)
├─ Day 3-4: Phase 2.3 (SessionService, SessionView)
└─ Day 5: Phase 2.4 (旧コード削除)

Week 3
├─ Day 1: Phase 3.1-3.2 (Routes, Controllers)
├─ Day 2: Phase 3.3-3.4 (Services, Repositories)
└─ Day 3: Phase 3.5-3.7 (統合と旧コード削除)
```

**総期間**: 約3週間（15営業日）

---

## 次のステップ

1. この計画書のレビューと承認
2. `refactor/architecture-v2` ブランチ作成
3. Phase 1の実装開始

---

**作成者**: Claude (brainbase AI)
**最終更新**: 2025-12-22

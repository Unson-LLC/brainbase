# Phase 1 実装ガイド: インフラ整備

**期間**: 2-3日
**目標**: Event Bus, Reactive Store, DI Container, HTTP Clientの実装

---

## 実装順序

1. Event Bus
2. Reactive Store
3. DI Container
4. HTTP Client
5. 統合テスト

---

## Step 1: Event Bus実装

### 1.1 ファイル作成

**パス**: `public/modules/core/event-bus.js`

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
     * @returns {Function} - 購読解除関数
     */
    on(eventName, callback) {
        this.addEventListener(eventName, callback);
        return () => this.off(eventName, callback);
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

// グローバルインスタンス（シングルトン）
export const eventBus = new EventBus();

/**
 * アプリケーション全体で使用するイベント名定数
 */
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
    INBOX_ITEM_COMPLETED: 'inbox:item-completed',

    // UI関連
    INBOX_TOGGLED: 'inbox:toggled',
    MODAL_OPENED: 'modal:opened',
    MODAL_CLOSED: 'modal:closed'
};
```

### 1.2 テスト作成

**パス**: `tests/core/event-bus.test.js`

```javascript
import { describe, it, expect, vi } from 'vitest';
import { EventBus, EVENTS } from '../../public/modules/core/event-bus.js';

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

    it('should support multiple listeners', () => {
        const bus = new EventBus();
        const listener1 = vi.fn();
        const listener2 = vi.fn();

        bus.on('test:event', listener1);
        bus.on('test:event', listener2);

        bus.emit('test:event', { data: 'test' });

        expect(listener1).toHaveBeenCalledTimes(1);
        expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe correctly', () => {
        const bus = new EventBus();
        const listener = vi.fn();

        const unsubscribe = bus.on('test:event', listener);
        bus.emit('test:event', { data: 'first' });

        unsubscribe();
        bus.emit('test:event', { data: 'second' });

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should have all required event constants', () => {
        expect(EVENTS.TASK_LOADED).toBe('task:loaded');
        expect(EVENTS.SESSION_CHANGED).toBe('session:changed');
        expect(EVENTS.INBOX_TOGGLED).toBe('inbox:toggled');
    });
});
```

### 1.3 動作確認

```bash
npm run test tests/core/event-bus.test.js
```

---

## Step 2: Reactive Store実装

### 2.1 ファイル作成

**パス**: `public/modules/core/store.js`

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

    /**
     * 状態をProxyでラップ
     * @private
     */
    _createProxy(target) {
        const self = this;
        return new Proxy(target, {
            set(obj, key, value) {
                const oldValue = obj[key];
                obj[key] = value;
                if (oldValue !== value) {
                    self._notify({ key, value, oldValue });
                }
                return true;
            }
        });
    }

    /**
     * 状態取得
     * @returns {Object} - 現在の状態
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

    /**
     * リスナーに通知
     * @private
     */
    _notify(change) {
        this._listeners.forEach(listener => {
            try {
                listener(change);
            } catch (error) {
                console.error('Error in store listener:', error);
            }
        });
    }
}

/**
 * アプリケーション全体のストア
 */
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

### 2.2 テスト作成

**パス**: `tests/core/store.test.js`

```javascript
import { describe, it, expect, vi } from 'vitest';
import { Store } from '../../public/modules/core/store.js';

describe('Store', () => {
    it('should initialize with initial state', () => {
        const store = new Store({ count: 0 });
        expect(store.getState()).toEqual({ count: 0 });
    });

    it('should update state', () => {
        const store = new Store({ count: 0 });
        store.setState({ count: 5 });
        expect(store.getState().count).toBe(5);
    });

    it('should notify subscribers on change', () => {
        const store = new Store({ count: 0 });
        const listener = vi.fn();

        store.subscribe(listener);
        store.setState({ count: 5 });

        expect(listener).toHaveBeenCalledWith({
            key: 'count',
            value: 5,
            oldValue: 0
        });
    });

    it('should not notify if value is unchanged', () => {
        const store = new Store({ count: 0 });
        const listener = vi.fn();

        store.subscribe(listener);
        store.setState({ count: 0 });

        expect(listener).not.toHaveBeenCalled();
    });

    it('should unsubscribe correctly', () => {
        const store = new Store({ count: 0 });
        const listener = vi.fn();

        const unsubscribe = store.subscribe(listener);
        store.setState({ count: 1 });

        unsubscribe();
        store.setState({ count: 2 });

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should handle errors in listeners', () => {
        const store = new Store({ count: 0 });
        const errorListener = () => { throw new Error('Test error'); };
        const normalListener = vi.fn();

        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        store.subscribe(errorListener);
        store.subscribe(normalListener);

        store.setState({ count: 1 });

        expect(consoleError).toHaveBeenCalled();
        expect(normalListener).toHaveBeenCalled();

        consoleError.mockRestore();
    });
});
```

### 2.3 動作確認

```bash
npm run test tests/core/store.test.js
```

---

## Step 3: DI Container実装

### 3.1 ファイル作成

**パス**: `public/modules/core/di-container.js`

```javascript
/**
 * 依存性注入コンテナ
 * シングルトンインスタンスの管理と遅延初期化
 */
export class DIContainer {
    constructor() {
        this.services = new Map();
        this._resolving = new Set(); // 循環依存検出用
    }

    /**
     * サービス登録
     * @param {string} name - サービス名
     * @param {Function} factory - ファクトリ関数（引数: container）
     */
    register(name, factory) {
        if (typeof factory !== 'function') {
            throw new Error(`Factory for "${name}" must be a function`);
        }
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
            throw new Error(`Service "${name}" not found in DI container. Available services: ${Array.from(this.services.keys()).join(', ')}`);
        }

        // 既にインスタンス化済みの場合
        if (service.instance !== null) {
            return service.instance;
        }

        // 循環依存チェック
        if (this._resolving.has(name)) {
            throw new Error(`Circular dependency detected: ${Array.from(this._resolving).join(' -> ')} -> ${name}`);
        }

        try {
            this._resolving.add(name);
            service.instance = service.factory(this);
            return service.instance;
        } finally {
            this._resolving.delete(name);
        }
    }

    /**
     * サービスの存在確認
     * @param {string} name - サービス名
     * @returns {boolean}
     */
    has(name) {
        return this.services.has(name);
    }

    /**
     * コンテナのリセット（テスト用）
     */
    reset() {
        this.services.clear();
        this._resolving.clear();
    }
}
```

### 3.2 テスト作成

**パス**: `tests/core/di-container.test.js`

```javascript
import { describe, it, expect } from 'vitest';
import { DIContainer } from '../../public/modules/core/di-container.js';

describe('DIContainer', () => {
    it('should register and resolve services', () => {
        const container = new DIContainer();
        container.register('testService', () => ({ name: 'Test' }));

        const service = container.get('testService');
        expect(service).toEqual({ name: 'Test' });
    });

    it('should return singleton instance', () => {
        const container = new DIContainer();
        container.register('counter', () => ({ count: 0 }));

        const instance1 = container.get('counter');
        const instance2 = container.get('counter');

        expect(instance1).toBe(instance2);
    });

    it('should support dependency injection', () => {
        const container = new DIContainer();

        container.register('logger', () => ({
            log: (msg) => msg
        }));

        container.register('service', (c) => ({
            logger: c.get('logger'),
            doSomething: () => 'done'
        }));

        const service = container.get('service');
        expect(service.logger).toBeDefined();
        expect(service.logger.log('test')).toBe('test');
    });

    it('should throw on missing service', () => {
        const container = new DIContainer();

        expect(() => container.get('nonexistent')).toThrow(
            'Service "nonexistent" not found'
        );
    });

    it('should detect circular dependencies', () => {
        const container = new DIContainer();

        container.register('a', (c) => c.get('b'));
        container.register('b', (c) => c.get('a'));

        expect(() => container.get('a')).toThrow('Circular dependency detected');
    });

    it('should check if service exists', () => {
        const container = new DIContainer();
        container.register('test', () => ({}));

        expect(container.has('test')).toBe(true);
        expect(container.has('nonexistent')).toBe(false);
    });
});
```

### 3.3 動作確認

```bash
npm run test tests/core/di-container.test.js
```

---

## Step 4: HTTP Client実装

### 4.1 ファイル作成

**パス**: `public/modules/core/http-client.js`

```javascript
/**
 * fetchのラッパークラス
 * ボイラープレートを削減し、統一的なエラーハンドリング
 */
export class HttpClient {
    constructor(baseURL = '') {
        this.baseURL = baseURL;
        this.defaultHeaders = {
            'Content-Type': 'application/json'
        };
    }

    /**
     * HTTPリクエスト実行
     * @param {string} url - リクエストURL
     * @param {Object} options - fetchオプション
     * @returns {Promise<any>} - レスポンスJSON
     */
    async request(url, options = {}) {
        const config = {
            ...options,
            headers: {
                ...this.defaultHeaders,
                ...options.headers
            }
        };

        try {
            const response = await fetch(this.baseURL + url, config);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
            }

            // 204 No Contentの場合はnullを返す
            if (response.status === 204) {
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error(`HTTP request failed: ${config.method || 'GET'} ${url}`, error);
            throw error;
        }
    }

    /**
     * GETリクエスト
     */
    get(url, options = {}) {
        return this.request(url, { ...options, method: 'GET' });
    }

    /**
     * POSTリクエスト
     */
    post(url, data = null, options = {}) {
        return this.request(url, {
            ...options,
            method: 'POST',
            body: data ? JSON.stringify(data) : undefined
        });
    }

    /**
     * PATCHリクエスト
     */
    patch(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    }

    /**
     * DELETEリクエスト
     */
    delete(url, options = {}) {
        return this.request(url, { ...options, method: 'DELETE' });
    }
}

// グローバルインスタンス
export const httpClient = new HttpClient('/api');
```

### 4.2 テスト作成

**パス**: `tests/core/http-client.test.js`

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '../../public/modules/core/http-client.js';

describe('HttpClient', () => {
    let fetchMock;

    beforeEach(() => {
        fetchMock = vi.fn();
        global.fetch = fetchMock;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should make GET request', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ data: 'test' })
        });

        const client = new HttpClient('/api');
        const result = await client.get('/tasks');

        expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
            method: 'GET'
        }));
        expect(result).toEqual({ data: 'test' });
    });

    it('should make POST request', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ id: 123 })
        });

        const client = new HttpClient('/api');
        const result = await client.post('/tasks', { title: 'New Task' });

        expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ title: 'New Task' })
        }));
        expect(result).toEqual({ id: 123 });
    });

    it('should handle errors', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            text: async () => 'Task not found'
        });

        const client = new HttpClient('/api');

        await expect(client.get('/tasks/999')).rejects.toThrow('HTTP 404');
    });

    it('should handle 204 No Content', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 204
        });

        const client = new HttpClient('/api');
        const result = await client.delete('/tasks/123');

        expect(result).toBeNull();
    });
});
```

### 4.3 動作確認

```bash
npm run test tests/core/http-client.test.js
```

---

## Step 5: 統合確認

### 5.1 簡易デモページ作成

**パス**: `public/test-infrastructure.html`

```html
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>Infrastructure Test</title>
</head>
<body>
    <h1>Infrastructure Test</h1>
    <div id="output"></div>

    <script type="module">
        import { eventBus, EVENTS } from './modules/core/event-bus.js';
        import { appStore } from './modules/core/store.js';
        import { DIContainer } from './modules/core/di-container.js';
        import { httpClient } from './modules/core/http-client.js';

        const output = document.getElementById('output');

        // Event Bus Test
        eventBus.on(EVENTS.TASK_COMPLETED, ({ detail }) => {
            output.innerHTML += `<p>✅ Event Bus: Task ${detail.taskId} completed</p>`;
        });

        // Store Test
        appStore.subscribe(({ key, value }) => {
            output.innerHTML += `<p>✅ Store: ${key} changed to ${JSON.stringify(value)}</p>`;
        });

        // DI Container Test
        const container = new DIContainer();
        container.register('logger', () => ({
            log: (msg) => output.innerHTML += `<p>✅ DI Container: ${msg}</p>`
        }));

        // Tests
        setTimeout(() => {
            eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: 'task-123' });
            appStore.setState({ currentSessionId: 'session-456' });
            container.get('logger').log('DI Container works!');
        }, 100);
    </script>
</body>
</html>
```

### 5.2 ブラウザで確認

```bash
# 開発サーバー起動
npm run dev

# ブラウザで開く
# http://localhost:3001/test-infrastructure.html
```

**期待される出力**:
```
✅ Event Bus: Task task-123 completed
✅ Store: currentSessionId changed to "session-456"
✅ DI Container: DI Container works!
```

---

## Step 6: 既存コードとの統合確認

### 6.1 app.jsで読み込み

**パス**: `public/app.js` (既存ファイルの冒頭に追加)

```javascript
// Phase 1: Infrastructure Import (新規追加)
import { eventBus, EVENTS } from './modules/core/event-bus.js';
import { appStore } from './modules/core/store.js';

// 既存コードはそのまま維持
document.addEventListener('DOMContentLoaded', async () => {
    // ... 既存のコード ...

    // テスト: Event Busが動作するか確認
    console.log('Event Bus loaded:', eventBus);
    console.log('Store loaded:', appStore);
});
```

### 6.2 動作確認

```bash
npm run dev
```

ブラウザのコンソールに以下が表示されればOK:
```
Event Bus loaded: EventBus { ... }
Store loaded: Store { ... }
```

---

## 完了チェックリスト

- [ ] Event Bus実装完了
- [ ] Event Busテスト通過
- [ ] Reactive Store実装完了
- [ ] Reactive Storeテスト通過
- [ ] DI Container実装完了
- [ ] DI Containerテスト通過
- [ ] HTTP Client実装完了
- [ ] HTTP Clientテスト通過
- [ ] test-infrastructure.html動作確認
- [ ] 既存app.jsでインポート確認
- [ ] 全テスト通過（`npm run test`）
- [ ] 既存機能が正常動作（回帰テスト）

---

## トラブルシューティング

### エラー: "Cannot use import statement outside a module"

**原因**: HTMLで`<script type="module">`を忘れている

**解決**:
```html
<script type="module" src="/app.js"></script>
```

### エラー: "Circular dependency detected"

**原因**: サービス間で循環参照が発生

**解決**: 依存関係を見直し、Event Busで通信するように変更

### テストが失敗する

**確認事項**:
1. `npm install` を実行したか
2. vitestの設定が正しいか（`vitest.config.js`）
3. ファイルパスが正しいか

---

## 次のステップ

Phase 1完了後、Phase 2（クライアント側分割）に進みます。
→ `PHASE2_IMPLEMENTATION_GUIDE.md` を参照

---

**作成者**: Claude (brainbase AI)
**最終更新**: 2025-12-22

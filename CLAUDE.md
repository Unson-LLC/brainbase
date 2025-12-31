# brainbase Development Standards

**Version**: 1.1.0
**Last Updated**: 2025-12-31
**Maintainer**: Unson LLC

---

## 1. Architecture Principles

### 1.1 Event-Driven Architecture

**原則**: すべての状態変更はEventとして発火し、EventBusを通じて伝播する

**Why**:
- モジュール間の疎結合を維持
- テスタビリティ向上
- デバッグ容易性向上

**How**:
```javascript
// Good: EventBusを使用
import { eventBus, EVENTS } from '/modules/core/event-bus.js';

// タスク完了時
eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: '123', project: 'brainbase' });

// 別モジュールでリスニング
eventBus.on(EVENTS.TASK_COMPLETED, (event) => {
  console.log('Task completed:', event.detail);
});

// Bad: 直接呼び出し
taskService.onComplete(taskId); // ❌ 密結合
```

**利用可能なイベント**:
```javascript
// Task関連
TASK_LOADED, TASK_COMPLETED, TASK_UPDATED, TASK_DELETED, TASK_FILTER_CHANGED

// Session関連
SESSION_LOADED, SESSION_CHANGED, SESSION_CREATED, SESSION_ARCHIVED, SESSION_DELETED

// Schedule関連
SCHEDULE_LOADED, SCHEDULE_UPDATED

// Inbox関連
INBOX_LOADED, INBOX_ITEM_COMPLETED
```

**思考パターン**:
```
状態変更が発生する → 「このEventをどう定義するか?」
他モジュールに通知が必要 → 「EventBusで発火するか?」
直接呼び出しを見つけた → 「Event経由に変更できないか?」
```

**Enforcement**:
- ファイル: `public/modules/core/event-bus.js`
- Skill: architecture-patterns
- CI Check: architecture-check.yml

---

### 1.2 Reactive Store Pattern

**原則**: UIとデータの同期はReactive Storeを通じて実現する

**Why**:
- 状態管理の一元化
- 予測可能なデータフロー
- デバッグ容易性

**How**:
```javascript
// Good: Store経由
import { appStore } from '/modules/core/store.js';

// 状態更新
appStore.setState({ currentSessionId: 'brainbase' });

// 状態購読
const unsubscribe = appStore.subscribe((change) => {
  console.log(`${change.key} changed:`, change.value);
  render(); // UI更新
});

// Bad: DOM直接操作
document.getElementById('session').textContent = 'brainbase'; // ❌ 状態とDOMが分離
```

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
    draggedSessionId: null
  }
}
```

**思考パターン**:
```
UI更新が必要 → 「Storeを更新すればUIが自動反映されるか?」
データフローが複雑 → 「Storeで一元管理できないか?」
DOM直接操作を見つけた → 「Store経由に変更できないか?」
```

**Enforcement**:
- ファイル: `public/modules/core/store.js`
- Skill: architecture-patterns
- CI Check: architecture-check.yml

---

### 1.3 Dependency Injection Container

**原則**: サービス間の依存はDI Containerで解決する

**Why**:
- テスト時のモック化が容易
- 循環依存の防止
- 初期化順序の自動管理

**How**:
```javascript
// Good: DI Container経由
import { container } from '/modules/core/di-container.js';

// サービス登録
container.register('taskService', () => new TaskService({
  repository: container.get('taskRepository'),
  eventBus: container.get('eventBus')
}));

// サービス取得
const taskService = container.get('taskService');

// Bad: 直接import
import { taskService } from './services/task.js'; // ❌ 密結合
```

**登録パターン**:
```javascript
// app.js で一括登録
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

**思考パターン**:
```
サービス間の依存が発生 → 「DI Containerで解決できるか?」
テストでモックが必要 → 「DI Containerに登録されているか?」
循環依存を検出 → 「DI Containerで初期化順序を管理できないか?」
```

**Enforcement**:
- ファイル: `public/modules/core/di-container.js`
- Skill: architecture-patterns
- CI Check: architecture-check.yml

---

### 1.4 Service Layer Pattern

**原則**: ビジネスロジックはServiceレイヤに集約する

**レイヤ構造**:
```
UI Components (View)
    ↓
Services (Business Logic)
    ↓
Repositories (Data Access)
    ↓
EventBus (Cross-Cutting)
```

**例**: TaskService
```javascript
// public/modules/domain/task/task-service.js
export class TaskService {
  constructor({ repository, store, eventBus }) {
    this.repository = repository;
    this.store = store;
    this.eventBus = eventBus;
  }

  async getTasks(filters) {
    const tasks = await this.repository.fetchTasks();
    const filtered = this._applyFilters(tasks, filters);

    // Store更新
    this.store.setState({ tasks: filtered });

    // Event発火
    this.eventBus.emit(EVENTS.TASK_LOADED, { tasks: filtered });

    return filtered;
  }

  async completeTask(id) {
    await this.repository.updateTask(id, { status: 'completed' });
    this.eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: id });
  }

  _applyFilters(tasks, filters) {
    // ビジネスロジック
    return tasks.filter(task => {
      // フィルタリングロジック
    });
  }
}
```

**思考パターン**:
```
ビジネスロジックを書く → 「Serviceレイヤに配置されているか?」
UI Componentが肥大化 → 「ロジックをServiceに抽出できないか?」
データアクセスロジック → 「Repositoryレイヤに分離されているか?」
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

**Enforcement**:
- Skill: architecture-patterns
- CI Check: service-layer-check.yml

---

### 1.5 Test-Driven Development (TDD)

**原則**: テストファースト（実装より先にテストを書く）でRed-Green-Refactorサイクルを実践する

**Why**:
- 設計品質向上（テストしやすい = 疎結合で単一責任）
- バグの早期発見（実装前にエッジケースを考える）
- リファクタリング容易性（テストが守ってくれる）
- 仕様の明確化（テストが仕様書になる）

**Red-Green-Refactorサイクル**:
```
┌─────────────────────────────────────────────┐
│ 1. RED: 失敗するテストを書く                 │
│    - TODOリストから1つ選ぶ                   │
│    - テストを書く（コンパイルエラーでもOK）  │
│    - npm run test → FAIL ❌                  │
├─────────────────────────────────────────────┤
│ 2. GREEN: 最速で通す実装                     │
│    - 仮実装（べた書き）→ 三角測量 → 明白な実装│
│    - npm run test → PASS ✅                  │
├─────────────────────────────────────────────┤
│ 3. REFACTOR: 重複除去、綺麗にする            │
│    - リファクタリング実施                     │
│    - npm run test → PASS ✅ (still green)    │
└─────────────────────────────────────────────┘
```

**Example**:
```javascript
// Step 1: RED（失敗するテストを書く）
describe('TaskService', () => {
  it('archiveTask呼び出し時_TASK_ARCHIVEDイベントが発火される', async () => {
    await taskService.archiveTask('task-1');
    expect(emitted).toHaveLength(1);
  });
});
// npm run test → FAIL ❌

// Step 2: GREEN（仮実装）
async archiveTask(taskId) {
  this.eventBus.emit(EVENTS.TASK_ARCHIVED, { taskId });
}
// npm run test → PASS ✅

// Step 3: GREEN（三角測量で本実装）
it('archiveTask呼び出し時_存在しないタスク_エラーが投げられる', async () => {
  await expect(taskService.archiveTask('non-existent')).rejects.toThrow();
});

async archiveTask(taskId) {
  const task = await this.repository.findById(taskId);
  if (!task) throw new Error('Task not found');

  await this.repository.updateTaskStatus(taskId, 'archived');
  this.eventBus.emit(EVENTS.TASK_ARCHIVED, { taskId });
}
// npm run test → PASS ✅

// Step 4: REFACTOR（重複除去）
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
// npm run test → PASS ✅
```

**思考パターン**:
```
新機能追加 → 「まず失敗するテストを書いたか？」
テストが通った → 「リファクタリングできるか？」
実装方法に迷う → 「仮実装 → 三角測量 → 明白な実装の順で進める」
```

**TDD実践の4つの柱**:
1. **Test-First**: 実装より先にテストを書く
2. **Red-Green-Refactor**: サイクルを守る
3. **Baby Steps**: 一度に1つの機能のみ追加（1サイクル15分以内）
4. **TODO駆動**: TODOリスト作成 → 1つずつ実装 → 完了チェック

**Enforcement**:
- Skill: tdd-workflow
- CI Check: tdd-check.yml
- 参照: `.claude/skills/tdd-workflow/SKILL.md`

---

## 2. Test Strategy

### 2.1 Test Pyramid

**原則**: Unit (80%) / API (15%) / E2E (5%)

**Why**:
- 高速フィードバックループ
- メンテナンスコストの最小化
- 信頼性の確保

**Test Types**:

**Unit Test** (80%):
- 対象: Services, Utilities, Pure Functions
- ツール: Vitest
- 実行頻度: 保存時・コミット前・CI

**API Test** (15%):
- 対象: HTTP Endpoints, WebSocket
- ツール: Vitest (supertest等)
- 実行頻度: コミット前・CI

**E2E Test** (5%):
- 対象: Critical User Flows
- ツール: Playwright
- 実行頻度: CI (PRマージ前)

**思考パターン**:
```
新機能実装 → 「まずUnit Testを書いたか?」
E2Eテストが増加 → 「Unit/APIテストで代替できないか?」
カバレッジが低い → 「Unit Testを追加すべきか?」
```

**Enforcement**:
- Skill: test-strategy
- CI Check: test-coverage-check.yml (80%以上)

---

### 2.2 Test Naming Convention

**原則**: `describe('対象', () => { it('条件_期待結果', () => { ... }) })`

**Example**:
```javascript
describe('TaskService', () => {
  it('getTasks呼び出し時_フィルタ適用されたタスク一覧が返される', async () => {
    const service = new TaskService({ repository: mockRepo });
    const tasks = await service.getTasks({ status: 'pending' });

    expect(tasks).toHaveLength(3);
    expect(tasks.every(t => t.status === 'pending')).toBe(true);
  });

  it('completeTask呼び出し時_TASK_COMPLETEDイベントが発火される', async () => {
    const emitted = [];
    eventBus.on(EVENTS.TASK_COMPLETED, (e) => emitted.push(e));

    await service.completeTask('123');

    expect(emitted).toHaveLength(1);
    expect(emitted[0].detail.taskId).toBe('123');
  });

  it('存在しないタスクのcompleteTask呼び出し時_エラーが投げられる', async () => {
    await expect(service.completeTask('999')).rejects.toThrow('Task not found');
  });
});
```

**思考パターン**:
```
テストケース作成 → 「describe('対象') + it('条件_期待結果') の形式か?」
テスト失敗時 → 「エラーメッセージから何が失敗したか即座にわかるか?」
```

**Enforcement**:
- Skill: test-strategy
- CI Check: test-naming-check.yml

---

### 2.3 Coverage Target

**目標**: 80%以上

**計測方法**: Vitest の coverage reporter

**Why**:
- 品質の定量的保証
- リグレッション防止
- コード品質の可視化

**実行コマンド**:
```bash
# カバレッジ付きテスト実行
npm run test:coverage

# カバレッジレポート確認
open coverage/index.html
```

**思考パターン**:
```
PR作成時 → 「カバレッジ80%以上か?」
カバレッジ低下 → 「どのファイルがカバーされていないか?」
```

**Enforcement**:
- Skill: test-strategy
- CI Check: test-coverage-check.yml

---

### 2.4 E2E Test Best Practices (AI活用時)

**原則**: AIを使ってE2Eテストを作成する際、堅牢性・保守性・デバッグ容易性を確保する

**Why**:
- UIの変更でテストが壊れるのを防ぐ
- 外部依存によるテスト失敗を防ぐ
- 失敗時の原因特定を容易にする
- テストの並列実行を安全に行う

---

#### 2.4.1 data-testid属性の利用

**原則**: DOM要素取得時は必ず`data-testid`属性を使用する

**Why**:
- UIの文言変更でテストが壊れない
- レイアウト変更でセレクタが無効化されない
- テストの意図が明確になる

**How**:
```javascript
// Good: data-testid使用
<button data-testid="submit-task-btn">送信</button>

// Playwrightテスト
await page.getByTestId('submit-task-btn').click();

// Bad: テキストやCSSセレクタ使用
await page.getByText('送信').click(); // ❌ 文言変更で壊れる
await page.locator('.btn-primary').click(); // ❌ CSSクラス変更で壊れる
```

**思考パターン**:
```
要素取得が必要 → 「data-testidを使用しているか?」
AIにテスト作成依頼 → 「data-testid指定を指示したか?」
```

---

#### 2.4.2 test-idの一意性確保

**原則**: 共通コンポーネントではPropsで`data-testid`を動的に渡し、一意性を保つ

**Why**:
- test-id重複によるテスト失敗を防ぐ
- 複数インスタンスでも正しく要素を特定できる

**How**:
```javascript
// Good: Propsで動的にtest-id設定
export function TaskCard({ task, testId }) {
  return (
    <div data-testid={testId || `task-card-${task.id}`}>
      <button data-testid={`${testId}-complete-btn`}>完了</button>
    </div>
  );
}

// 使用側
<TaskCard task={task} testId="task-123" />

// Bad: 固定のtest-id
export function TaskCard({ task }) {
  return (
    <div data-testid="task-card"> {/* ❌ 重複する */}
      <button data-testid="complete-btn">完了</button>
    </div>
  );
}
```

**思考パターン**:
```
共通コンポーネント作成 → 「test-idが重複しないか?」
複数インスタンスを表示 → 「各インスタンスのtest-idが一意か?」
```

---

#### 2.4.3 外部サービスのモック化

**原則**: 認証サービス・外部API等は積極的にモック化する

**Why**:
- レート制限によるテスト失敗を防ぐ
- 外部サービスのダウンタイム影響を受けない
- テスト実行速度の向上

**How**:
```javascript
// Good: Auth0等の認証をモック
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page, context }) => {
  // 認証APIのモック
  await page.route('**/oauth/token', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        access_token: 'mock-token-123',
        expires_in: 3600
      })
    });
  });

  // セッションCookieを直接設定
  await context.addCookies([{
    name: 'session',
    value: 'mock-session-id',
    domain: 'localhost',
    path: '/'
  }]);
});

// Bad: 実際の認証サービスを使用
// ❌ レート制限でテストが失敗する
```

**AIへの指示例**:
```
「Auth0との接続部分をモックして、テストではモックトークンを使用してください」
「外部APIは page.route() でモック化してください」
```

**思考パターン**:
```
外部サービス接続 → 「モック化すべきか?」
テストが外部依存で失敗 → 「モックを追加できないか?」
```

---

#### 2.4.4 並列実行時のユーザー分離

**原則**: テストケースごとに異なるユーザーを使用し、データ競合を防ぐ

**Why**:
- テストAの実行中にテストBがデータをクリア → 失敗を防ぐ
- テストの独立性を保つ
- 並列実行でのフレーキネスを防ぐ

**How**:
```javascript
// Good: テストごとにユーザー分離
import { test } from '@playwright/test';

test.describe('タスク管理', () => {
  test('ユーザーAがタスクを作成', async ({ page }) => {
    // ユーザーAとしてログイン
    await loginAs(page, 'user-a@example.com');
    await page.getByTestId('create-task-btn').click();
    // ...
  });

  test('ユーザーBがタスクを削除', async ({ page }) => {
    // ユーザーBとしてログイン
    await loginAs(page, 'user-b@example.com');
    await page.getByTestId('delete-task-btn').click();
    // ...
  });
});

// Bad: 全テストで同じユーザー使用
// ❌ テスト間でデータが競合する
```

**playwright.config.ts設定**:
```typescript
export default defineConfig({
  workers: 4, // 並列実行数
  fullyParallel: true, // 完全並列実行
});
```

**思考パターン**:
```
並列テスト実行 → 「ユーザーが分離されているか?」
テストが不安定 → 「データ競合が原因ではないか?」
```

---

#### 2.4.5 共通処理の関数化

**原則**: 認証セッション取得・ページ遷移等の共通処理はヘルパー関数化する

**Why**:
- 変更漏れを防ぐ
- テストコードの重複を削減
- 保守性向上

**How**:
```javascript
// tests/helpers/auth.js
export async function loginAs(page, email) {
  await page.goto('/login');
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill('password123');
  await page.getByTestId('login-btn').click();
  await page.waitForURL('/dashboard');
}

export async function logout(page) {
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout-btn').click();
  await page.waitForURL('/login');
}

// テストファイル
import { loginAs, logout } from './helpers/auth.js';

test('タスク作成フロー', async ({ page }) => {
  await loginAs(page, 'user@example.com');
  // テストロジック
  await logout(page);
});
```

**ディレクトリ構造**:
```
tests/
├── e2e/
│   ├── task.spec.js
│   └── session.spec.js
├── helpers/
│   ├── auth.js       # 認証関連
│   ├── setup.js      # セットアップ関連
│   └── assertions.js # カスタムアサーション
└── fixtures/
    └── test-data.js  # テストデータ
```

**思考パターン**:
```
同じ処理を発見 → 「共通化できないか?」
認証処理を追加 → 「ヘルパー関数に集約されているか?」
```

---

#### 2.4.6 失敗時の動画記録

**原則**: テスト失敗時は動画を記録し、原因を可視化する

**Why**:
- 失敗原因が一目瞭然になる
- デバッグ効率が劇的に向上
- CIでの失敗も原因特定が容易

**How**:
```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    // 失敗時のみ動画を保存
    video: 'retain-on-failure',

    // スクリーンショットも保存
    screenshot: 'only-on-failure',

    // トレースも記録
    trace: 'retain-on-failure',
  },
});
```

**GitHub Actionsでの動画アップロード**:
```yaml
# .github/workflows/e2e-test.yml
- name: Upload test results
  if: failure()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-results
    path: |
      test-results/
      playwright-report/
    retention-days: 7
```

**AIへの指示例**:
```
「テスト失敗時の動画を確認したいので、playwright.config.tsでvideo設定を追加してください」
「このテストが失敗した原因を動画から分析して修正してください」
```

**思考パターン**:
```
テスト失敗 → 「動画で原因を確認できるか?」
デバッグに時間がかかる → 「動画・スクリーンショット・トレースを確認したか?」
```

---

#### 2.4.7 エラーログの出力

**原則**: 重要な処理では意図的にログを仕込み、失敗時の原因特定を容易にする

**Why**:
- E2Eテストは失敗原因が見えにくい（特に認証周り）
- CI環境とローカル環境の差分が明確になる
- デバッグ時間の短縮

**How**:
```javascript
// Good: ログを仕込む
test('タスク作成フロー', async ({ page }) => {
  // ページのコンソールログをキャプチャ
  page.on('console', (msg) => {
    console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
  });

  console.log('[Test] ログイン開始');
  await loginAs(page, 'user@example.com');

  console.log('[Test] タスク作成ボタンをクリック');
  await page.getByTestId('create-task-btn').click();

  console.log('[Test] タスク名を入力');
  await page.getByTestId('task-name-input').fill('新しいタスク');

  console.log('[Test] 保存ボタンをクリック');
  await page.getByTestId('save-btn').click();

  console.log('[Test] タスク一覧に遷移を待機');
  await page.waitForURL('/tasks');

  console.log('[Test] タスクが作成されたことを確認');
  await expect(page.getByTestId('task-123')).toBeVisible();
});
```

**ネットワークログのキャプチャ**:
```javascript
page.on('request', (request) => {
  console.log(`[Request] ${request.method()} ${request.url()}`);
});

page.on('response', (response) => {
  console.log(`[Response] ${response.status()} ${response.url()}`);
});
```

**AIへの指示例**:
```
「このテストにエラーログを仕込んで、失敗時の原因を特定しやすくしてください」
「ネットワークログもキャプチャして、API呼び出しの状況を確認できるようにしてください」
```

**思考パターン**:
```
デバッグが困難 → 「ログを追加すべきか?」
CI環境で失敗 → 「ローカルとの差分がログから見えるか?」
認証周りで失敗 → 「認証フローの各ステップでログを出力しているか?」
```

---

**AIへの統合指示例**:
```
「E2Eテストを作成する際は、以下のベストプラクティスを守ってください:
1. 要素取得は必ずdata-testidを使用
2. 共通コンポーネントはPropsでtest-idを動的に渡す
3. 外部サービス（Auth0等）はモック化
4. 並列実行時はユーザーを分離
5. 共通処理（認証等）はヘルパー関数化
6. playwright.config.tsでvideo: 'retain-on-failure'を設定
7. 重要な処理にはログを仕込む」
```

**Enforcement**:
- Skill: e2e-test-strategy
- CI Check: e2e-test-check.yml
- 参照: `.claude/skills/e2e-test-strategy/SKILL.md`

---

## 3. Refactoring Workflow

### 3.1 3-Phase Refactoring Strategy

brainbaseは現在、大規模リファクタリング中（3 Phases）

**Phase 1: Infrastructure** (完了)
- EventBus
- Reactive Store
- DI Container
- Service Layer

**Phase 2: Client** (進行中)
- UI Components
- API Client
- State Management

**Phase 3: Server** (計画中)
- MVC Architecture
- API Routes
- Database Layer

**思考パターン**:
```
リファクタリング開始 → 「どのPhaseに属するか?」
Phase間の依存 → 「Phase順序を守っているか?」
Phase完了判定 → 「Success Criteriaを満たしているか?」
```

**参照**: `docs/REFACTORING_PLAN.md`

---

### 3.2 Refactoring Rules

**原則**: 既存機能を壊さずに段階的に移行する

**5ステップ**:

1. **新しいパターンで実装**
   - 既存コードは残す
   - 新パターンで並行実装

2. **テスト追加**
   - カバレッジ80%以上
   - 既存テストも維持

3. **互換性確保**
   - 新旧両方が動作する状態を作る
   - フィーチャーフラグ等で切り替え可能に

4. **段階的移行**
   - 一部機能ずつ新パターンに切り替え
   - 問題があれば即座にロールバック

5. **旧コード削除**
   - 全機能の移行完了後
   - テストで動作確認してから削除

**思考パターン**:
```
リファクタリング実施 → 「この5ステップを守っているか?」
既存機能が壊れた → 「どのステップで失敗したか?」
```

**Enforcement**:
- Skill: refactoring-workflow
- CI Check: backward-compatibility-check.yml

---

### 3.3 Backward Compatibility

**原則**: 新APIを追加する際、旧APIも最低1ヶ月は残す

**Example**:
```javascript
// Phase 1: 旧API維持 + 新API追加
export function createProject(name) {  // 旧API
  console.warn('Deprecated: Use createProjectV2 instead');
  return createProjectV2({ name });
}

export function createProjectV2(options) {  // 新API
  // 新しい実装
}

// Phase 2: 移行期間（1ヶ月）
// 両方のAPIが動作

// Phase 3: 旧API削除
export function createProject(options) {
  // 新APIに統合
}
```

**思考パターン**:
```
新APIを追加 → 「旧APIも動作するか?」
破壊的変更が必要 → 「Deprecation Warningを出しているか?」
移行期間 → 「最低1ヶ月は旧APIを残すか?」
```

**Enforcement**:
- Skill: refactoring-workflow
- CI Check: backward-compatibility-check.yml

---

## 4. Security Guidelines

### 4.1 XSS Prevention

**原則**: ユーザー入力は常にエスケープする

**How**:
```javascript
// Good: textContentでエスケープ
element.textContent = userInput;

// Good: DOMPurifyでサニタイズ
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userInput);

// Bad: innerHTML直接代入
element.innerHTML = userInput; // ❌ XSS脆弱性
```

**利用可能なヘルパー**:
```javascript
// public/modules/utils/dom-helpers.js
export function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

**思考パターン**:
```
ユーザー入力を表示 → 「エスケープしているか?」
innerHTML使用 → 「本当に必要か? textContentで代替できないか?」
サニタイズが必要 → 「DOMPurify等のライブラリを使用しているか?」
```

**Enforcement**:
- Skill: security-patterns
- CI Check: xss-check.yml

---

### 4.2 CSRF Protection

**原則**: すべてのPOST/PUT/DELETEリクエストにCSRFトークンを付与

**How**:
```javascript
// Good: CSRFトークン付与
fetch('/api/projects', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': getCsrfToken(),
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(data)
});

// Bad: CSRFトークンなし
fetch('/api/projects', {
  method: 'POST',
  body: JSON.stringify(data)
}); // ❌ CSRF脆弱性
```

**サーバー側の検証**:
```javascript
// brainbase-ui/middleware/csrf-protection.js
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const token = req.headers['x-csrf-token'];
    if (!isValidToken(token)) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
  }
  next();
});
```

**思考パターン**:
```
POST/PUT/DELETE実行 → 「CSRFトークンを付与しているか?」
APIエンドポイント追加 → 「CSRF対策が必要か?」
フォーム送信 → 「CSRFトークンがhiddenフィールドに含まれているか?」
```

**Enforcement**:
- Skill: security-patterns
- CI Check: csrf-check.yml

---

### 4.3 Input Validation

**原則**: ユーザー入力は常にバリデーションする

**How**:
```javascript
// Good: バリデーション実施
function createProject(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid name');
  }
  if (name.length > 100) {
    throw new Error('Name too long');
  }
  if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
    throw new Error('Invalid characters');
  }
  // プロジェクト作成処理
}

// Bad: バリデーションなし
function createProject(name) {
  // 直接DBに保存 ❌ SQLインジェクション等のリスク
}
```

**利用可能なバリデーター**:
```javascript
// public/modules/utils/validators.js
export const validators = {
  projectName: (name) => /^[a-zA-Z0-9-_]+$/.test(name),
  email: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
  url: (url) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
};
```

**思考パターン**:
```
ユーザー入力を処理 → 「バリデーションしているか?」
数値入力 → 「範囲チェックしているか?」
文字列入力 → 「長さ制限・文字種制限しているか?」
```

**Enforcement**:
- Skill: security-patterns
- CI Check: input-validation-check.yml

---

## 5. Code Style & Conventions

### 5.1 Naming Conventions

**ファイル名**: kebab-case (`task-service.js`)
**クラス名**: PascalCase (`TaskService`)
**変数名**: camelCase (`currentSessionId`)
**定数名**: SCREAMING_SNAKE_CASE (`MAX_PROJECTS`)
**イベント名**: ドメイン:動作形式 (`task:completed`)

**Example**:
```javascript
// ファイル: public/modules/domain/task/task-service.js
export class TaskService {  // PascalCase
  constructor() {
    this.maxRetries = 3;          // camelCase
    this.MAX_TASKS_PER_PAGE = 50; // SCREAMING_SNAKE_CASE
  }
}
```

**思考パターン**:
```
新ファイル作成 → 「kebab-caseか?」
新クラス作成 → 「PascalCaseか?」
新変数作成 → 「camelCaseか? 定数ならSCREAMING_SNAKE_CASEか?」
```

**Enforcement**:
- Skill: code-style
- CI Check: naming-convention-check.yml

---

### 5.2 Import Order

**順序**:
1. Node.js built-in modules
2. Third-party modules
3. Internal modules (absolute path)
4. Relative modules

**Example**:
```javascript
// 1. Node.js built-in
import fs from 'fs';
import path from 'path';

// 2. Third-party
import express from 'express';
import DOMPurify from 'dompurify';

// 3. Internal (absolute)
import { eventBus } from '/modules/core/event-bus.js';
import { appStore } from '/modules/core/store.js';

// 4. Relative
import { TaskService } from './task-service.js';
import { validators } from '../utils/validators.js';
```

**思考パターン**:
```
import追加 → 「正しい順序か?」
```

**Enforcement**:
- Skill: code-style
- CI Check: import-order-check.yml

---

## 6. Subagent Workflow

### 6.1 標準開発フロー

**Explore → Plan → Branch → Edit → Test → Commit → Merge**

**Phase 1: Explore** (調査)
- 既存コードの理解
- 影響範囲の特定
- 依存関係の確認
- **装備Skills**: architecture-patterns, refactoring-workflow

**Phase 2: Plan** (設計)
- 実装方針の決定
- Skills適合性の確認
- トレードオフの検討
- **装備Skills**: architecture-patterns, test-strategy, refactoring-workflow

**Phase 2.5: Branch** (ブランチ作成)
- session/* branchの作成
- session/YYYY-MM-DD-<type>-<name> 命名規則
- `/commit`コマンドとの整合性確保
- **装備Skills**: git-workflow

**Phase 3: Edit** (実装)
- TDD実装 (Red-Green-Refactor)
- Skills準拠の確認
- リファクタリング
- **装備Skills**: tdd-workflow, architecture-patterns, code-style, security-patterns

**Phase 4: Test** (検証)
- ユニットテスト追加
- カバレッジ確認 (80%以上)
- 既存テストのパス確認
- **装備Skills**: test-strategy

**Phase 5: Commit** (コミット)
- Decision-making capture (悩み→判断→結果)
- Conventional Commits形式
- Branch safety check
- **Custom Command**: `/commit`
- **装備Skills**: git-workflow

**Phase 6: Merge** (マージ)
- --no-ff merge commit
- Feature branch cleanup
- Mode selection (Safe/Fast)
- **Custom Command**: `/merge`
- **装備Skills**: git-workflow

**使用例**:
```bash
# 1. Explore: 既存コード調査
User: "プロジェクト作成機能を理解したい"
Claude Code: [Explore Agent起動] → event-bus.js, project-service.js等を調査

# 2. Plan: 実装方針決定
User: "プロジェクト削除機能を追加したい"
Claude Code: [Plan Mode起動] → Plan file作成

# 2.5. Branch: ブランチ作成
Claude Code: [git-workflow装備] → session/2025-12-29-feature-project-delete作成

# 3. Edit: TDD実装
Claude Code: [tdd-workflow, architecture-patterns, security-patterns装備]
→ Red: 失敗するテストを書く
→ Green: 仮実装 → 三角測量 → 明白な実装
→ Refactor: 重複除去

# 4. Test: テスト追加・実行
Claude Code: [test-strategy装備] → テスト追加 → vitest実行 → カバレッジ80%以上

# 5. Commit: Decision capture
User: "/commit"
Claude Code: [/commit実行] → 悩み→判断→結果を記録 → Conventional Commits

# 6. Merge: mainへ統合
User: "/merge"
Claude Code: [/merge実行] → --no-ff merge → branch cleanup
```

---

### 6.2 Subagent設定

**Explore Agent**:
- **目的**: 既存コード調査・影響範囲特定
- **thoroughness**: `quick` (基本), `medium` (中規模), `very thorough` (大規模)

**Plan Agent**:
- **目的**: 実装方針決定・設計
- **EnterPlanMode**: Plan file作成

**Test Agent**:
- **目的**: テスト追加・実行
- **ツール**: Bash (vitest, playwright実行)

**Commit Agent**:
- **目的**: コミット・PR作成
- **Skill**: `/commit`

---

## 7. GitHub Actions CI

### 7.1 CI Checks

**必須チェック** (PRマージ前):
1. **architecture-check**: アーキテクチャパターン準拠確認
2. **test-coverage**: テストカバレッジ80%以上
3. **security-check**: XSS/CSRF脆弱性チェック
4. **naming-convention**: 命名規則チェック
5. **import-order**: import順序チェック

**実行方法**:
```bash
# ローカルで実行
npm run lint:architecture
npm run test:coverage
npm run lint:security
npm run lint:naming
npm run lint:imports
```

---

### 7.2 PR Template

**必須項目**:
- [ ] Skills準拠確認 (architecture-patterns, test-strategy等)
- [ ] テストカバレッジ80%以上
- [ ] DESIGN.md/REFACTORING_PLAN.md との整合性
- [ ] セキュリティ脆弱性なし
- [ ] バックワード互換性確保 (破壊的変更の場合は明記)

**PRテンプレート**: `.github/pull_request_template.md`

---

## 8. ドキュメント間の役割分担

### CLAUDE.md (このファイル)
- **役割**: 思考フレームワーク・ルール・ワークフロー
- **対象**: 開発時の判断基準、コーディング規約、Subagentワークフロー

### DESIGN.md
- **役割**: アーキテクチャ詳細（技術的深掘り）
- **対象**: UI/UXデザイン、データフロー、レイアウト仕様

### HANDOFF.md
- **役割**: 引き継ぎガイド（プロジェクト固有情報）
- **対象**: セットアップ手順、環境変数、デプロイ方法

### docs/REFACTORING_PLAN.md
- **役割**: リファクタリング計画（詳細設計）
- **対象**: 3-Phase戦略、移行計画、コードメトリクス

---

## 9. 参照リンク

### 内部ドキュメント
- [DESIGN.md](./DESIGN.md): UI/UX設計
- [HANDOFF.md](./HANDOFF.md): 引き継ぎガイド
- [docs/REFACTORING_PLAN.md](./docs/REFACTORING_PLAN.md): リファクタリング計画

### 外部リソース
- [Claude Code Documentation](https://claude.com/claude-code)
- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)

---

**最終更新**: 2025-12-31
**作成者**: Unson LLC
**ステータス**: Active

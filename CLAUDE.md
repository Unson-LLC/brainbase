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

// タスク完了時（同期イベント発火）
eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: '123', project: 'brainbase' });

// 別モジュールでリスニング（同期ハンドラー）
eventBus.on(EVENTS.TASK_COMPLETED, (event) => {
  console.log('Task completed:', event.detail);
});

// 非同期処理が必要な場合（onAsync使用）
eventBus.onAsync(EVENTS.SESSION_CHANGED, async (event) => {
  const { sessionId } = event.detail;
  // 非同期処理（API呼び出し等）
  await switchSession(sessionId);
  await loadSessionData(sessionId);
});

// 非同期イベント発火（エラーハンドリング付き）
const { success, errors } = await eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: '123' });
if (errors.length > 0) {
  console.error('Some handlers failed:', errors);
}

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
非同期処理が必要 → 「onAsync()を使用しているか?」
エラーハンドリングが必要 → 「emit()の戻り値（success, errors）を確認しているか?」
```

**Enforcement**:
- ファイル: `public/modules/core/event-bus.js`
- Skill: architecture-patterns ✅
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
- Skill: architecture-patterns ✅
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
- Skill: architecture-patterns ✅
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
- Skill: architecture-patterns ✅
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
- Skill: tdd-workflow ✅
- CI Check: tdd-check.yml
- 参照: `.claude/skills/tdd-workflow/SKILL.md`

---

### 1.6 Spec-Driven Development (SDD) for Large-Scale Features

**原則**: 大規模機能開発（3+ファイル）はcc-sddのSpec-Driven Workflowを使用する

**Why**:
- 要件の明確化（実装前に仕様を承認）
- 手戻りの削減（設計段階でのレビュー）
- 並列実装可能（依存関係の明確化）
- ドキュメント自動生成（specs/に仕様が残る）

**使用基準**:
```
3+ファイルの変更 → cc-sdd
クロスモジュール変更 → cc-sdd
新ドメイン追加 → cc-sdd
バグ修正/リファクタ → TDD（従来通り）
```

**Workflow**:
```
/kiro:steering (既存コード強化) または /kiro:spec-init (新規機能)
    ↓
/kiro:spec-requirements → 要件定義 (EARS形式)
    ↓
/kiro:validate-gap → 人間による承認
    ↓
/kiro:spec-design → 設計 (Mermaid図)
    ↓
/kiro:validate-design → 人間による承認
    ↓
/kiro:spec-tasks → タスク分解 (依存関係付き)
    ↓
session/* branch作成
    ↓
/kiro:spec-impl → 実装 (TDDサイクル適用)
    ↓
git commit → git merge（手動）

※ /commit, /mergeコマンドが利用可能になり次第、手動操作を置き換え
```

**成果物の保存先**:
```
.kiro/specs/{feature-name}/
├── requirements.md    # 要件定義
├── design.md          # 設計書
└── tasks.md           # タスク一覧
```

**思考パターン**:
```
大規模機能開発 → 「cc-sddを使用すべきか?」
3+ファイル変更 → 「/kiro:spec-initから始めるか?」
既存機能拡張 → 「/kiro:steeringが適切か?」
実装開始前 → 「validate-gapで承認を得たか?」
```

**Enforcement**:
- ファイル: `.kiro/specs/{feature}/requirements.md`, `design.md`, `tasks.md`
- 承認ゲート: `/kiro:validate-gap`, `/kiro:validate-design`
- ルール: `.kiro/settings/rules/brainbase-architecture.md`

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
- ツール: Playwright（推奨）, Chrome DevTools MCP（軽量・デバッグ用）
- 実行頻度: CI (PRマージ前)

**使い分け**:
- **Playwright**: 複雑なシナリオ、クロスブラウザテスト、並列実行
- **Chrome DevTools MCP**:
  - 開発中のクイック検証（スクリーンショット、コンソール確認）
  - CI/CDでの軽量E2Eチェック
  - デバッグ・トラブルシューティング

**思考パターン**:
```
新機能実装 → 「まずUnit Testを書いたか?」
E2Eテストが増加 → 「Unit/APIテストで代替できないか?」
カバレッジが低い → 「Unit Testを追加すべきか?」
```

**Enforcement**:
- Skill: test-strategy ✅
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
- Skill: test-strategy ✅
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
- Skill: test-strategy ✅
- CI Check: test-coverage-check.yml

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
- Skill: refactoring-workflow ✅
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
- Skill: refactoring-workflow ✅
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
- Skill: security-patterns ✅
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
- Skill: security-patterns ✅
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
- Skill: security-patterns ✅
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
- Skill: code-style（Linterで実現: naming-convention、import-orderは機械的チェック）
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
- Skill: code-style（Linterで実現: naming-convention、import-orderは機械的チェック）
- CI Check: import-order-check.yml

---

## 6. Subagent Workflow

### 6.1 標準開発フロー

**Explore → [Spec Phase (大規模のみ)] → Plan → Branch → Edit → Test → Review & Replan → Commit → Merge**

**Phase 1: Explore** (調査)
- 既存コードの理解
- 影響範囲の特定
- 依存関係の確認
- **装備Skills**: architecture-patterns, refactoring-workflow

**Phase 1.5: Spec Phase** (大規模機能のみ - CLAUDE.md 1.6参照)
- **対象**: 3+ファイル変更、クロスモジュール、新ドメイン追加
- `/kiro:steering` (既存コード強化) または `/kiro:spec-init` (新規)
- `/kiro:spec-requirements` → EARS形式要件
- `/kiro:validate-gap` → 人間承認
- `/kiro:spec-design` → Mermaid設計図
- `/kiro:validate-design` → 人間承認
- `/kiro:spec-tasks` → タスク分解
- **装備Skills**: cc-sdd commands, architecture-patterns
- **成果物**: `.kiro/specs/{feature}/requirements.md`, `design.md`, `tasks.md`

**Phase 2: Plan** (設計)
- 実装方針の決定（Spec Phaseを使用した場合はスキップ可）
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

**Phase 5: Review & Replan** (レビュー・軌道修正)
- **実装成果物のレビュー**
  - 要件との整合性確認（Requirement Alignment Check）
  - 設計一貫性確認（Design Consistency Check）
  - 影響範囲検証（Impact Range Validation）
- **差分検出とリスク判定**
  - Critical: リプラン必須（即座に修正指示）
  - Minor: 警告+進行許可（記録して継続）
  - None: 承認（次Phaseへ）
- **リプラン実行**（必要に応じて）
  - Subagentへの修正指示（差分の明示化）
  - Success Criteriaの再定義
  - 修正実装 + 再レビュー（Phase 3/4へ戻る）
  - Max Retries管理（上限3回、超過時は人間へエスカレーション）
- **思考パターン**:
  ```
  成果物確認 → 「要件を満たしているか？」
  テスト結果確認 → 「期待値と実際の差分は？」
  差分検出 → 「Critical/Minor/Noneのどれか？」
  Critical判定 → 「どう修正すべきか明示できるか？」
  リプラン実行 → 「Subagentへの指示は明確か？」
  ```
- **既存パターンとの整合性**:
  - **TDDのRed-Green-Refactor**: テスト失敗（RED）→ 実装（GREEN）→ レビュー（REFACTOR）
  - **EventBusのemit-listen-react**: emit（成果物提出）→ listen（レビュー検知）→ react（判定＆フィードバック）
  - **Orchestration**: Subagent実行 → 成果物レビュー → リプラン → 再実行

**Phase 6: Commit** (コミット)
- Decision-making capture (悩み→判断→結果)
  - 何を検討したか（技術選択、実装方針）
  - どう判定したか（レビュー基準、合格/不合格）
  - 修正ループの履歴（リプラン実施回数、主要な修正内容）
- Conventional Commits形式
- Branch safety check
- **Custom Command**: `/commit`
- **装備Skills**: git-workflow

**Phase 7: Merge** (マージ)
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

# 5. Review & Replan: レビュー・軌道修正
Claude Code: [成果物レビュー]
→ 要件との整合性確認（✅ 合格）
→ 設計一貫性確認（✅ 合格）
→ テストカバレッジ確認（✅ 85%）
→ 差分検出（None: 承認）
→ 次Phaseへ進行

# 5'. Review & Replan: リプラン実行例（差分検出時）
Claude Code: [成果物レビュー]
→ 要件との整合性確認（❌ 不合格: EventBus通知が未実装）
→ 差分検出（Critical: リプラン必須）
→ Subagentへ修正指示: "削除時にEVENTS.PROJECT_DELETEDイベントを発火してください"
→ [Phase 3へ戻る] → 修正実装 → 再テスト → 再レビュー（✅ 合格）

# 6. Commit: Decision capture
User: "/commit"
Claude Code: [/commit実行]
→ 悩み: EventBus通知の実装忘れ
→ 判断: レビューで検出し修正指示
→ 結果: 1回のリプランで要件を満たす実装に修正
→ Conventional Commits

# 7. Merge: mainへ統合
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

### 6.3 Orchestrator Review Framework

**目的**: Orchestrator（Main）がSubagentの成果物を体系的にレビューし、リプラン・再実行を自動化するための標準フレームワーク

#### 6.3.1 レビュー実施の4ステップ

**Step 1: ファイル存在確認**
```yaml
target:
  - 成果物ファイルの存在確認
  - 空ファイルでないことの確認
  - 最終更新時刻がPhase開始時刻以降であることの確認

criteria:
  - file exists AND not empty
  - last_modified >= phase_start_time

判定:
  - ✅ PASS: 全ファイルが存在し、空でない
  - ❌ FAIL: ファイル不在 or 空ファイル → リプラン（Critical）
```

**Step 2: Success Criteriaチェック**
```yaml
target:
  - 各PhaseのSuccess Criteriaが定義されているか
  - 各Criteriaが達成されているか

criteria:
  - [✅] SC-1: XXXが含まれている（expected: YES, actual: ?）
  - [✅] SC-2: YYYが明確である（expected: YES, actual: ?）

判定:
  - ✅ PASS: 全Success Criteriaを満たす
  - ⚠️ MINOR: 一部Criteriaを満たさない（警告+進行許可）
  - ❌ CRITICAL: 重要Criteriaを満たさない → リプラン必須
```

**Step 3: 差分分析（要件との整合性）**
```yaml
target:
  - 期待値（要件・設計）vs 実際（成果物）の差分
  - Skills基準（strategy-template, raci-format等）への準拠

criteria:
  - ICP定義は strategy-template基準を満たすか → [✅/❌]
  - タスクの粒度は妥当か（1-3日単位か） → [✅/❌]
  - KPIの定量性があるか → [✅/❌]
  - RACI定義は raci-format基準を満たすか → [✅/❌]

判定:
  - ✅ PASS: 差分なし or 許容範囲内
  - ⚠️ MINOR: 軽微な差分（記録して進行）
  - ❌ CRITICAL: 重大な差分 → リプラン必須
```

**Step 4: リスク判定とアクション決定**
```yaml
リスクレベル:
  - Critical: 要件を満たさない、次Phaseの実行が不可能
  - Minor: 改善余地あり、次Phaseは実行可能
  - None: 問題なし

アクション:
  - Critical → リプラン実行（Subagentへ修正指示）
  - Minor → 警告記録 + 次Phaseへ進行
  - None → 承認 + 次Phaseへ進行
```

---

#### 6.3.2 リプラン実行フロー

**リプラン実行の5ステップ**:

```
1. Issue Detection（問題検出）
   - Success Criteriaの不合格項目を特定
   - 差分の詳細化（期待値 vs 実際）
   - リスクレベルの判定（Critical/Minor/None）

2. Feedback Generation（フィードバック生成）
   - 何が要件と異なるか（差分の明示化）
   - どう修正すべきか（修正方向の提示）
   - 修正チェックリストの作成（具体的なタスク化）

3. Replan Prompt Creation（リプランプロンプト作成）
   - 元のタスク + フィードバック
   - Success Criteriaの再定義（修正後の期待値）
   - 修正実装のガイドライン

4. Subagent Re-execution（Subagent再実行）
   - Task Tool経由で同じSubagentを再起動
   - リプランプロンプトを入力
   - 修正成果物を取得

5. Re-Review（再レビュー）
   - 修正成果物を同じ基準で再評価
   - PASS → 次Phaseへ
   - FAIL → リトライカウント確認
     - リトライ < Max (3回) → ステップ1へ戻る
     - リトライ >= Max → 人間へエスカレーション
```

---

#### 6.3.3 実装パターン（Orchestrator SKILL.md）

**テンプレート**:
```markdown
# Orchestrator Skill Template

## Orchestrator Responsibilities

### Phase Management
- Phase順序の管理
- Phase間のデータ受け渡し検証
- 各Phaseの完了確認

### Review & Replan
**Review実施**:
1. ファイル存在確認
   - Phase 1成果物: `01_strategy.md`
   - Phase 2成果物: `_codex/common/meta/raci/{project_id}.md`

2. Success Criteriaチェック
   - Phase 1 SC-1: ICP定義が含まれているか
   - Phase 1 SC-2: 価値提案が明確か
   - Phase 2 SC-1: RACI定義が完全か

3. 差分分析
   - strategy-template基準への準拠（Phase 1）
   - raci-format基準への準拠（Phase 2）

4. リスク判定
   - Critical: リプラン実行
   - Minor: 警告+進行
   - None: 承認

**Replan実行**:
- Issue Detection: 不合格項目の特定
- Feedback Generation: 修正方針の明示化
- Subagent Re-execution: Task Tool経由で再起動
- Re-Review: 同じ基準で再評価
- Max Retries: 3回（超過時は人間へエスカレーション）

### Error Handling
- Phase実行失敗時のフォールバック
- データ不足時の追加情報取得（AskUserQuestion）
- Max Retries超過時の人間へのエスカレーション
```

---

#### 6.3.4 既存Orchestratorへの適用

**適用対象**:
- `project-onboarding` (6 Phase)
- `90day-checklist` (2 Phase)
- `test-workflow-validator` (2 Phase)
- `tdd-workflow` (4 Phase)
- `marketing-strategy-planner` (4 Phase)
- `sns-smart` (5 Phase)

**適用方法**:
1. 各Orchestrator SKILL.mdの「Orchestrator Responsibilities」セクションに「Review & Replan」を追加
2. 各PhaseのSuccess Criteriaを明示化
3. リプラン実行フローを追加
4. Max Retriesとエスカレーション基準を定義

**実装チェックリスト**:
- [ ] ファイル存在確認ロジックの追加
- [ ] Success Criteriaの明示化
- [ ] 差分分析基準（Skills準拠）の定義
- [ ] リスク判定基準の明確化
- [ ] リプランプロンプト生成ロジックの実装
- [ ] Max Retries管理の実装
- [ ] 人間へのエスカレーション基準の定義

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

### .kiro/specs/{feature}/
- **役割**: 大規模機能の仕様書（cc-sdd生成）
- **対象**: 要件定義（requirements.md）、設計書（design.md）、タスク一覧（tasks.md）
- **関係**: docs/REFACTORING_PLAN.mdの詳細版（機能単位）
- **使用条件**: 3+ファイル変更、クロスモジュール、新ドメイン追加時

### .kiro/settings/
- **役割**: cc-sddテンプレートとルール（brainbaseカスタマイズ済み）
- **対象**: 仕様書テンプレート、アーキテクチャルール
- **重要ファイル**: `rules/brainbase-architecture.md`

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

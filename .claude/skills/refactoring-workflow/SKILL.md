---
name: refactoring-workflow
description: brainbaseの3-Phase段階的リファクタリング戦略を実行する思考フレームワーク
setting_sources: ["user", "project"]
---

# brainbase Refactoring Workflow

## Purpose

大規模リファクタリングを段階的に実行し、既存機能を壊さず移行する。

**適用タイミング**:
- リファクタリング計画時
- 実装時（5ステップの遵守）
- PR作成時（Backward Compatibilityの確認）

## Thinking Framework

### 1. 3-Phase Refactoring Strategy

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
- リファクタリング開始 → 「どのPhaseに属するか？」
- Phase間の依存 → 「Phase順序を守っているか？」
- Phase完了判定 → 「Success Criteriaを満たしているか？」

**Why**:
- 段階的移行によるリスク最小化
- Phase完了ごとに動作確認
- ロールバック可能な状態を維持

**参照**: `docs/REFACTORING_PLAN.md`

---

### 2. Refactoring Rules (5 Steps)

**原則**: 既存機能を壊さずに段階的に移行する

**5ステップ**:

#### Step 1: 新しいパターンで実装
- 既存コードは残す
- 新パターンで並行実装
- 既存機能に影響を与えない

**Example**:
```javascript
// 既存コード（app.js）- そのまま残す
function loadTasks() {
  fetch('/api/tasks')
    .then(res => res.json())
    .then(data => {
      tasks = data.tasks;
      renderTasks();
    });
}

// 新パターン（TaskService）- 並行実装
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
    this.store.setState({ tasks: filtered });
    this.eventBus.emit(EVENTS.TASK_LOADED, { tasks: filtered });
    return filtered;
  }
}
```

#### Step 2: テスト追加
- カバレッジ80%以上
- 既存テストも維持
- 新パターンの動作を保証

**Example**:
```javascript
// tests/unit/task-service.test.js
describe('TaskService', () => {
  it('getTasks呼び出し時_タスク一覧が返される', async () => {
    const mockRepo = {
      fetchTasks: vi.fn().mockResolvedValue([{ id: '1' }])
    };
    const service = new TaskService({ repository: mockRepo });

    const tasks = await service.getTasks({});

    expect(tasks).toHaveLength(1);
  });
});
```

#### Step 3: 互換性確保
- 新旧両方が動作する状態を作る
- フィーチャーフラグ等で切り替え可能に
- 段階的な移行を可能にする

**Example**:
```javascript
// app.js - フィーチャーフラグで切り替え
const USE_NEW_TASK_SERVICE = true; // 環境変数から取得可能に

async function loadTasks() {
  if (USE_NEW_TASK_SERVICE) {
    // 新パターン
    const taskService = container.get('taskService');
    await taskService.getTasks({});
  } else {
    // 旧パターン
    fetch('/api/tasks')
      .then(res => res.json())
      .then(data => {
        tasks = data.tasks;
        renderTasks();
      });
  }
}
```

#### Step 4: 段階的移行
- 一部機能ずつ新パターンに切り替え
- 問題があれば即座にロールバック
- 本番環境での動作確認

**Example**:
```javascript
// Week 1: タスク読み込みのみ新パターンに
loadTasks → TaskService.getTasks()

// Week 2: タスク完了も新パターンに
completeTask → TaskService.completeTask()

// Week 3: タスク削除も新パターンに
deleteTask → TaskService.deleteTask()

// 各週ごとに本番デプロイして動作確認
```

#### Step 5: 旧コード削除
- 全機能の移行完了後
- テストで動作確認してから削除
- コメントで旧コードの場所を記録

**Example**:
```javascript
// app.js
// ❌ 削除: 旧パターン
// function loadTasks() {
//   fetch('/api/tasks')
//     .then(res => res.json())
//     .then(data => {
//       tasks = data.tasks;
//       renderTasks();
//     });
// }

// ✅ 新パターンのみ残す
async function loadTasks() {
  const taskService = container.get('taskService');
  await taskService.getTasks({});
}
```

**思考パターン**:
```
リファクタリング実施 → 「この5ステップを守っているか？」
既存機能が壊れた → 「どのステップで失敗したか？」
新パターンに移行 → 「Step 1-3を完了してからStep 4に進んでいるか？」
```

---

### 3. Backward Compatibility

**原則**: 新APIを追加する際、旧APIも最低1ヶ月は残す

**思考パターン**:
- 新APIを追加 → 「旧APIも動作するか？」
- 破壊的変更が必要 → 「Deprecation Warningを出しているか？」
- 移行期間 → 「最低1ヶ月は旧APIを残すか？」

**Why**:
- ユーザーに移行時間を提供
- 段階的な移行を可能にする
- 本番環境での影響を最小化

**Example**:
```javascript
// Phase 1: 旧API維持 + 新API追加 + Deprecation Warning
export function createProject(name) {  // 旧API
  console.warn(
    'Deprecated: createProject(name) is deprecated. Use createProjectV2(options) instead. ' +
    'This function will be removed on 2025-02-01.'
  );
  return createProjectV2({ name });
}

export function createProjectV2(options) {  // 新API
  const { name, description, tags } = options;
  // 新しい実装
}

// Phase 2: 移行期間（1ヶ月）
// 両方のAPIが動作
// ログでDeprecation Warningを確認し、利用状況を監視

// Phase 3: 旧API削除（2025-02-01以降）
export function createProject(options) {
  // 新APIに統合（関数名はそのまま、引数が変更）
  const { name, description, tags } = options;
  // ...
}
```

**Deprecation Warningの管理**:
```javascript
// public/modules/utils/deprecation.js
const DEPRECATION_WARNINGS = new Set();

export function deprecate(message, removalDate) {
  // 同じ警告を複数回表示しない
  if (DEPRECATION_WARNINGS.has(message)) return;

  DEPRECATION_WARNINGS.add(message);

  console.warn(
    `[DEPRECATION] ${message}`,
    `This will be removed on ${removalDate}.`
  );

  // 本番環境ではログサービスに送信
  if (window.ENV === 'production') {
    logToService('deprecation', { message, removalDate });
  }
}
```

---

## Usage

このSkillは以下のタイミングで使用される:

1. **リファクタリング計画時**: どのPhaseに属するか判断
2. **実装時**: 5ステップの遵守
3. **PR作成時**: Backward Compatibilityの確認

**使用例**:

```
User: "TaskServiceをリファクタリングしたい"

Claude Code: [refactoring-workflow Skillを装備]

思考プロセス:
1. 3-Phase Strategy: Phase 2 (Client) に属する
2. 5 Steps:
   - Step 1: 新TaskServiceを並行実装
   - Step 2: Unit Testを追加（カバレッジ80%以上）
   - Step 3: フィーチャーフラグで切り替え可能に
   - Step 4: 一部機能ずつ新パターンに移行
   - Step 5: 旧コード削除（全機能移行後）
3. Backward Compatibility: 旧loadTasks()にDeprecation Warning追加

実装:
1. public/modules/domain/task/task-service.js 作成
2. tests/unit/task-service.test.js 作成
3. app.js にフィーチャーフラグ追加
4. 段階的に移行（Week 1: getTasks, Week 2: completeTask, ...）
5. 旧コード削除（1ヶ月後）
```

---

## Success Criteria

- [ ] 既存機能が壊れていない
- [ ] テストカバレッジが維持されている（80%以上）
- [ ] Backward Compatibilityが確保されている
- [ ] ドキュメント（REFACTORING_PLAN.md）が更新されている
- [ ] Phase順序が守られている
- [ ] 5ステップが完了している
- [ ] Deprecation Warningが適切に出ている

---

## Enforcement

### Local
- このSkillを装備したClaude Codeが自動チェック
- リファクタリング計画の妥当性を検証

### CI
- GitHub Actions で `backward-compatibility-check.yml` が実行
- PRマージ前に互換性を確認

**チェック項目**:
```bash
# 公開APIの変更を検出
git diff origin/main...HEAD -- 'public/modules/**/*.js' | grep "^-export" > removed_exports.txt || true
if [ -s removed_exports.txt ]; then
  echo "❌ Error: Breaking changes detected (removed exports)"
  cat removed_exports.txt
  exit 1
fi
```

---

## Troubleshooting

### 問題1: 旧コードと新コードの両立が困難

**症状**: フィーチャーフラグが複雑になりすぎる

**原因**:
- 旧コードと新コードの設計が大きく異なる
- グローバル変数への依存が強い

**対処**:
```javascript
// ❌ Bad: フィーチャーフラグが至る所に
function loadTasks() {
  if (USE_NEW) { /* 新 */ } else { /* 旧 */ }
}
function completeTask() {
  if (USE_NEW) { /* 新 */ } else { /* 旧 */ }
}

// ✅ Good: Adapter Patternで抽象化
class TaskAdapter {
  constructor(useNew) {
    this.impl = useNew ? new TaskService() : new LegacyTaskHandler();
  }

  async loadTasks() {
    return this.impl.loadTasks();
  }

  async completeTask(id) {
    return this.impl.completeTask(id);
  }
}

const taskAdapter = new TaskAdapter(USE_NEW_TASK_SERVICE);
```

---

### 問題2: Phase間の依存で進められない

**症状**: Phase 2の実装がPhase 1未完了でブロックされる

**原因**:
- Phase順序を守っていない
- Phase 1の未完了部分がある

**対処**:
```markdown
# REFACTORING_PLAN.mdで進捗確認
## Phase 1: Infrastructure
- [x] EventBus
- [x] Reactive Store
- [x] DI Container
- [ ] Service Layer ← 未完了

→ Phase 1を完了させてからPhase 2に進む
```

---

### 問題3: Deprecation Warningが多すぎて見逃す

**症状**: コンソールが警告だらけで重要な警告を見逃す

**原因**:
- 同じ警告が何度も表示される
- 警告の優先度が不明

**対処**:
```javascript
// ✅ Good: 警告を集約して表示
const deprecationSummary = () => {
  if (DEPRECATION_WARNINGS.size === 0) return;

  console.group(`⚠️  ${DEPRECATION_WARNINGS.size} Deprecation Warnings`);
  DEPRECATION_WARNINGS.forEach(warning => console.warn(warning));
  console.groupEnd();
};

// アプリケーション起動時に1回だけ表示
window.addEventListener('DOMContentLoaded', deprecationSummary);
```

---

### 問題4: 移行完了の判断基準が不明確

**症状**: いつ旧コードを削除すべきかわからない

**原因**:
- 利用状況の監視ができていない
- 移行完了の定義が不明確

**対処**:
```javascript
// 利用状況を監視
export function createProject(name) {
  // ログに記録
  logUsage('createProject', { timestamp: Date.now() });

  console.warn('Deprecated: Use createProjectV2 instead');
  return createProjectV2({ name });
}

// 移行完了の定義
// - 過去1週間、旧APIの利用が0件
// - すべての既知の呼び出し元が新APIに移行済み
// - テストが100%パス

// → 上記を満たしたら旧APIを削除
```

---

## References

### 内部ドキュメント
- [CLAUDE.md](../../CLAUDE.md): 開発標準全体
- [docs/REFACTORING_PLAN.md](../../docs/REFACTORING_PLAN.md): リファクタリング詳細計画

### Phase別の進捗
```markdown
# docs/REFACTORING_PLAN.md から抜粋

## Phase 1: Infrastructure (完了)
- [x] EventBus実装
- [x] Reactive Store実装
- [x] DI Container実装
- [x] Service Layer基盤

## Phase 2: Client (進行中)
- [ ] TaskView実装
- [ ] SessionView実装
- [ ] TimelineView実装

## Phase 3: Server (計画中)
- [ ] MVC Architecture
- [ ] ルート分割
- [ ] Controller/Service分離
```

---

**最終更新**: 2025-12-29
**M5.3 - Development Workflow Standardization**
**Week 2 Day 3: refactoring-workflow Skill**

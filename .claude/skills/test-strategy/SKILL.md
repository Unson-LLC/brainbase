---
name: test-strategy
description: brainbaseのテスト戦略（Test Pyramid: 80%/15%/5%）を強制する思考フレームワーク
setting_sources: ["user", "project"]
---

# brainbase Test Strategy

## Purpose

Test Pyramid原則に基づき、高速フィードバックループと高いテストカバレッジを実現する。

**適用タイミング**:
- 新機能実装時
- バグ修正時
- リファクタリング時
- PR作成時

**test-strategyとtdd-workflowの関係**:
```
test-strategy (このSkill)     静的な戦略 - What & How much
  ↓ 参照される                 「何をテストするか、どれくらいテストするか」
tdd-workflow                   動的なプロセス - How & When
                               「どのようにテストを書くか、どのように実装するか」
```

- **test-strategy**: テスト戦略（Test Pyramid、カバレッジ、命名規則）を定義
- **tdd-workflow**: TDD実践プロセス（Red-Green-Refactor、Test-First）を定義
- 両者は補完関係にあり、組み合わせることで完全なテスト開発環境を実現

**詳細**: TDD実践プロセスについては [tdd-workflow Skill](../tdd-workflow/SKILL.md) を参照

## Thinking Framework

### 1. Test Pyramid

**原則**: Unit (80%) / API (15%) / E2E (5%)

**思考パターン**:
- 新機能実装 → 「まずUnit Testを書いたか？」
- E2Eテストが増加 → 「Unit/APIテストで代替できないか？」
- カバレッジが低い → 「Unit Testを追加すべきか？」
- テストが遅い → 「E2Eが多すぎないか？Unit/APIに移行できないか？」

**Why**:
- 高速フィードバックループ（Unit: 秒単位、E2E: 分単位）
- メンテナンスコストの最小化（Unit: 低、E2E: 高）
- 信頼性の確保（多層防御）

**比率の根拠**:
```
E2E (5%)     ← 遅い、壊れやすい、メンテナンス高コスト
             └─ Critical User Flowsのみ
API (15%)    ← 中速、統合テスト
             └─ HTTP Endpoints, WebSocket
Unit (80%)   ← 高速、安定、メンテナンス低コスト
             └─ Services, Utilities, Pure Functions
```

**実装例**:
```javascript
// Unit Test (80%) - 高速、安定
// tests/unit/task-service.test.js
describe('TaskService', () => {
  it('getTasks呼び出し時_フィルタ適用されたタスク一覧が返される', async () => {
    const mockRepo = {
      fetchTasks: vi.fn().mockResolvedValue([
        { id: '1', status: 'pending' },
        { id: '2', status: 'completed' }
      ])
    };
    const service = new TaskService({ repository: mockRepo });

    const tasks = await service.getTasks({ status: 'pending' });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('1');
  });
});

// API Test (15%) - 中速、統合テスト
// tests/api/tasks.test.js
describe('GET /api/tasks', () => {
  it('タスク一覧取得_200レスポンスが返される', async () => {
    const response = await request(app).get('/api/tasks');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('tasks');
  });
});

// E2E Test (5%) - 遅い、Critical Flowsのみ
// tests/e2e/task-completion.test.js
describe('タスク完了フロー', () => {
  it('タスク一覧からタスク選択_完了ボタンクリック_完了済みに移動', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.click('[data-testid="task-123"]');
    await page.click('[data-testid="complete-button"]');
    await expect(page.locator('[data-testid="completed-tasks"]')).toContainText('Task 123');
  });
});
```

---

### 2. Test Naming Convention

**原則**: `describe('対象', () => { it('条件_期待結果', () => { ... }) })`

**思考パターン**:
- テストケース作成 → 「describe('対象') + it('条件_期待結果') の形式か？」
- テスト失敗時 → 「エラーメッセージから何が失敗したか即座にわかるか？」
- テスト追加時 → 「既存のdescribeブロックに追加すべきか、新規作成すべきか？」

**形式**:
```
describe('対象', () => {
  it('条件_期待結果', () => { ... })
})
```

**Example**:
```javascript
describe('ProjectService', () => {
  // ✅ Good: 条件と期待結果が明確
  it('プロジェクト作成時_Eventが発火される', async () => {
    const emitted = [];
    eventBus.on('project:created', (e) => emitted.push(e));

    await projectService.create({ name: 'Test' });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].detail.projectName).toBe('Test');
  });

  it('重複名のプロジェクト作成時_エラーが投げられる', async () => {
    await projectService.create({ name: 'Test' });

    await expect(
      projectService.create({ name: 'Test' })
    ).rejects.toThrow('Project name already exists');
  });

  it('無効な名前のプロジェクト作成時_エラーが投げられる', async () => {
    await expect(
      projectService.create({ name: '' })
    ).rejects.toThrow('Invalid name');
  });

  // ❌ Bad: 何をテストしているか不明確
  it('test1', () => { });
  it('should work', () => { });
  it('プロジェクト作成', () => { }); // 期待結果が不明
});
```

**ネストされたdescribe**:
```javascript
describe('TaskService', () => {
  describe('getTasks', () => {
    it('フィルタなし_全タスクが返される', async () => { });
    it('statusフィルタあり_該当タスクのみ返される', async () => { });
    it('projectフィルタあり_該当タスクのみ返される', async () => { });
  });

  describe('completeTask', () => {
    it('存在するタスク_完了される', async () => { });
    it('存在しないタスク_エラーが投げられる', async () => { });
  });
});
```

---

### 3. Coverage Target

**目標**: 80%以上

**思考パターン**:
- PR作成時 → 「カバレッジ80%以上か？」
- カバレッジ低下 → 「どのファイルがカバーされていないか？」
- 新ファイル追加時 → 「テストを書いたか？」

**Why**:
- 品質の定量的保証
- リグレッション防止
- コード品質の可視化

**計測方法**: Vitest の coverage reporter

**実行コマンド**:
```bash
# カバレッジ付きテスト実行
npm run test:coverage

# カバレッジレポート確認
open coverage/index.html

# CI環境: カバレッジ閾値チェック
npm run test:coverage -- --reporter=json | jq '.coverage.total.lines.pct'
```

**vitest.config.js設定**:
```javascript
export default {
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      lines: 80,      // 80%以上
      functions: 80,
      branches: 80,
      statements: 80,
      exclude: [
        'tests/**',
        '**/*.test.js',
        '**/test-helpers/**',
        'brainbase-ui/lib/parsers/**' // 既存パーサーは除外
      ]
    }
  }
};
```

**カバレッジレポート例**:
```
--------------------|---------|----------|---------|---------|
File                | % Stmts | % Branch | % Funcs | % Lines |
--------------------|---------|----------|---------|---------|
All files           |   85.23 |    78.45 |   82.11 |   85.67 |
 domain/task        |   92.45 |    87.23 |   90.12 |   93.21 |
  task-service.js   |   95.12 |    91.34 |   93.45 |   96.78 | ✅
  task-repository.js|   88.23 |    82.11 |   85.67 |   89.45 | ✅
 domain/session     |   76.34 |    68.91 |   72.45 |   77.89 | ⚠️ 80%未満
  session-service.js|   74.56 |    66.78 |   70.12 |   75.23 | ⚠️ 要改善
--------------------|---------|----------|---------|---------|
```

---

### 4. Test Types

**Unit Test** (80%):
- **対象**: Services, Utilities, Pure Functions
- **ツール**: Vitest
- **実行頻度**: 保存時・コミット前・CI
- **実行時間**: <5秒

**Example**:
```javascript
// tests/unit/utils/validators.test.js
import { validators } from '../../../public/modules/utils/validators.js';

describe('validators', () => {
  describe('projectName', () => {
    it('有効な名前_trueが返される', () => {
      expect(validators.projectName('valid-project')).toBe(true);
      expect(validators.projectName('Valid_123')).toBe(true);
    });

    it('無効な名前_falseが返される', () => {
      expect(validators.projectName('')).toBe(false);
      expect(validators.projectName('invalid project')).toBe(false); // スペース
      expect(validators.projectName('invalid@project')).toBe(false); // 特殊文字
    });
  });
});
```

**API Test** (15%):
- **対象**: HTTP Endpoints, WebSocket
- **ツール**: Vitest (supertest等)
- **実行頻度**: コミット前・CI
- **実行時間**: <30秒

**Example**:
```javascript
// tests/api/sessions.test.js
import request from 'supertest';
import app from '../../../brainbase-ui/server.js';

describe('POST /api/sessions/start', () => {
  it('有効なプロジェクト名_セッション作成される', async () => {
    const response = await request(app)
      .post('/api/sessions/start')
      .send({ project: 'brainbase' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('sessionId');
    expect(response.body.project).toBe('brainbase');
  });

  it('無効なプロジェクト名_400エラーが返される', async () => {
    const response = await request(app)
      .post('/api/sessions/start')
      .send({ project: 'invalid project' });

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });
});
```

**E2E Test** (5%):
- **対象**: Critical User Flows
- **ツール**: Playwright
- **実行頻度**: CI (PRマージ前)
- **実行時間**: <3分

**Example**:
```javascript
// tests/e2e/session-switch.test.js
import { test, expect } from '@playwright/test';

test.describe('セッション切り替えフロー', () => {
  test('セッション一覧からクリック_中央ペインが切り替わる', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // 初期状態: brainbaseセッション
    await expect(page.locator('#session-indicator')).toContainText('brainbase');

    // unsonセッションに切り替え
    await page.click('[data-testid="session-unson"]');

    // 切り替わったことを確認
    await expect(page.locator('#session-indicator')).toContainText('unson');
    await expect(page.locator('#ttyd-iframe')).toHaveAttribute('src', /session_name=unson/);
  });

  test('新規セッション作成_セッション一覧に追加される', async ({ page }) => {
    await page.goto('http://localhost:3000');

    // 新規セッション作成
    await page.click('[data-testid="create-session-button"]');
    await page.fill('[data-testid="project-name-input"]', 'new-project');
    await page.click('[data-testid="create-button"]');

    // セッション一覧に追加されたことを確認
    await expect(page.locator('[data-testid="session-new-project"]')).toBeVisible();
  });
});
```

---

## Usage

このSkillは以下のタイミングで使用される:

1. **実装時**: 新機能追加と同時にテスト追加
2. **PR作成時**: カバレッジ確認
3. **リファクタリング時**: テストが壊れていないか確認

**使用例**:

```
User: "プロジェクト削除機能を追加したい"

Claude Code: [test-strategy Skillを装備]

思考プロセス:
1. Test Pyramid: まずUnit Testを書く（ProjectService.deleteProject()）
2. Test Naming: describe('ProjectService') + it('プロジェクト削除時_DELETED イベントが発火される')
3. Coverage: deleteProject() メソッドとその分岐をすべてカバー
4. Test Types: Unit Test (Service層) → API Test (DELETE /api/projects/:id) → E2E (削除フロー) の順

実装:
1. tests/unit/project-service.test.js 作成
2. ProjectService.deleteProject() 実装
3. tests/api/projects.test.js に DELETE エンドポイントのテスト追加
4. （必要なら）tests/e2e/project-deletion.test.js 作成
5. npm run test:coverage でカバレッジ確認（80%以上）
```

---

## Success Criteria

- [ ] カバレッジ80%以上
- [ ] Test Pyramid比率が 80/15/5
- [ ] テスト命名規則に準拠
- [ ] すべてのテストがパスしている
- [ ] テスト実行時間が5秒以内 (Unit), 30秒以内 (API), 3分以内 (E2E)
- [ ] 新機能には必ずテストが追加されている
- [ ] テストが壊れやすくない（実装の詳細ではなく振る舞いをテスト）

---

## Enforcement

### Local
- このSkillを装備したClaude Codeが自動チェック
- テスト追加を促す

### CI
- GitHub Actions で `test-coverage-check.yml` が実行
- PRマージ前にカバレッジ80%以上を強制

**チェック項目**:
```bash
# カバレッジチェック
npm run test:coverage -- --reporter=json | jq '.coverage.total.lines.pct'
# → 80以上であることを確認

# Test Pyramid比率チェック
find tests/unit -name "*.test.js" | wc -l  # → 全体の80%
find tests/api -name "*.test.js" | wc -l   # → 全体の15%
find tests/e2e -name "*.test.js" | wc -l   # → 全体の5%
```

---

## Troubleshooting

### 問題1: カバレッジが80%に届かない

**症状**: `npm run test:coverage` で75%程度

**原因**:
- 条件分岐がカバーされていない
- エラーケースのテストが不足

**対処**:
```bash
# カバレッジレポートを確認
open coverage/index.html

# カバーされていない行を特定
# → 赤くハイライトされている行にテストを追加
```

**Example**:
```javascript
// カバーされていない条件分岐
function validateProject(name) {
  if (!name) throw new Error('Name required');
  if (name.length > 100) throw new Error('Name too long'); // ← カバーされていない
  return true;
}

// テスト追加
it('100文字を超える名前_エラーが投げられる', () => {
  expect(() => validateProject('a'.repeat(101))).toThrow('Name too long');
});
```

---

### 問題2: E2Eテストが多すぎて遅い

**症状**: CI実行に10分以上かかる

**原因**:
- E2Eテストが多すぎる（Test Pyramidの逆）
- Unit/APIテストで代替可能なE2Eテストが含まれている

**対処**:
```javascript
// ❌ Bad: E2Eでバリデーションテスト
test('無効なプロジェクト名_エラーメッセージが表示される', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.fill('#project-name', 'invalid project');
  await page.click('#submit');
  await expect(page.locator('.error')).toContainText('Invalid name');
});

// ✅ Good: Unit Testでバリデーションテスト
it('無効なプロジェクト名_エラーが投げられる', () => {
  expect(() => validators.projectName('invalid project')).toThrow('Invalid name');
});

// E2Eは Critical Flow のみ
test('プロジェクト作成から削除までのフロー', async ({ page }) => {
  // プロジェクト作成 → タスク追加 → 完了 → プロジェクト削除
});
```

---

### 問題3: テストが壊れやすい

**症状**: 実装の小さな変更でテストが大量に壊れる

**原因**:
- 実装の詳細をテストしている（内部変数、private method等）
- DOM構造に強く依存したテスト

**対処**:
```javascript
// ❌ Bad: 実装の詳細をテスト
it('_applyFiltersメソッドが呼ばれる', () => {
  const spy = vi.spyOn(service, '_applyFilters'); // private method
  service.getTasks();
  expect(spy).toHaveBeenCalled();
});

// ✅ Good: 振る舞いをテスト
it('フィルタ適用_該当タスクのみ返される', async () => {
  const tasks = await service.getTasks({ status: 'pending' });
  expect(tasks.every(t => t.status === 'pending')).toBe(true);
});

// ❌ Bad: DOM構造に依存
await page.click('div > ul > li:nth-child(2) > button');

// ✅ Good: data-testid使用
await page.click('[data-testid="complete-button"]');
```

---

### 問題4: モックが複雑すぎる

**症状**: テストコードがプロダクションコードより長い

**原因**:
- 依存が多すぎる（DI Containerを使っていない）
- モックの粒度が細かすぎる

**対処**:
```javascript
// ❌ Bad: 複雑なモック
const mockEventBus = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
};
const mockStore = {
  setState: vi.fn(),
  getState: vi.fn().mockReturnValue({ tasks: [] }),
  subscribe: vi.fn()
};
const mockRepository = {
  fetchTasks: vi.fn().mockResolvedValue([]),
  updateTask: vi.fn().mockResolvedValue(true)
};
const service = new TaskService({
  eventBus: mockEventBus,
  store: mockStore,
  repository: mockRepository
});

// ✅ Good: Test Helpersを作成
// tests/helpers/mock-factory.js
export function createMockTaskService() {
  return new TaskService({
    eventBus: createMockEventBus(),
    store: createMockStore(),
    repository: createMockRepository()
  });
}

// tests/unit/task-service.test.js
const service = createMockTaskService();
```

---

## References

### 内部ドキュメント
- [CLAUDE.md](../../CLAUDE.md): 開発標準全体
- [.claude/skills/tdd-workflow/SKILL.md](../tdd-workflow/SKILL.md): TDD実践プロセス（Red-Green-Refactor、Test-First）
- [docs/REFACTORING_PLAN.md](../../docs/REFACTORING_PLAN.md): リファクタリング詳細

### テスト設定
- `vitest.config.js`: Vitest設定
- `playwright.config.js`: Playwright設定

### テストディレクトリ
```
tests/
├── unit/              # Unit Tests (80%)
│   ├── domain/
│   │   └── task/
│   │       └── task-service.test.js
│   └── utils/
│       └── validators.test.js
├── api/               # API Tests (15%)
│   ├── tasks.test.js
│   └── sessions.test.js
└── e2e/               # E2E Tests (5%)
    ├── task-completion.test.js
    └── session-switch.test.js
```

---

**最終更新**: 2025-12-29
**M5.3 - Development Workflow Standardization**
**Week 2 Day 2: test-strategy Skill**

---
name: code-style
description: brainbaseのコーディング規約（命名規則・import順序）を強制する思考フレームワーク
setting_sources: ["user", "project"]
---

# brainbase Code Style

## Purpose

一貫性のあるコードスタイルを維持し、可読性・保守性を向上させる。

**適用タイミング**:
- 新規ファイル作成時
- 既存ファイル修正時
- コードレビュー時
- リファクタリング時

## Thinking Framework

### 1. Naming Conventions

**原則**: 用途に応じた命名規則を厳守する

**思考パターン**:
- ファイル名を決める → 「kebab-caseか？」
- クラス名を決める → 「PascalCaseか？」
- 変数名を決める → 「camelCaseか？」
- 定数を定義 → 「SCREAMING_SNAKE_CASEか?」

**Why**:
- コードの可読性向上
- 規約統一によるメンテナンス容易性
- チーム開発での混乱防止

**判断基準**:

#### ファイル名: kebab-case
```javascript
// ✅ Good
event-bus.js
task-service.js
session-repository.js
dom-helpers.js

// ❌ Bad
EventBus.js          // PascalCase ❌
taskService.js       // camelCase ❌
session_repository.js // snake_case ❌
```

#### クラス名: PascalCase
```javascript
// ✅ Good
class TaskService { }
class EventBus { }
class SessionRepository { }

// ❌ Bad
class taskService { }    // camelCase ❌
class task_service { }   // snake_case ❌
class TASK_SERVICE { }   // SCREAMING_SNAKE_CASE ❌
```

#### 変数・関数名: camelCase
```javascript
// ✅ Good
const currentSessionId = 'brainbase';
function getTasks() { }
const taskService = container.get('taskService');

// ❌ Bad
const CurrentSessionId = 'brainbase';  // PascalCase ❌
const current_session_id = 'brainbase'; // snake_case ❌
function GetTasks() { }                 // PascalCase ❌
```

#### 定数: SCREAMING_SNAKE_CASE
```javascript
// ✅ Good
const EVENTS = {
  TASK_LOADED: 'task:loaded',
  TASK_COMPLETED: 'task:completed',
  SESSION_CHANGED: 'session:changed'
};

const MAX_RETRY_COUNT = 3;
const API_TIMEOUT = 5000;

// ❌ Bad
const events = { /* ... */ };  // camelCase ❌
const maxRetryCount = 3;       // camelCase ❌
```

#### イベント名: kebab-case
```javascript
// ✅ Good
eventBus.emit('task:loaded', { tasks });
eventBus.emit('session:changed', { sessionId });
eventBus.emit('inbox:item-completed', { itemId });

// ❌ Bad
eventBus.emit('taskLoaded', { tasks });     // camelCase ❌
eventBus.emit('TASK_LOADED', { tasks });    // SCREAMING_SNAKE_CASE ❌
eventBus.emit('Task:Loaded', { tasks });    // PascalCase ❌
```

#### DI Container ID: camelCase
```javascript
// ✅ Good
container.register('taskService', () => new TaskService());
container.register('eventBus', () => eventBus);
container.register('appStore', () => appStore);

// ❌ Bad
container.register('TaskService', () => new TaskService()); // PascalCase ❌
container.register('task_service', () => new TaskService()); // snake_case ❌
```

---

### 2. Import Order

**原則**: import文は定められた順序で記述する

**思考パターン**:
- import追加 → 「どのカテゴリに属するか？」
- import整理 → 「Node.js built-in → Third-party → Internal → Relativeの順か？」
- import削除 → 「未使用のimportはないか？」

**Why**:
- 依存関係の把握が容易
- コードレビューでの変更検出が容易
- マージコンフリクトの削減

**判断基準**:

#### 正しいimport順序
```javascript
// ✅ Good: 4カテゴリに分割、空行で区切る

// 1. Node.js built-in modules
import fs from 'node:fs';
import path from 'node:path';

// 2. Third-party modules
import express from 'express';
import DOMPurify from 'dompurify';

// 3. Internal modules (absolute paths)
import { eventBus, EVENTS } from '/modules/core/event-bus.js';
import { appStore } from '/modules/core/store.js';
import { container } from '/modules/core/di-container.js';

// 4. Relative modules
import { TaskService } from './task-service.js';
import { TaskRepository } from './task-repository.js';
```

#### 誤ったimport順序
```javascript
// ❌ Bad: 順序がバラバラ
import { TaskService } from './task-service.js';
import express from 'express';
import { eventBus } from '/modules/core/event-bus.js';
import fs from 'node:fs';
```

#### アルファベット順
各カテゴリ内ではアルファベット順に並べる:
```javascript
// ✅ Good: カテゴリ内でアルファベット順
import { container } from '/modules/core/di-container.js';
import { eventBus, EVENTS } from '/modules/core/event-bus.js';
import { appStore } from '/modules/core/store.js';

// ❌ Bad: カテゴリ内でバラバラ
import { eventBus, EVENTS } from '/modules/core/event-bus.js';
import { appStore } from '/modules/core/store.js';
import { container } from '/modules/core/di-container.js';
```

#### 未使用import削除
```javascript
// ❌ Bad: 未使用のimport
import { eventBus, EVENTS } from '/modules/core/event-bus.js';
import { appStore } from '/modules/core/store.js';  // 未使用
import { container } from '/modules/core/di-container.js';

// ✅ Good: 未使用のimportを削除
import { eventBus, EVENTS } from '/modules/core/event-bus.js';
import { container } from '/modules/core/di-container.js';
```

---

### 3. コメント規約

**原則**: 必要最小限のコメントで意図を伝える

**思考パターン**:
- コメントを書く → 「本当に必要か？コードで表現できないか？」
- 長いコメント → 「関数に抽出して関数名で説明できないか？」
- TODOコメント → 「Issueに切り出すべきか？」

**Why**:
- コードの自己文書化を促進
- コメントとコードの乖離を防止
- 保守性向上

**判断基準**:

#### コメントが不要な場合
```javascript
// ❌ Bad: コードを読めば明らか
// タスクIDを取得
const taskId = task.id;

// タスクを完了にする
task.status = 'completed';

// ✅ Good: コメントなし
const taskId = task.id;
task.status = 'completed';
```

#### コメントが必要な場合
```javascript
// ✅ Good: Why（理由）を説明
// NOTE: セッションIDが`_`で始まる場合はアーカイブ済み
if (sessionId.startsWith('_')) {
  return this._getArchivedSession(sessionId);
}

// HACK: EventBusのリスナー登録順序に依存するため、nextTickで遅延実行
await new Promise(resolve => setTimeout(resolve, 0));

// FIXME: タイムゾーン変換が正しくない（UTC→JSTの計算ミス）
const jstTime = utcTime + 9 * 60 * 60 * 1000;
```

#### TODOコメントの扱い
```javascript
// ❌ Bad: TODO放置
// TODO: エラーハンドリング追加

// ✅ Good: Issueに切り出してリンク
// TODO(#123): エラーハンドリング追加
// See: https://github.com/Unson-LLC/brainbase/issues/123

// ✅ Better: TODOではなく即座に実装
try {
  await taskService.completeTask(taskId);
} catch (error) {
  console.error('Failed to complete task:', error);
  throw error;
}
```

---

## Usage

このSkillは以下のタイミングで使用される:

1. **コード実装時**: 新規ファイル作成・既存ファイル修正
2. **コードレビュー時**: PR作成時に準拠確認
3. **リファクタリング時**: 命名規則・import順序の統一

**使用例**:

```
User: "新しいFeatureServiceを作成したい"

Claude Code: [code-style Skillを装備]

思考プロセス:
1. Naming Conventions: ファイル名は feature-service.js (kebab-case)
2. Naming Conventions: クラス名は FeatureService (PascalCase)
3. Import Order: Node.js built-in → Third-party → Internal → Relative
4. コメント規約: 必要最小限のコメント（Whyのみ）

実装:
1. /modules/domain/feature/feature-service.js 作成
2. クラス名: FeatureService
3. import順序: eventBus, store, containerの順
4. 変数名: camelCase
```

---

## Success Criteria

- [ ] すべてのファイル名がkebab-caseである
- [ ] すべてのクラス名がPascalCaseである
- [ ] すべての変数・関数名がcamelCaseである
- [ ] すべての定数がSCREAMING_SNAKE_CASEである
- [ ] すべてのimport文が正しい順序で記述されている
- [ ] 未使用のimportが0件である
- [ ] TODOコメントがすべてIssueに紐付いている（または実装済み）
- [ ] コメントが必要最小限である（Whyのみ）

---

## Enforcement

### Local
- このSkillを装備したClaude Codeが自動チェック
- コーディング中にスタイル違反を指摘

### CI
- GitHub Actions で `naming-convention-check.yml` が実行
- GitHub Actions で `import-order-check.yml` が実行
- PRマージ前にスタイル準拠を強制

**チェック項目**:
```bash
# Naming Convention: kebab-caseファイル名
find public/modules -name "*.js" | grep -v "^[a-z0-9-]*\.js$"

# Import Order: 正しい順序
# (ESLint plugin-import を使用)
npx eslint --plugin import --rule 'import/order: error'

# Unused Imports: 未使用import検出
npx eslint --rule 'no-unused-vars: error'
```

---

## Troubleshooting

### 問題1: ファイル名がPascalCaseになっている

**症状**: `TaskService.js` のようなファイル名

**原因**:
- 他言語（Java, C#等）の慣習を持ち込んでいる
- クラス名とファイル名を一致させようとしている

**対処**:
```bash
# ❌ Bad
public/modules/domain/task/TaskService.js

# ✅ Good: kebab-caseにリネーム
public/modules/domain/task/task-service.js
```

---

### 問題2: import順序がバラバラ

**症状**: PRでimport順序の指摘が多い

**原因**:
- 規約を知らない
- エディタの自動importが規約に従っていない

**対処**:
```javascript
// VS Code設定（.vscode/settings.json）
{
  "editor.codeActionsOnSave": {
    "source.organizeImports": true
  },
  "javascript.preferences.importModuleSpecifier": "relative"
}

// ESLint設定（.eslintrc.json）
{
  "plugins": ["import"],
  "rules": {
    "import/order": ["error", {
      "groups": [
        "builtin",      // Node.js built-in
        "external",     // Third-party
        "internal",     // Internal
        ["parent", "sibling", "index"]  // Relative
      ],
      "newlines-between": "always",
      "alphabetize": { "order": "asc" }
    }]
  }
}
```

---

### 問題3: 変数名がsnake_caseになっている

**症状**: `current_session_id` のような変数名

**原因**:
- Python/Ruby等の慣習を持ち込んでいる
- データベースのカラム名をそのまま使用している

**対処**:
```javascript
// ❌ Bad
const current_session_id = 'brainbase';

// ✅ Good: camelCaseに変更
const currentSessionId = 'brainbase';

// ✅ Good: DBカラム名とJavaScript変数名を分離
const dbRow = { session_id: 'brainbase' };
const currentSessionId = dbRow.session_id;  // 取得時に変換
```

---

### 問題4: TODOコメントが放置されている

**症状**: 数ヶ月前のTODOコメントが残っている

**原因**:
- TODOを書いたまま忘れている
- Issueに切り出していない

**対処**:
```javascript
// ❌ Bad: 放置されたTODO
// TODO: エラーハンドリング追加
// (3ヶ月前のコミットから存在)

// ✅ Good: Issueに切り出し
// TODO(#123): エラーハンドリング追加
// See: https://github.com/Unson-LLC/brainbase/issues/123

// ✅ Better: 即座に実装
try {
  await taskService.completeTask(taskId);
} catch (error) {
  console.error('Failed to complete task:', error);
  throw error;
}
```

**定期チェック**:
```bash
# TODOコメント一覧を表示
grep -rn "TODO" public/modules --include="*.js"

# Issue番号がないTODOを検出
grep -rn "TODO" public/modules --include="*.js" | grep -v "TODO(#"
```

---

## References

### 内部ドキュメント
- [CLAUDE.md](../../CLAUDE.md): 開発標準全体
- [docs/REFACTORING_PLAN.md](../../docs/REFACTORING_PLAN.md): リファクタリング詳細

### 外部リソース
- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript): JavaScript スタイルガイド
- [ESLint](https://eslint.org/): JavaScript Linter
- [Prettier](https://prettier.io/): Code Formatter

---

**最終更新**: 2025-12-29
**M5.3 - Development Workflow Standardization**
**Week 2 Day 4: code-style Skill**

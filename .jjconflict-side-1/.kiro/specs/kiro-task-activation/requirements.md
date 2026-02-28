# Requirements Document: Kiro Task Format Activation

## Introduction

Kiro形式タスクパーサーの実装は完了しており、本フェーズではその有効化、既存データのマイグレーション、動作検証、およびドキュメント更新を行う。

## Current State (実装済み)
- KiroTaskParser: チェックボックス形式Markdownパーサー
- TaskDirectoryScanner: プロジェクト別ディレクトリ走査
- TaskFileManager: tasks.md/done.md間のファイル移動
- TaskParser: デュアルモード対応（YAML/Kiro）
- GET /api/tasks/completed エンドポイント
- マイグレーションスクリプト

## Requirements

### Requirement 1: Kiro形式の本番有効化
**Objective:** As a developer, I want to enable Kiro task format in production, so that tasks are stored in the new directory structure.

#### Acceptance Criteria
1. When `KIRO_TASK_FORMAT=true` is set, the system shall use Kiro format for all task operations
2. When the server starts with Kiro format enabled, the system shall log the active format
3. If `_tasks/{project}/` directory does not exist, the system shall create it automatically
4. The system shall fall back gracefully if task files are missing

### Requirement 2: 既存タスクのマイグレーション
**Objective:** As a developer, I want to migrate existing YAML tasks to Kiro format, so that all tasks use the new structure.

#### Acceptance Criteria
1. When running `npm run migrate:tasks`, the system shall convert all YAML tasks to Kiro format
2. The migration shall preserve task ID, name, status, priority, due date, and project
3. Completed tasks shall be placed in `done.md`, active tasks in `tasks.md`
4. The original `_tasks/index.md` shall be backed up before migration
5. If migration fails, the system shall not corrupt existing data

### Requirement 3: UI動作検証
**Objective:** As a user, I want the task UI to work correctly with Kiro format, so that I can manage tasks seamlessly.

#### Acceptance Criteria
1. When clicking complete checkbox, the task shall move from tasks.md to done.md
2. When restoring a completed task, it shall move from done.md to tasks.md
3. When adding a new task, it shall be appended to the correct project's tasks.md
4. When editing a task, the changes shall persist correctly
5. Completed tasks modal shall display tasks from done.md

### Requirement 4: ドキュメント更新
**Objective:** As a new user, I want clear documentation, so that I can understand the task format.

#### Acceptance Criteria
1. README.md shall include Kiro task format description
2. The documentation shall explain the directory structure
3. Migration instructions shall be provided
4. Environment variable configuration shall be documented

## brainbase Architecture Constraints

### Event-Driven Architecture (CLAUDE.md 1.1)
- [x] All state changes emit events via EventBus (既存実装で対応済み)
- [x] Event names follow `domain:action` format
- **Required Events**: `task:completed`, `task:updated`, `task:deleted`

### Reactive Store Pattern (CLAUDE.md 1.2)
- [x] UI updates through Store subscriptions only (既存実装で対応済み)

### Dependency Injection (CLAUDE.md 1.3)
- [x] TaskService registered in DI Container (既存実装で対応済み)

## Security Requirements (CLAUDE.md 4.x)

### Input Validation (CLAUDE.md 4.3)
- [x] Task name validated for length and special characters
- [x] Project ID validated against allowed patterns

## Success Criteria
- [ ] Kiro format enabled and working in development
- [ ] All existing tasks migrated successfully
- [ ] UI operations verified (add, complete, restore, edit)
- [ ] Documentation updated
- [ ] No data loss during migration

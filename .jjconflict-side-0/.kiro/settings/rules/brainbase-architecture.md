# brainbase Architecture Rules

## Overview
This document defines the mandatory architecture patterns for all brainbase features.
All generated specifications must comply with these rules.

## Reference Document
- Primary: `CLAUDE.md` (project root)
- UI/UX: `DESIGN.md`
- Refactoring: `docs/REFACTORING_PLAN.md`

---

## 1. Event-Driven Architecture (CLAUDE.md 1.1)

### Mandatory Requirements
- All state changes MUST emit events via EventBus
- No direct module-to-module calls for state changes
- Event names follow `domain:action` format

### Event Pattern
```javascript
// Good: EventBus usage
import { eventBus, EVENTS } from '/modules/core/event-bus.js';
eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: '123' });

// Bad: Direct call
taskService.onComplete(taskId); // FORBIDDEN
```

### Available Events
- Task: TASK_LOADED, TASK_COMPLETED, TASK_UPDATED, TASK_DELETED, TASK_FILTER_CHANGED
- Session: SESSION_LOADED, SESSION_CHANGED, SESSION_CREATED, SESSION_ARCHIVED, SESSION_DELETED
- Schedule: SCHEDULE_LOADED, SCHEDULE_UPDATED
- Inbox: INBOX_LOADED, INBOX_ITEM_COMPLETED

---

## 2. Reactive Store Pattern (CLAUDE.md 1.2)

### Mandatory Requirements
- UI updates ONLY through Store subscriptions
- No direct DOM manipulation
- State changes via `appStore.setState()`

### Store Pattern
```javascript
// Good: Store usage
import { appStore } from '/modules/core/store.js';
appStore.setState({ currentSessionId: 'brainbase' });

// Bad: Direct DOM manipulation
document.getElementById('session').textContent = 'brainbase'; // FORBIDDEN
```

### Store Structure
```javascript
{
  sessions: [],
  currentSessionId: null,
  tasks: [],
  schedule: null,
  inbox: [],
  filters: { taskFilter: '', showAllTasks: false },
  ui: { inboxOpen: false, draggedSessionId: null }
}
```

---

## 3. Dependency Injection (CLAUDE.md 1.3)

### Mandatory Requirements
- All services registered in DI Container
- Constructor injection for dependencies
- No direct imports for services

### DI Pattern
```javascript
// Good: DI Container usage
import { container } from '/modules/core/di-container.js';
container.register('taskService', () => new TaskService({
  repository: container.get('taskRepository'),
  eventBus: container.get('eventBus')
}));

// Bad: Direct import
import { taskService } from './services/task.js'; // FORBIDDEN
```

---

## 4. Service Layer Pattern (CLAUDE.md 1.4)

### Layer Structure
```
UI Components (View)
    ↓
Services (Business Logic)
    ↓
Repositories (Data Access)
    ↓
EventBus (Cross-Cutting)
```

### File Locations
- Service: `public/modules/domain/{domain}/{domain}-service.js`
- Repository: `public/modules/domain/{domain}/{domain}-repository.js`
- View: `public/modules/ui/views/{domain}-view.js`
- Tests: `tests/domain/{domain}/`

---

## 5. Security Requirements (CLAUDE.md 4.x)

### XSS Prevention (4.1)
- Use `textContent` for user input display
- Use DOMPurify for HTML sanitization
- NEVER use `innerHTML` with user data

### CSRF Protection (4.2)
- All POST/PUT/DELETE include X-CSRF-Token
- Token validation on server-side

### Input Validation (4.3)
- All user inputs validated
- Type, length, and format checks required

---

## 6. Code Style (CLAUDE.md 5.x)

### Naming Conventions
- Files: `kebab-case` (task-service.js)
- Classes: `PascalCase` (TaskService)
- Variables: `camelCase` (currentSessionId)
- Constants: `SCREAMING_SNAKE_CASE` (MAX_PROJECTS)
- Events: `domain:action` (task:completed)

### Import Order
1. Node.js built-in modules
2. Third-party modules
3. Internal modules (absolute path)
4. Relative modules

---

## 7. Test-Driven Development (CLAUDE.md 1.5)

### TDD Cycle
1. RED: Write failing test
2. GREEN: Minimum implementation
3. REFACTOR: Clean up

### Test Naming
```javascript
describe('TaskService', () => {
  it('getTasks呼び出し時_フィルタ適用されたタスク一覧が返される', () => {});
});
```

### Coverage Target
- Minimum: 80%
- Tools: Vitest (Unit/API), Playwright (E2E)

---

## Validation Checklist

Before approving any specification:

- [ ] EventBus used for all state changes
- [ ] Store used for all UI state
- [ ] DI Container for service dependencies
- [ ] Service Layer structure followed
- [ ] XSS/CSRF/Input validation addressed
- [ ] Naming conventions followed
- [ ] TDD cycle documented
- [ ] Test coverage >= 80%

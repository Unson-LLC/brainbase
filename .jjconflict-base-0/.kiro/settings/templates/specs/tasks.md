# Implementation Plan

## Task Format Template

Use whichever pattern fits the work breakdown:

### Major task only
- [ ] {{NUMBER}}. {{TASK_DESCRIPTION}}{{PARALLEL_MARK}}
  - {{DETAIL_ITEM_1}} *(Include details only when needed. If the task stands alone, omit bullet items.)*
  - _Requirements: {{REQUIREMENT_IDS}}_

### Major + Sub-task structure
- [ ] {{MAJOR_NUMBER}}. {{MAJOR_TASK_SUMMARY}}
- [ ] {{MAJOR_NUMBER}}.{{SUB_NUMBER}} {{SUB_TASK_DESCRIPTION}}{{SUB_PARALLEL_MARK}}
  - {{DETAIL_ITEM_1}}
  - {{DETAIL_ITEM_2}}
  - _Requirements: {{REQUIREMENT_IDS}}_ *(IDs only; do not add descriptions or parentheses.)*

> **Parallel marker**: Append ` (P)` only to tasks that can be executed in parallel. Omit the marker when running in `--sequential` mode.
>
> **Optional test coverage**: When a sub-task is deferrable test work tied to acceptance criteria, mark the checkbox as `- [ ]*` and explain the referenced requirements in the detail bullets.

## brainbase TDD Workflow (CLAUDE.md 1.5)

Each task follows the Red-Green-Refactor cycle:

### TDD Cycle per Task
```
┌─────────────────────────────────────────────────────┐
│ 1. RED: Write failing test first                    │
│    - Create test file: tests/domain/{domain}/*.test.js │
│    - Test naming: describe('対象') + it('条件_期待結果') │
│    - npm run test → FAIL ❌                         │
├─────────────────────────────────────────────────────┤
│ 2. GREEN: Minimum implementation to pass            │
│    - Implement only what the test requires          │
│    - npm run test → PASS ✅                         │
├─────────────────────────────────────────────────────┤
│ 3. REFACTOR: Clean up while keeping tests green    │
│    - Remove duplication                             │
│    - Improve naming                                 │
│    - npm run test → PASS ✅ (still green)           │
└─────────────────────────────────────────────────────┘
```

### Task Template with TDD
- [ ] {{NUMBER}}. {{TASK_DESCRIPTION}}
  - **TDD Cycle**:
    - [ ] RED: Write test for `{{function_name}}`
    - [ ] GREEN: Implement `{{function_name}}`
    - [ ] REFACTOR: Clean up
  - **Files**:
    - Test: `tests/domain/{{domain}}/{{domain}}-service.test.js`
    - Impl: `public/modules/domain/{{domain}}/{{domain}}-service.js`
  - _Requirements: {{REQUIREMENT_IDS}}_

## Coverage Target
- [ ] Test coverage >= 80% (npm run test:coverage)
- [ ] All EventBus events tested
- [ ] All Store mutations tested

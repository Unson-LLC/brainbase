---
name: git-workflow
description: Git branch strategy and workflow management for brainbase development. Use when starting new features, bug fixes, or refactoring work (Plan完了後、Edit開始前), when committing changes, or when merging branches. Defines session-based branch naming (session/YYYY-MM-DD-<type>-<name>), branch lifecycle management, and integration with /commit and /merge custom commands.
---

# Git Workflow

Session-based branch strategy for brainbase development, integrating with existing `/commit` and `/merge` custom commands.

## 1. Purpose & Overview

### 1.1 Purpose

This skill provides a comprehensive git branch strategy for brainbase development that:
- Enforces **session-based branching** aligned with `/commit` command requirements
- Integrates **conventional branch types** (feature/fix/refactor/hotfix) with session naming
- Defines **branch lifecycle** from creation through merge and cleanup
- Coordinates with **development-workflow** Skill (Phase 2.5, 5, 6)

### 1.2 When to Use This Skill

**Automatically loaded** when:
- **Phase 2.5 (Branch)**: After Plan completion, before Edit begins
- **Phase 5 (Commit)**: When using `/commit` command
- **Phase 6 (Merge)**: When using `/merge` command

**Manually reference** for:
- Branch naming decisions
- Branch cleanup operations
- Git workflow troubleshooting

### 1.3 Relationship with Custom Commands

```
┌──────────────────────────────────────────────┐
│ git-workflow Skill (Strategy & Lifecycle)    │
│ - Branch naming conventions                  │
│ - Creation timing (Phase 2.5)                │
│ - Lifecycle management                       │
└──────────────────────────────────────────────┘
                    ↓ Uses
┌──────────────────────────────────────────────┐
│ Custom Commands (Implementation)             │
│ - /commit: Branch safety, decision capture   │
│ - /merge: Two-mode merging                   │
└──────────────────────────────────────────────┘
```

**Important**: This Skill defines **strategy and process**. The `/commit` and `/merge` commands handle **implementation**. Do NOT duplicate command logic here.

---

## 2. Branch Lifecycle

### 2.1 Complete Lifecycle Flow

```
┌────────────────────────────────────────────────────────┐
│ 1. Branch Creation (Phase 2.5)                         │
│    Timing: Plan完了後、Edit開始前                       │
│    Command: git checkout -b session/YYYY-MM-DD-<type>-<name> │
│    Example: session/2025-12-29-feature-priority-filter │
├────────────────────────────────────────────────────────┤
│ 2. Development (Phase 3-4)                             │
│    - Edit: TDD workflow (Red-Green-Refactor)           │
│    - Test: npm run test                                │
│    - Commit: /commit (decision capture)                │
│    - Multiple commits allowed per branch               │
├────────────────────────────────────────────────────────┤
│ 3. Merge (Phase 6)                                     │
│    - Command: /merge                                   │
│    - Mode selection: Safe (worktree) or Fast           │
│    - Creates --no-ff merge commit                      │
│    - Preserves feature branch history                  │
├────────────────────────────────────────────────────────┤
│ 4. Cleanup (Post-Merge)                                │
│    - Delete merged branch: git branch -d <branch-name> │
│    - Verify: git branch --merged                       │
│    - Stale branch check: git branch -v                 │
└────────────────────────────────────────────────────────┘
```

### 2.2 Lifecycle State Transitions

```
[main] → [Plan Mode] → [Create Branch] → [Development] → [Merge] → [Cleanup] → [main]
   ↑                         ↓                                          ↓
   └─────────────────────────┴──────────────────────────────────────────┘
```

**States**:
1. **main**: Clean state, ready for new work
2. **Plan Mode**: Designing implementation (no branch yet)
3. **Create Branch**: `git checkout -b session/...` (Phase 2.5)
4. **Development**: Red-Green-Refactor, multiple commits
5. **Merge**: `/merge` integrates changes to main
6. **Cleanup**: Delete feature branch
7. **main**: Ready for next feature

---

## 3. Branch Naming Strategy

### 3.1 Naming Convention

**Format**: `session/YYYY-MM-DD-<type>-<name>`

**Components**:
- `session/`: Required prefix (enforced by `/commit`)
- `YYYY-MM-DD`: ISO 8601 date (development session start date)
- `<type>`: Branch type (feature/fix/refactor/hotfix)
- `<name>`: Descriptive feature name (kebab-case, lowercase)

### 3.2 Branch Types

#### feature: New functionality
```bash
session/2025-12-29-feature-priority-filter
session/2025-12-29-feature-task-archive
session/2025-12-29-feature-user-settings
```

**When to use**:
- Adding new features
- Implementing new user-facing functionality
- Adding new API endpoints

#### fix: Bug fixes
```bash
session/2025-12-29-fix-task-loading-bug
session/2025-12-29-fix-filter-race-condition
session/2025-12-29-fix-memory-leak
```

**When to use**:
- Fixing defects
- Resolving incorrect behavior
- Addressing test failures

#### refactor: Code improvements without behavior change
```bash
session/2025-12-29-refactor-service-layer
session/2025-12-29-refactor-event-bus
session/2025-12-29-refactor-extract-utils
```

**When to use**:
- Improving code structure
- Extracting abstractions
- Performance optimizations
- Code cleanup

#### hotfix: Emergency production fixes
```bash
session/2025-12-29-hotfix-critical-security
session/2025-12-29-hotfix-data-corruption
```

**When to use**:
- Critical production issues
- Security vulnerabilities
- Data integrity problems

**Note**: Hotfixes MAY be committed directly to main with `/commit` warning acknowledgment

### 3.3 Naming Best Practices

**DO**:
- ✅ Use descriptive names: `session/2025-12-29-feature-priority-filter`
- ✅ Use kebab-case: `priority-filter` (not `priorityFilter` or `priority_filter`)
- ✅ Be concise: 2-4 words for `<name>`
- ✅ Match user story: If user says "優先度フィルタ", use `priority-filter`

**DON'T**:
- ❌ Generic names: `session/2025-12-29-feature-update` (what update?)
- ❌ Developer names: `session/2025-12-29-feature-sato-work`
- ❌ Issue tracker IDs only: `session/2025-12-29-feature-123` (add description)
- ❌ Spaces or special chars: `session/2025-12-29-feature-priority filter!`

### 3.4 Why Session-Based with Type Prefix?

**Advantages**:
1. **`/commit` Compliance**: Satisfies session/* enforcement without modifying `/commit`
2. **Git Flow Alignment**: feature/fix/refactor/hotfix types match conventional Git Flow
3. **Date-Based Tracking**: YYYY-MM-DD enables chronological session visibility
4. **Type Clarity**: Branch type visible in name (no need to check commits)
5. **No Command Modification**: Works with existing `/commit` and `/merge` implementations

**Alternative Considered** (feature/*, fix/*, etc.):
- ❌ Requires `/commit` modification to accept non-session/* branches
- ❌ Breaks existing workflow

---

## 4. Branch Creation Timing

### 4.1 Phase 2.5: Branch Creation

**Timing**: Plan完了後、Edit開始前

**Why Between Plan and Edit?**:
- ✅ Plan Mode defines **what** to implement (TODOリスト)
- ✅ Branch creation prepares **where** to implement
- ✅ Edit Phase can immediately start TDD workflow on correct branch

**Workflow Integration**:
```
Phase 1: Explore → Phase 2: Plan → Phase 2.5: Branch → Phase 3: Edit (TDD)
```

### 4.2 Branch Creation Procedure

#### Step 1: Check Current Branch
```bash
git status
# Expected: On branch main or session/*
```

#### Step 2: Decision Tree

**Case A: Currently on `main`**
```bash
# User: "優先度フィルタを追加して"
# Plan Mode completed → TODOリスト作成完了

# Create new session branch
git checkout -b session/2025-12-29-feature-priority-filter
# Switched to a new branch 'session/2025-12-29-feature-priority-filter'

# Proceed to Phase 3: Edit (TDD workflow)
```

**Case B: Currently on `session/*`**
```bash
# Already on feature branch
# Example: session/2025-12-29-feature-tdd-integration

# Continue using current branch
# Proceed to Phase 3: Edit (TDD workflow)
```

**Case C: Uncommitted changes on `main`**
```bash
# Error: Cannot create branch with uncommitted changes

# Option 1: Commit changes first (if related work)
git add .
# Use /commit for decision capture

# Option 2: Stash changes (if unrelated work)
git stash push -m "WIP: unrelated work"
git checkout -b session/YYYY-MM-DD-<type>-<name>
```

### 4.3 Examples

#### Example 1: New Feature from main
```
User: "TaskServiceにarchiveTask()メソッドを追加して"

Claude:
1. Plan Mode完了 → TODOリスト作成
2. Phase 2.5: Branch
   $ git status
   On branch main

   $ git checkout -b session/2025-12-29-feature-task-archive
   Switched to a new branch 'session/2025-12-29-feature-task-archive'

3. Phase 3: Edit (TDD workflow開始)
```

#### Example 2: Bug Fix from main
```
User: "タスク読み込みのバグを修正して"

Claude:
1. Explore → バグ再現確認
2. Plan Mode → 修正方針決定
3. Phase 2.5: Branch
   $ git checkout -b session/2025-12-29-fix-task-loading-bug

4. Phase 3: Edit (TDD - まず失敗するテストを書く)
```

#### Example 3: Continuing Existing Work
```
User: "さっきのTDD統合の続きをして"

Claude:
1. Phase 2: Plan → 残りのTODO確認
2. Phase 2.5: Branch
   $ git status
   On branch session/2025-12-29-feature-tdd-integration

   # Continue on current branch (no checkout needed)

3. Phase 3: Edit (TDD workflow継続)
```

### 4.4 When NOT to Create a New Branch

**Scenario 1: Hotfix on main** (allowed by `/commit` with warning)
```bash
# Critical production issue
# /commit will warn but allow commit to main
# Use only for true emergencies
```

**Scenario 2: Documentation-only changes** (optional)
```bash
# Typo fixes in README.md
# Could use main or session branch depending on policy
```

**Scenario 3: Already on appropriate session branch**
```bash
# Current: session/2025-12-29-feature-priority-filter
# Task: "Add test cases for edge cases"
# → Continue on current branch (feature not complete)
```

---

## 5. /commit Integration

### 5.1 /commit Command Role

The `/commit` custom command handles:
1. **Branch Safety Check**: Warns if committing to main (allows session/* only)
2. **Decision-Making Capture**: Prompts for 悩み→判断→結果
3. **Conventional Commits**: Enforces feat/fix/refactor/etc. format
4. **Co-Authorship**: Adds `Co-Authored-By: Claude Sonnet 4.5`

### 5.2 Integration with git-workflow

**When `/commit` is triggered** (development-workflow Phase 5):
1. Git-workflow Skill ensures you're on session/* branch (Phase 2.5 already executed)
2. `/commit` validates branch name (session/* check)
3. `/commit` prompts for decision-making context
4. Commit created with decision record

**Example Flow**:
```
Phase 2.5 (Branch): session/2025-12-29-feature-priority-filter created
Phase 3 (Edit): TDD implementation (Red-Green-Refactor)
Phase 4 (Test): npm run test → all passing ✅
Phase 5 (Commit): /commit triggered

/commit checks:
  - Current branch: session/2025-12-29-feature-priority-filter ✅
  - Branch pattern: session/* ✅
  - Prompts for decision-making:
    - 悩み: "優先度フィルタの実装方法（FilterService vs TaskService統合）"
    - 判断: "TaskService.getFilteredTasks()に統合（既存パターン踏襲）"
    - 結果: "filterByPriority()ユーティリティ関数作成、100% coverage達成"

Commit message:
feat: TaskServiceに優先度フィルタ統合

filterByPriority()ユーティリティを作成し、TaskService.getFilteredTasks()に統合。
UIドロップダウン追加、イベントハンドリング実装。

悩み: 優先度フィルタの実装方法（FilterService vs TaskService統合）
判断: TaskService.getFilteredTasks()に統合（既存パターン踏襲）
結果: filterByPriority()ユーティリティ関数作成、100% coverage達成

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

### 5.3 /commit Best Practices

**DO**:
- ✅ Use `/commit` for ALL commits (enforces decision capture)
- ✅ Provide detailed 悩み→判断→結果 (valuable for future reference)
- ✅ Commit frequently during TDD (Red, Green, Refactor states)
- ✅ Use conventional commit types matching branch type:
  - session/feature-* → feat: commit
  - session/fix-* → fix: commit
  - session/refactor-* → refactor: commit

**DON'T**:
- ❌ Use `git commit` directly (bypasses decision capture)
- ❌ Generic decision records: "判断: 実装した" (not useful)
- ❌ Skip 悩み when there were trade-offs (future you will thank you)

### 5.4 Multiple Commits per Branch

**Allowed and Encouraged**:
```bash
# TDD cycle produces multiple commits:
session/2025-12-29-feature-priority-filter

Commit 1: test: 優先度フィルタのRED テスト追加
Commit 2: feat: filterByPriority() 仮実装
Commit 3: test: 優先度フィルタの三角測量テスト追加
Commit 4: refactor: filterByPriority() 本実装
Commit 5: feat: TaskService統合、UI追加
```

**Each commit should**:
- Represent one TDD state (Red, Green, or Refactor)
- Have clear decision record (what trade-offs were made)
- Pass tests (or be RED commit explicitly)

### 5.5 Reference Only - No Duplication

**This Skill does NOT re-implement `/commit` logic.**

For `/commit` implementation details:
- Command file: `/Users/ksato/workspace/.claude/commands/commit.md`
- This Skill only documents: **when** to use `/commit`, **why** it's important, **how** it integrates with branch workflow

---

## 6. /merge Integration

### 6.1 /merge Command Role

The `/merge` custom command handles:
1. **Mode Selection**: Safe Mode (worktree isolation) or Fast Mode
2. **Conflict Resolution**: Interactive conflict handling
3. **--no-ff Merge Commits**: Explicit merge commits preserving feature branch history
4. **Symlink Safety**: Safe Mode uses worktree to protect symlinks

### 6.2 Integration with git-workflow

**When `/merge` is triggered** (development-workflow Phase 6):
1. Feature complete, all tests passing
2. All commits contain decision records (from `/commit`)
3. Ready to integrate to main

**Example Flow**:
```
Phase 4 (Test): npm run test → all passing ✅
Phase 5 (Commit): /commit → decision captured ✅
Phase 6 (Merge): /merge triggered

/merge workflow:
  1. Mode selection:
     - Safe Mode: Uses worktree for isolation (recommended)
     - Fast Mode: Direct merge (faster, less safe)

  2. Merge execution:
     $ git checkout main
     $ git merge --no-ff session/2025-12-29-feature-priority-filter

  3. Merge commit created:
     Merge branch 'session/2025-12-29-feature-priority-filter'

     - filterByPriority() ユーティリティ実装
     - TaskService統合、テストカバレッジ100%
     - UI ドロップダウン追加

  4. Cleanup prompt:
     Delete branch session/2025-12-29-feature-priority-filter? [y/n]
```

### 6.3 --no-ff (No Fast-Forward) Merges

**Why --no-ff?**:
- ✅ Preserves feature branch history
- ✅ Clear feature boundaries in git log
- ✅ Easy to revert entire feature if needed
- ✅ Merge commit can summarize feature work

**Comparison**:
```
Fast-Forward (--ff):
main: A --- B --- C --- D --- E
                   └─ feature commits appear directly on main

No Fast-Forward (--no-ff):
main: A --- B ----------- M (merge commit)
                \       /
                 C --- D --- E (feature branch history preserved)
```

**All merges use --no-ff** (enforced by `/merge`)

### 6.4 /merge Best Practices

**Before Merge**:
- ✅ All tests passing (npm run test)
- ✅ All commits have decision records
- ✅ Feature complete (no "WIP" commits)
- ✅ Code review complete (if team workflow)

**Mode Selection**:
- **Safe Mode**: Default, use for most merges (worktree isolation)
- **Fast Mode**: Only when confident no conflicts, no symlinks

**After Merge**:
- ✅ Delete merged branch (cleanup)
- ✅ Verify merge commit in git log
- ✅ Push to remote if applicable

### 6.5 Reference Only - No Duplication

**This Skill does NOT re-implement `/merge` logic.**

For `/merge` implementation details:
- Command file: `/Users/ksato/workspace/.claude/commands/merge.md`
- This Skill only documents: **when** to use `/merge`, **workflow integration**, **best practices**

---

## 7. Cleanup & Best Practices

### 7.1 Branch Cleanup After Merge

**Immediately after merge**:
```bash
# Option 1: Delete via /merge prompt (recommended)
Delete branch session/2025-12-29-feature-priority-filter? [y]

# Option 2: Manual deletion
git branch -d session/2025-12-29-feature-priority-filter
# Deleted branch session/2025-12-29-feature-priority-filter (was a1b2c3d).
```

**Why delete merged branches?**:
- ✅ Prevents stale branch accumulation
- ✅ Keeps `git branch` output clean
- ✅ Prevents accidental commits to old branches
- ✅ Merge history preserved in merge commit (not lost)

### 7.2 Stale Branch Management

**Check for stale branches**:
```bash
# List all branches with last commit date
git branch -v

# List merged branches
git branch --merged

# List unmerged branches
git branch --no-merged
```

**Stale Branch Criteria**:
- Branch merged but not deleted
- Branch older than 7 days with no activity
- Branch with "WIP" commits only

**Cleanup stale branches**:
```bash
# Safe deletion (only if merged)
git branch -d <branch-name>

# Force deletion (if unmerged, be careful!)
git branch -D <branch-name>
```

### 7.3 Long-Running Feature Branches

**When feature development spans multiple days**:
```bash
# Example: Large feature taking 1 week
session/2025-12-29-feature-task-archive

# Days 1-3: Initial implementation
# Days 4-5: Edge cases, tests
# Days 6-7: Refactoring, polish

# Same branch throughout (no need to create new branches)
```

**Best Practices**:
- ✅ Keep branch up-to-date with main (periodic rebases)
- ✅ Break into smaller features if >1 week (easier to review)
- ✅ Use descriptive commits (decision records help track progress)

**Keeping up-to-date with main**:
```bash
# Periodically sync with main (daily if active development)
git checkout main
git pull origin main
git checkout session/2025-12-29-feature-task-archive
git rebase main

# Resolve conflicts, continue rebase
# Keeps feature branch clean, reduces merge conflicts later
```

### 7.4 Team Collaboration

**If working with team** (future consideration):

**Remote branches**:
```bash
# Push session branch to remote
git push -u origin session/2025-12-29-feature-priority-filter

# Pull teammate's session branch
git fetch origin
git checkout session/2025-12-29-feature-another-dev
```

**Branch Protection Rules** (GitHub/GitLab):
- Protect `main` branch (require PR reviews)
- Allow direct push to `session/*` branches (feature work)
- Require status checks before merge

**Pull Request Workflow**:
```bash
# After feature complete:
1. Push session branch: git push origin session/2025-12-29-feature-*
2. Create PR on GitHub: session/2025-12-29-feature-* → main
3. Code review, CI checks
4. Merge via GitHub (--no-ff preserved)
5. Delete remote branch
6. Delete local branch: git branch -d session/2025-12-29-feature-*
```

### 7.5 Common Mistakes to Avoid

**Mistake 1: Forgetting to create branch before Edit**
```bash
# Wrong:
# Plan完了 → immediately start editing on main ❌

# Correct:
# Plan完了 → Phase 2.5: Create session/* branch → Edit ✅
```

**Mistake 2: Using wrong branch type**
```bash
# Wrong:
# Bug fix: session/2025-12-29-feature-fix-bug ❌ (feature type for fix)

# Correct:
# Bug fix: session/2025-12-29-fix-task-loading-bug ✅
```

**Mistake 3: Committing to main instead of session branch**
```bash
# /commit will warn, but still a mistake
# Always work on session/* branches (except true hotfixes)
```

**Mistake 4: Not deleting merged branches**
```bash
# Accumulated stale branches clutter workspace
# Delete immediately after merge
```

**Mistake 5: Generic branch names**
```bash
# Wrong:
# session/2025-12-29-feature-update ❌ (what update?)

# Correct:
# session/2025-12-29-feature-priority-filter ✅ (specific)
```

### 7.6 Troubleshooting

**Problem: Created branch with wrong name**
```bash
# Solution: Rename branch
git branch -m session/2025-12-29-feature-wrong-name session/2025-12-29-feature-correct-name
```

**Problem: Accidentally committed to main**
```bash
# Solution: Move commit to new branch
git branch session/2025-12-29-feature-rescue-commit
git reset --hard HEAD~1
git checkout session/2025-12-29-feature-rescue-commit
```

**Problem: Merge conflicts during /merge**
```bash
# /merge handles this interactively
# Follow /merge prompts for conflict resolution
# Use Safe Mode for complex conflicts (worktree isolation)
```

**Problem: Forgot to commit before switching branches**
```bash
# Solution: Stash changes
git stash push -m "WIP: current work"
git checkout <other-branch>

# Return and restore:
git checkout <original-branch>
git stash pop
```

---

## Summary

**Key Takeaways**:
1. **Branch Naming**: `session/YYYY-MM-DD-<type>-<name>` (feature/fix/refactor/hotfix)
2. **Lifecycle**: Create (Phase 2.5) → Develop (Phase 3-4) → Commit (Phase 5) → Merge (Phase 6) → Cleanup
3. **Integration**: `/commit` for decision capture, `/merge` for --no-ff merges
4. **Best Practice**: Delete branches after merge, use descriptive names, follow TDD workflow

**Quick Reference**:
```bash
# Create branch (Phase 2.5)
git checkout -b session/$(date +%Y-%m-%d)-<type>-<name>

# Commit (Phase 5)
# Use /commit command (NOT git commit)

# Merge (Phase 6)
# Use /merge command (NOT git merge)

# Cleanup (Post-Merge)
git branch -d <merged-branch-name>
```

This git-workflow integrates seamlessly with development-workflow Skill, enabling consistent, traceable, and safe development practices.

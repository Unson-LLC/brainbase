# PR Commands Test Plan

**Date**: 2025-12-29
**Branch**: session/2025-12-29-feature-pr-commands
**Status**: Ready for Testing

---

## Prerequisites

### Environment Setup
- [ ] gh CLI installed (`gh --version`)
- [ ] GitHub authenticated (`gh auth status`)
- [ ] Test repository with remote configured
- [ ] session/* branch created with commits

---

## Test Case 1: /pr - Single Commit PR Creation

**Purpose**: Verify `/pr` command creates PR from single commit

**Setup**:
```bash
git checkout -b session/2025-12-29-test-single-commit
echo "test" > test-file.txt
git add test-file.txt
git commit -m "feat: add test file"
```

**Execute**:
```bash
/pr
```

**Expected Results**:
- ✅ gh CLI check passes
- ✅ Branch validation passes (session/* detected)
- ✅ Commit count: 1
- ✅ Push to remote succeeds
- ✅ PR Title: "feat: add test file" (from commit message)
- ✅ PR Body contains:
  - Summary section with commit list
  - コミット履歴 section
  - Test plan checklist
  - Claude Code footer
- ✅ Browser opens with PR page
- ✅ Command exits successfully

**Cleanup**:
```bash
gh pr close --delete-branch
git checkout session/2025-12-29-feature-pr-commands
```

---

## Test Case 2: /pr - Multiple Commits PR Creation

**Purpose**: Verify `/pr` generates title from branch name for multiple commits

**Setup**:
```bash
git checkout -b session/2025-12-29-feature-multi-commit
echo "test1" > file1.txt
git add file1.txt
git commit -m "feat: add file1"

echo "test2" > file2.txt
git add file2.txt
git commit -m "feat: add file2"

echo "test3" > file3.txt
git add file3.txt
git commit -m "feat: add file3"
```

**Execute**:
```bash
/pr
```

**Expected Results**:
- ✅ Commit count: 3
- ✅ PR Title: "feat: multi-commit" (generated from branch name)
  - Branch type: feature → feat
  - Branch name: multi-commit
- ✅ PR Body contains all 3 commits in Summary
- ✅ Browser opens with PR page

**Cleanup**:
```bash
gh pr close --delete-branch
git checkout session/2025-12-29-feature-pr-commands
```

---

## Test Case 3: /pr - Existing PR Detection

**Purpose**: Verify `/pr` detects existing PR and offers to open it

**Setup**:
```bash
git checkout -b session/2025-12-29-test-existing-pr
echo "test" > existing-pr-test.txt
git add existing-pr-test.txt
git commit -m "feat: existing PR test"
/pr  # Create first PR
```

**Execute**:
```bash
/pr  # Try to create PR again
```

**Expected Results**:
- ✅ Detects existing PR
- ✅ Displays warning: "このブランチのPR (#X) は既に存在します"
- ✅ Shows PR URL
- ✅ Asks: "ブラウザで開きますか？ [Y/n]"
- ✅ If Y: Opens browser
- ✅ Exits without creating duplicate PR

**Cleanup**:
```bash
gh pr close --delete-branch
git checkout session/2025-12-29-feature-pr-commands
```

---

## Test Case 4: /merge - PR Mode (Create + Merge)

**Purpose**: Verify `/merge` PR mode creates PR and merges via GitHub

**Setup**:
```bash
git checkout -b session/2025-12-29-test-merge-pr-mode
echo "merge-test" > merge-pr-test.txt
git add merge-pr-test.txt
git commit -m "feat: merge PR mode test"
```

**Execute**:
```bash
/merge
# Select: PRを作成してGitHub経由でマージしますか？ [Y]
```

**Expected Results**:
- ✅ Phase 0: Mode selection → PR Mode selected
- ✅ Phase 1-PR-1: Prerequisites check passes
- ✅ Phase 1-PR-2: Push to remote succeeds
- ✅ Phase 1-PR-3: PR created successfully
  - PR Title correct (single commit: from message)
  - PR Body generated
- ✅ Phase 1-PR-4: GitHub merge succeeds
  - `gh pr merge --merge --delete-branch` executes
  - Merge commit created on main
- ✅ Phase 1-PR-5: Local sync completes
  - `git checkout main`
  - `git pull origin main`
  - `git fetch --prune`
- ✅ Phase 1-PR-6: Success confirmation
  - Shows "Merge pull request #X" in git log
  - Remote branch deleted

**Verification**:
```bash
git checkout main
git log --oneline -3
# Should show: Merge pull request #X from ...
```

**Cleanup**: None needed (already on main, branch deleted)

---

## Test Case 5: /merge - PR Mode Error Handling

**Purpose**: Verify `/merge` PR mode handles CI/CD check failures gracefully

**Setup**:
```bash
git checkout -b session/2025-12-29-test-merge-pr-error
echo "error-test" > error-test.txt
git add error-test.txt
git commit -m "feat: error handling test"
```

**Simulate**:
- Manually create PR with failing CI checks
- Or configure branch protection requiring reviews

**Execute**:
```bash
/merge
# Select: PRを作成してGitHub経由でマージしますか？ [Y]
```

**Expected Results**:
- ✅ Phase 1-PR-4: Merge fails with error message
- ✅ Error message shows:
  - "Error: マージに失敗しました"
  - "考えられる原因:"
  - "  - CI/CDチェックが未完了"
  - "  - コンフリクトが発生"
  - "  - レビュー承認が必要"
  - "GitHub UI でPRを確認してください:"
- ✅ Opens PR in browser via `gh pr view --web`
- ✅ Command exits with error code

**Cleanup**:
```bash
gh pr close --delete-branch
git checkout session/2025-12-29-feature-pr-commands
```

---

## Test Case 6: /merge - Safe/Fast Mode Still Works

**Purpose**: Verify existing Safe/Fast mode functionality is not broken

**Setup**:
```bash
git checkout -b session/2025-12-29-test-safe-mode
echo "safe-mode-test" > safe-mode-test.txt
git add safe-mode-test.txt
git commit -m "feat: safe mode test"
```

**Execute**:
```bash
/merge
# Select: PRを作成してGitHub経由でマージしますか？ [n]
# Select: Safe Mode
```

**Expected Results**:
- ✅ Phase 0: Mode selection → Safe Mode selected
- ✅ Phase 1: 変更確認 executes
- ✅ Phase 3A: Safe Mode worktree merge completes
- ✅ Merge commit created with --no-ff
- ✅ main updated successfully

**Verification**:
```bash
git checkout main
git log --oneline -1
# Should show: Merge session: session/2025-12-29-test-safe-mode
```

**Cleanup**:
```bash
git branch -d session/2025-12-29-test-safe-mode
```

---

## Integration Tests

### INT-1: Workflow Compatibility

**Purpose**: Verify new commands integrate with existing development-workflow

**Test**:
1. Follow full development-workflow: Explore → Plan → Branch → Edit → Test → Commit → Merge
2. Use `/pr` at Phase 6 (Merge) → verify PR created
3. Merge via GitHub UI → verify main updated
4. Next session: use `/merge` PR mode → verify auto-merge works

### INT-2: git-workflow Skill Integration

**Purpose**: Verify git-workflow skill correctly documents new behavior

**Verification**:
- [ ] `.claude/skills/git-workflow/SKILL.md` Section 1.3 includes `/pr`
- [ ] Section 6 renamed to "/pr and /merge Integration"
- [ ] Section 6.1-6.4 correctly document command responsibilities
- [ ] Mode selection guide is clear and actionable

### INT-3: Error Recovery

**Purpose**: Verify graceful error handling across all scenarios

**Test Scenarios**:
1. gh CLI not installed → clear error + installation instructions
2. GitHub not authenticated → clear error + auth instructions
3. Not on session/* branch → error + branch guidance
4. No commits → error + commit guidance
5. PR already exists → warning + browser open option
6. Network error during push → error + retry guidance
7. Merge conflict in PR mode → error + GitHub UI guidance

---

## Success Criteria

### Command Files
- [x] `/pr` command file created at correct location
- [x] `/pr` command file has correct permissions (644)
- [x] `/merge` command file updated with PR mode
- [x] All bash syntax validated

### Documentation
- [x] git-workflow skill updated
- [x] development-workflow skill updated
- [x] Both skills reference new commands correctly
- [x] Mode selection documented clearly

### Functionality
- [ ] `/pr` appears in Claude Code custom commands list
- [ ] `/pr` creates PRs successfully (Test Case 1-3)
- [ ] `/merge` PR mode works (Test Case 4-5)
- [ ] Existing Safe/Fast mode unaffected (Test Case 6)
- [ ] All error cases handled gracefully (INT-3)

### Integration
- [ ] Workflow integration verified (INT-1)
- [ ] Skill integration verified (INT-2)
- [ ] No regression in existing commands

---

## Known Issues

### Issue 1: Command Recognition Delay
**Status**: Resolved
**Description**: `/pr` command file had restrictive permissions (600)
**Fix**: Changed permissions to 644 to match other commands
**Action**: Claude Code may need restart to recognize new command

---

## Test Execution Log

| Test Case | Date | Executor | Status | Notes |
|-----------|------|----------|--------|-------|
| TC1: /pr Single Commit | - | - | Pending | Awaiting command recognition |
| TC2: /pr Multiple Commits | - | - | Pending | - |
| TC3: /pr Existing PR | - | - | Pending | - |
| TC4: /merge PR Mode | - | - | Pending | - |
| TC5: /merge PR Error | - | - | Pending | - |
| TC6: Safe/Fast Mode | - | - | Pending | - |
| INT-1: Workflow | - | - | Pending | - |
| INT-2: Skill Integration | - | - | Passed | Documentation verified |
| INT-3: Error Recovery | - | - | Pending | - |

---

**Next Steps**:
1. Restart Claude Code to recognize `/pr` command
2. Execute Test Cases 1-6 sequentially
3. Document results in Test Execution Log
4. Fix any issues discovered
5. Run Integration Tests
6. Update documentation based on findings

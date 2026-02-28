# Spec: Commit Tree Panel

## API Specification

### `GET /api/sessions/:id/commit-log?limit=50`

**Response Schema:**
```json
{
  "commits": [
    {
      "hash": "abc1234",
      "description": "feat: add commit tree panel",
      "timestamp": "2026-02-16T10:30:00+09:00",
      "author": "ksato",
      "bookmarks": ["main"],
      "isWorkingCopy": true
    }
  ],
  "repoType": "jj",
  "worktreePath": "/Users/ksato/workspace/.worktrees/session-xxx-brainbase"
}
```

**Error Responses:**
- `404`: Session not found
- `400`: Session does not have a worktree
- `500`: VCS command execution failed

## Server Implementation

### WorktreeService.getCommitLog(sessionId, repoPath, limit)

**Jujutsu:**
```bash
jj -R "<worktreePath>" log -r "::@" -T '<template>' --no-pager -n <limit>
```

Template: `commit_id ++ "\x00" ++ description.first_line() ++ "\x00" ++ committer.timestamp() ++ "\x00" ++ author.name() ++ "\x00" ++ bookmarks ++ "\x00" ++ if(self.working_copies(), "true", "false") ++ "\n"`

**Git (fallback):**
```bash
git -C "<worktreePath>" log --format="%h%x00%s%x00%aI%x00%an%x00%D%x00" -n <limit>
```

## Frontend Specification

### CommitTreeService

```javascript
class CommitTreeService {
  constructor({ httpClient, store, eventBus })
  async loadCommitLog(sessionId): Promise<void>
  // - GET /api/sessions/:id/commit-log
  // - store.setState({ commitLog: response })
  // - eventBus.emit(EVENTS.COMMIT_LOG_LOADED, response)
}
```

### CommitTreeView

```javascript
class CommitTreeView {
  constructor({ commitTreeService })
  mount(container): void
  render(): void
  unmount(): void
  // Events listened: SESSION_CHANGED, COMMIT_LOG_LOADED
}
```

### HTML Structure

```html
<!-- commit-tree-panel（main と right-panel-resize-handle の間に挿入） -->
<aside class="commit-tree-panel" id="commit-tree-panel">
  <div class="section-header">
    <h3><i data-lucide="git-branch"></i> コミット</h3>
  </div>
  <div class="commit-tree-list" id="commit-tree-list">
    <div class="commit-tree-empty">セッションを選択してください</div>
  </div>
</aside>
```

### Commit Node HTML

```html
<div class="commit-node current">
  <div class="commit-dot"></div>
  <div class="commit-line"></div>
  <div class="commit-info">
    <div class="commit-header">
      <span class="commit-hash">abc1234</span>
      <span class="commit-bookmark">main</span>
    </div>
    <div class="commit-desc">feat: add commit tree panel</div>
    <div class="commit-meta">
      <span class="commit-time">10:30</span>
      <span class="commit-author">ksato</span>
    </div>
  </div>
</div>
```

### Panel Resize

- storageKey: `brainbase:commit-tree-panel-width`
- minWidth: 200
- maxWidth: 400
- defaultWidth: 260
- direction: `right`（パネルの右端にリサイズハンドル）

## AC Mapping

| AC | 実装箇所 | 検証 |
|----|---------|------|
| AC1 | CommitTreeView: SESSION_CHANGED リスン → loadCommitLog | セッション切替後にパネルが更新される |
| AC2 | commit-node HTML構造 | hash/desc/time/bookmarkが表示される |
| AC3 | `.commit-node.current` クラス | isWorkingCopy=true にハイライト |
| AC4 | panel-resize.js: localStorage保存/復元 | リロード後も幅が保持される |
| AC5 | CommitTreeView: worktreeなし時の空状態 | 空メッセージが表示される |
| AC6 | WorktreeService: _isJujutsuRepo()分岐 | jj/git両方でコミットログ取得 |

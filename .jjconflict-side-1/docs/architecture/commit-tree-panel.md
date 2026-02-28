# Architecture: Commit Tree Panel

## Layer Allocation

既存の4層アーキテクチャ（View -> Service -> Repository -> EventBus）に準拠。

```
┌─────────────────────────────────────────────────┐
│ View Layer                                       │
│  CommitTreeView (public/modules/ui/views/)        │
│  - SESSION_CHANGED リスン → Service呼び出し       │
│  - COMMIT_LOG_LOADED リスン → render()            │
│  - mount/unmount/dispose                          │
├─────────────────────────────────────────────────┤
│ Service Layer                                     │
│  CommitTreeService (public/modules/domain/)        │
│  - loadCommitLog(sessionId) → API呼び出し         │
│  - Store更新 + Event発火                          │
├─────────────────────────────────────────────────┤
│ API Layer                                         │
│  GET /api/sessions/:id/commit-log?limit=50        │
│  SessionController.getCommitLog                   │
├─────────────────────────────────────────────────┤
│ Server Service Layer                              │
│  WorktreeService.getCommitLog(sessionId, repoPath)│
│  - _isJujutsuRepo() で VCS判定                    │
│  - jj log / git log 実行                          │
│  - JSON変換して返却                               │
└─────────────────────────────────────────────────┘
```

## Data Flow

```
SESSION_CHANGED event
  → CommitTreeView (リスン)
  → CommitTreeService.loadCommitLog(sessionId)
  → httpClient.get(`/api/sessions/${id}/commit-log`)
  → SessionController.getCommitLog(req, res)
  → WorktreeService.getCommitLog(sessionId, repoPath)
  → jj log / git log (VCS)
  → JSON response { commits, repoType, worktreePath }
  → CommitTreeService: Store更新 + COMMIT_LOG_LOADED emit
  → CommitTreeView.render()
```

## Boundaries

### Server Side
- **WorktreeService**: `getCommitLog()` メソッド追加（既存Service拡張）
- **SessionController**: `getCommitLog` ハンドラ追加
- **sessions.js**: ルート1行追加

### Client Side
- **CommitTreeService**: 新規（Service層）
- **CommitTreeView**: 新規（View層）
- **EventBus**: `COMMIT_LOG_LOADED` イベント追加
- **app.js**: DI登録 + 初期化追加
- **index.html**: パネルHTML挿入（context-sidebarの前）
- **style.css**: CSS追加
- **panel-resize.js**: commit-tree用のリサイズ設定追加

## SSOT

コミット履歴の正本はVCS（jj/git）。UIはビューのみ（キャッシュなし、毎回取得）。

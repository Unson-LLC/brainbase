# Phase 3.5: Session部分リファクタリング 調査・設計

## 目的
server.jsのSession関連コード（約900行）をMVCパターンに分離し、server.jsを200行以下に削減

## 現状分析

### ヘルパー関数一覧（11個、約900行）

| 関数名 | 行数 | 目的 | 依存関数 | グローバル状態依存 |
|--------|------|------|----------|-------------------|
| `getSessionStatus()` | 326 | Hook報告からセッション状態取得 | - | activeSessions, hookStatus |
| `findFreePort(startPort)` | 352 | 空きポート検索 | - | - |
| `cleanupOrphans()` | 369 | 孤立ttydプロセスクリーンアップ | execPromise | - |
| `ensureWorktreesDir()` | 381 | worktreesディレクトリ作成 | fs.mkdir | - |
| `createWorktree(sessionId, repoPath)` | 390 | worktree作成 + symlink設定 | ensureWorktreesDir, execPromise | WORKTREES_DIR |
| `removeWorktree(sessionId, repoPath)` | 503 | worktree削除 | execPromise | WORKTREES_DIR |
| `fixWorktreeSymlinks(sessionId, repoPath)` | 525 | 既存worktreeのskip-worktree修正 | execPromise | WORKTREES_DIR |
| `getWorktreeStatus(sessionId, repoPath)` | 593 | worktreeの未マージ状態確認 | execPromise | WORKTREES_DIR |
| `mergeWorktree(sessionId, repoPath, sessionName)` | 677 | worktreeをmainにマージ | execPromise | WORKTREES_DIR |
| `detectChoices(text)` | 936 | ターミナル出力から選択肢検出 | - | - |
| `stopTtydProcess(sessionId)` | 1216 | ttydプロセス停止 | - | activeSessions |

### エンドポイント一覧（14個）

| エンドポイント | メソッド | 行 | 使用ヘルパー関数 | 主な処理 |
|---------------|---------|-----|-----------------|----------|
| `/api/sessions/report_activity` | POST | 301 | - | hookStatusの更新 |
| `/api/sessions/status` | GET | 346 | getSessionStatus | セッション状態返却 |
| `/api/sessions/start` | POST | 747 | findFreePort, spawn | ttyd起動 |
| `/api/sessions/:id/input` | POST | 853 | execPromise | tmux send-keys |
| `/api/sessions/:id/content` | GET | 893 | execPromise | tmux capture-pane |
| `/api/sessions/:id/output` | GET | 912 | detectChoices | 出力+選択肢検出 |
| `/api/sessions/create-with-worktree` | POST | 981 | createWorktree, findFreePort, spawn | worktree作成+ttyd起動 |
| `/api/sessions/:id/worktree-status` | GET | 1099 | getWorktreeStatus | worktree状態取得 |
| `/api/sessions/:id/fix-symlinks` | POST | 1119 | fixWorktreeSymlinks | symlink修正 |
| `/api/sessions/:id/merge` | POST | 1139 | mergeWorktree | ブランチマージ |
| `/api/sessions/:id/worktree` | DELETE | 1187 | removeWorktree | worktree削除 |
| `/api/sessions/:id/archive` | POST | 1240 | getWorktreeStatus, mergeWorktree, removeWorktree, stopTtydProcess | セッションアーカイブ |
| `/api/sessions/:id/restore` | POST | 1289 | createWorktree, findFreePort, spawn | セッション復元 |
| `/api/sessions/:id/stop` | POST | 1424 | stopTtydProcess | ttyd停止のみ |

### グローバル状態

```javascript
// Line 99-100
let activeSessions = new Map(); // sessionId -> { port, process }
let sessionHookStatus = new Map(); // sessionId -> { status: 'working'|'done', timestamp }
let nextPort = 3001;

// Constants
const WORKTREES_DIR = path.join(__dirname, '../.worktrees');
```

## 責務分析

### 1. プロセス管理（ttyd/tmux）
- ttyd起動・停止
- ポート管理
- 孤立プロセスクリーンアップ
- tmux操作（send-keys, capture-pane）

### 2. Worktree管理（Git）
- worktree作成・削除
- シンボリックリンク設定
- skip-worktree設定
- ブランチマージ
- 状態確認

### 3. セッション状態管理
- activeSessions Map管理
- hookStatus管理
- stateStore連携

### 4. ターミナルI/O
- 出力取得
- 入力送信
- 選択肢検出

## 設計方針

### Model層（3クラス）

#### 1. SessionManager
**責務**: セッション状態管理とttyd/tmuxプロセス管理

```javascript
export class SessionManager {
    constructor(stateStore) {
        this.activeSessions = new Map();
        this.hookStatus = new Map();
        this.nextPort = 3001;
        this.stateStore = stateStore;
    }

    // プロセス管理
    async startTtyd(sessionId, cwd, initialCommand, engine)
    async stopTtyd(sessionId)
    async cleanupOrphans()

    // ポート管理
    async findFreePort(startPort)

    // tmux操作
    async sendInput(sessionId, input, type)
    async getContent(sessionId, lines)
    async getOutput(sessionId)

    // 状態管理
    getSessionStatus()
    reportActivity(sessionId, status)
    isActive(sessionId)
}
```

#### 2. WorktreeService
**責務**: Git worktree操作

```javascript
export class WorktreeService {
    constructor(worktreesDir) {
        this.worktreesDir = worktreesDir;
    }

    async ensureWorktreesDir()
    async create(sessionId, repoPath)
    async remove(sessionId, repoPath)
    async fixSymlinks(sessionId, repoPath)
    async getStatus(sessionId, repoPath)
    async merge(sessionId, repoPath, sessionName)
}
```

#### 3. TerminalOutputParser
**責務**: ターミナル出力解析

```javascript
export class TerminalOutputParser {
    detectChoices(text)
}
```

### Controller層

#### SessionController
**責務**: リクエスト処理とレスポンス生成

```javascript
export class SessionController {
    constructor(sessionManager, worktreeService, stateStore) {
        this.sessionManager = sessionManager;
        this.worktreeService = worktreeService;
        this.stateStore = stateStore;
    }

    // Activity & Status
    reportActivity = async (req, res) => { ... }
    getStatus = (req, res) => { ... }

    // Process Management
    start = async (req, res) => { ... }
    stop = async (req, res) => { ... }
    archive = async (req, res) => { ... }
    restore = async (req, res) => { ... }

    // Terminal I/O
    sendInput = async (req, res) => { ... }
    getContent = async (req, res) => { ... }
    getOutput = async (req, res) => { ... }

    // Worktree Operations
    createWithWorktree = async (req, res) => { ... }
    getWorktreeStatus = async (req, res) => { ... }
    fixSymlinks = async (req, res) => { ... }
    merge = async (req, res) => { ... }
    deleteWorktree = async (req, res) => { ... }
}
```

### Router層

```javascript
export function createSessionRouter(sessionManager, worktreeService, stateStore) {
    const router = express.Router();
    const controller = new SessionController(sessionManager, worktreeService, stateStore);

    // Activity & Status
    router.post('/report_activity', controller.reportActivity);
    router.get('/status', controller.getStatus);

    // Process Management
    router.post('/start', controller.start);
    router.post('/:id/stop', controller.stop);
    router.post('/:id/archive', controller.archive);
    router.post('/:id/restore', controller.restore);

    // Terminal I/O
    router.post('/:id/input', controller.sendInput);
    router.get('/:id/content', controller.getContent);
    router.get('/:id/output', controller.getOutput);

    // Worktree Operations
    router.post('/create-with-worktree', controller.createWithWorktree);
    router.get('/:id/worktree-status', controller.getWorktreeStatus);
    router.post('/:id/fix-symlinks', controller.fixSymlinks);
    router.post('/:id/merge', controller.merge);
    router.delete('/:id/worktree', controller.deleteWorktree);

    return router;
}
```

## 実装順序

### Step 1: Model層実装
1. **TerminalOutputParser** - 最も独立（10分）
2. **WorktreeService** - Git操作のみ（60分）
3. **SessionManager** - プロセス・状態管理（90分）

### Step 2: Controller/Router実装
1. **SessionController** - Model呼び出し（60分）
2. **SessionRouter** - ルーティング定義（15分）

### Step 3: server.js統合
1. SessionManager/WorktreeServiceインスタンス化
2. Router登録
3. 旧エンドポイントコメントアウト
4. 動作確認

## リスク・注意点

### 1. activeSessions Mapの共有
- **問題**: SessionManagerとserver.jsの両方で参照が必要
- **対策**: SessionManagerをserver.jsで生成し、Map参照を渡す

### 2. プロセス生成（spawn）の扱い
- **問題**: child_process.spawnはController層で呼ぶべきかModel層か
- **対策**: SessionManagerがプロセス管理を担当（Model層）

### 3. execPromise依存
- **問題**: util.promisify(exec)がserver.js直下で定義
- **対策**: WorktreeServiceにexecPromiseを注入

### 4. ttyd proxyとの連携
- **問題**: ttydProxyがactiveSessions.has()で判定
- **対策**: SessionManagerのgetActiveSessions()で参照を返す

## 期待される効果

### 行数削減
- server.js: 約1,455行 → **200行以下**
- 削減: **約1,255行** (Session関連を分離)

### コード品質
- **テスタビリティ**: WorktreeService/SessionManagerを独立テスト可能
- **保守性**: Git操作とプロセス管理が分離され、変更影響が局所化
- **再利用性**: SessionManager/WorktreeServiceを他プロジェクトでも利用可能

---
**作成日**: 2025-12-22
**Phase**: 3.5 - Session Refactoring Analysis

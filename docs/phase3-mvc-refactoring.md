# Phase 3: サーバー側MVC分離設計

## 目標
server.js（1,568行）を200行以下に削減し、MVCパターンに分離

## 現状分析

### server.jsの責務（1,568行）
1. **ルーティング**: 30以上のAPIエンドポイント定義
2. **セッション管理**: worktree作成/削除/マージ、ttydプロセス管理
3. **ビジネスロジック**: タスク/Inbox/設定のCRUD
4. **プロセス管理**: ポート検索、孤立プロセスクリーンアップ

## MVC分離設計

### ディレクトリ構造
```
server/
├── routes/           # ルーティング定義（各10-30行）
│   ├── tasks.js      # タスク関連ルート
│   ├── sessions.js   # セッション関連ルート
│   ├── config.js     # 設定関連ルート
│   ├── inbox.js      # Inbox関連ルート
│   └── misc.js       # その他（version, restart, upload）
├── controllers/      # リクエスト処理・レスポンス生成（各50-100行）
│   ├── task-controller.js
│   ├── session-controller.js
│   ├── config-controller.js
│   └── inbox-controller.js
└── models/          # ビジネスロジック・データ操作（各100-200行）
    ├── session-model.js      # セッション管理ロジック
    ├── worktree-model.js     # worktree操作
    └── state-model.js        # 状態管理

server.js (< 200行)  # エントリーポイント
```

### 責務分離

#### Router（ルーティング定義のみ）
- HTTPメソッドとパスのマッピング
- Controllerへの委譲
- ミドルウェアの適用

**例: routes/tasks.js**
```javascript
import express from 'express';
import { TaskController } from '../controllers/task-controller.js';

const router = express.Router();
const controller = new TaskController();

router.get('/', controller.list);
router.post('/:id', controller.update);
router.put('/:id', controller.update);
router.delete('/:id', controller.delete);

export default router;
```

#### Controller（リクエスト処理・レスポンス生成）
- リクエストパラメータの抽出
- Modelの呼び出し
- レスポンスの生成（JSON, HTML）
- エラーハンドリング

**例: controllers/task-controller.js**
```javascript
import { TaskModel } from '../models/task-model.js';

export class TaskController {
    constructor() {
        this.model = new TaskModel();
    }

    list = async (req, res) => {
        try {
            const tasks = await this.model.getTasks();
            res.json(tasks);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    };

    update = async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;
            await this.model.updateTask(id, updates);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    };
}
```

#### Model（ビジネスロジック・データ操作）
- データの永続化（ファイルI/O）
- ビジネスルールの実装
- 外部プロセスとの連携
- 純粋なJavaScript（Express非依存）

**例: models/session-model.js**
```javascript
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

export class SessionModel {
    async createWorktree(sessionId, repoPath) {
        // worktree作成ロジック
    }

    async removeWorktree(sessionId, repoPath) {
        // worktree削除ロジック
    }

    async mergeWorktree(sessionId, repoPath) {
        // worktreeマージロジック
    }
}
```

### server.js（エントリーポイント、200行以下）

```javascript
import express from 'express';
import taskRoutes from './server/routes/tasks.js';
import sessionRoutes from './server/routes/sessions.js';
import configRoutes from './server/routes/config.js';
import inboxRoutes from './server/routes/inbox.js';
import miscRoutes from './server/routes/misc.js';

const app = express();

// ミドルウェア設定
app.use(express.json());
app.use(express.static('public'));

// ルーター登録
app.use('/api/tasks', taskRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/config', configRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api', miscRoutes);

// サーバー起動
const PORT = process.env.PORT || 31013;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
```

## 実装順序

### Step 1: ディレクトリ構造作成
- `server/routes/` ディレクトリ作成
- `server/controllers/` ディレクトリ作成
- `server/models/` ディレクトリ作成

### Step 2: Model層実装（ビジネスロジック抽出）
1. `server/models/state-model.js` - 状態管理ロジック
2. `server/models/worktree-model.js` - worktree操作
3. `server/models/session-model.js` - セッション管理

### Step 3: Controller層実装
1. `server/controllers/task-controller.js`
2. `server/controllers/session-controller.js`
3. `server/controllers/config-controller.js`
4. `server/controllers/inbox-controller.js`

### Step 4: Router層実装
1. `server/routes/tasks.js`
2. `server/routes/sessions.js`
3. `server/routes/config.js`
4. `server/routes/inbox.js`
5. `server/routes/misc.js`

### Step 5: server.js統合
- 既存のserver.jsをserver.old.jsにリネーム
- 新しいserver.jsを作成（200行以下）
- ルーター登録
- ミドルウェア設定

### Step 6: 動作確認
- 既存機能が正常動作することを確認
- エンドポイントごとにテスト

## 期待される効果

### コード品質向上
- **単一責任原則**: 各ファイルが1つの責務のみ持つ
- **テスタビリティ**: Model層を独立してテスト可能
- **保守性**: 変更箇所の特定が容易

### 行数削減
- server.js: 1,568行 → 200行以下（87%削減）
- 合計行数: ほぼ同じ（分割により可読性向上）

### 開発効率向上
- **並行作業**: 複数人で異なるControllerを同時開発可能
- **影響範囲の限定**: Router/Controller/Model間の責務が明確

## テスト戦略

### Model層のテスト
- ファイルI/Oはモック
- ビジネスロジックの単体テスト
- 外部プロセス連携のテスト

### Controller層のテスト
- リクエスト/レスポンスのモック
- Modelの呼び出しを確認
- エラーハンドリングのテスト

### 統合テスト
- 実際のHTTPリクエストでエンドツーエンドテスト
- 既存機能の回帰テスト

## リスク管理

### リスク
- 既存機能の破壊
- パフォーマンス劣化
- 依存関係の見落とし

### 対策
- 段階的なリファクタリング
- 各ステップでの動作確認
- 既存のserver.jsを保持（server.old.js）
- ロールバック可能な状態を維持

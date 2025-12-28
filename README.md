# brainbase

> 全事業を統一OSで動かす、知識・タスク管理システム

ローカルファイルベース（Markdown + YAML）のプロジェクト管理システムに、ブラウザUI、ターミナル統合、AI自動化を組み合わせた統合開発環境。

## 主要機能

- **タスク管理**: `_tasks/index.md`を正本とした一元管理
- **スケジュール表示**: `_schedules/`からの日次スケジュール統合表示
- **マルチセッション**: プロジェクト別tmuxセッションの切り替え
- **ターミナル統合**: ttydベースのブラウザ内ターミナル
- **ファイル監視**: タスク・スケジュールのリアルタイム更新
- **Inbox管理**: Slack/GitHub等からの通知集約（外部連携はオプション）
- **Claude Code Skills連携**: AI自動化のための拡張ポイント

## セットアップ

### 必要要件

- Node.js 18以上
- npm 9以上
- tmux（ターミナル統合を使う場合）
- ttyd（ターミナル統合を使う場合）

### インストール

```bash
# リポジトリをクローン
git clone https://github.com/Unson-LLC/brainbase.git
cd brainbase

# 依存パッケージのインストール
npm install

# 開発サーバー起動
npm start
```

ブラウザで `http://localhost:3000` を開く。

### サンプルデータで試す

初回起動時は以下のサンプルデータが使用されます：

- `_codex-sample/`: プロジェクト・組織・人物情報のサンプル
- `_tasks-sample/`: タスク管理のサンプル
- `_schedules-sample/`: スケジュールのサンプル
- `_inbox-sample/`: 受信箱のサンプル

実際のプロジェクトデータを使う場合は、以下のディレクトリを作成：

```bash
mkdir -p _codex/projects _codex/orgs _codex/common/meta/{people,raci}
mkdir -p _tasks _schedules _inbox
```

詳細なデータ構造は各サンプルディレクトリを参照してください。

## ディレクトリ構造

```
brainbase/
├── public/              # フロントエンドUI
│   ├── index.html       # メインHTML
│   ├── modules/         # ドメインサービス
│   └── style.css        # スタイルシート
├── server/              # バックエンド（Express.js）
│   ├── routes/          # APIルーティング
│   ├── services/        # ビジネスロジック
│   └── controllers/     # リクエストハンドラ
├── lib/                 # パーサー・解析ライブラリ
│   ├── task-parser.js   # タスクファイル解析
│   ├── schedule-parser.js
│   ├── config-parser.js
│   └── inbox-parser.js
├── _codex-sample/       # プロジェクト・組織情報サンプル
│   ├── projects/        # プロジェクト情報
│   ├── orgs/            # 組織情報
│   └── common/meta/     # 人物・RACI
├── _tasks-sample/       # タスク管理サンプル
│   └── index.md         # タスク一覧
├── _schedules-sample/   # スケジュールサンプル
│   └── 2025-01-15.md    # 日次スケジュール
├── _inbox-sample/       # 受信箱サンプル
│   └── pending.md       # 未処理アイテム
├── _codex/              # 実データ（.gitignore）
├── _tasks/              # タスク正本（.gitignore）
├── _schedules/          # スケジュール（.gitignore）
├── _inbox/              # 受信箱（.gitignore）
├── docs/                # 開発ドキュメント
└── package.json
```

**重要:** `_codex/`, `_tasks/`, `_schedules/`, `_inbox/` は `.gitignore` で除外されており、個人データは含まれません。サンプルデータ（`*-sample/`）を開発・テスト用に使用してください。

## API概要

brainbaseは以下のREST APIを提供します：

### タスク管理

- `GET /api/tasks` - タスク一覧取得
- `GET /api/tasks/:id` - 特定タスク取得

### スケジュール

- `GET /api/schedule/today` - 今日のスケジュール
- `GET /api/schedule/:date` - 特定日のスケジュール

### 受信箱

- `GET /api/inbox` - 受信箱アイテム一覧
- `POST /api/inbox/:id/mark-read` - 既読マーク

### セッション管理

- `GET /api/sessions` - tmuxセッション一覧
- `POST /api/sessions/:name` - セッション作成
- `DELETE /api/sessions/:name` - セッション削除

### 設定

- `GET /api/config` - 設定取得
- `GET /api/state` - UI状態取得/保存

## 開発

### スクリプト

```bash
npm start       # 本番モード起動
npm run dev     # 開発モード（ファイル監視・自動再起動）
npm test        # テスト実行
npm run test:coverage  # カバレッジ付きテスト
```

### アーキテクチャ

brainbaseは以下の技術スタックで構成されています：

- **フロントエンド**: Vanilla JS, CSS（依存ライブラリ最小化）
- **バックエンド**: Node.js, Express.js
- **データ層**: ローカルファイル（Markdown, YAML）
- **ターミナル**: ttyd, tmux
- **テスト**: Vitest, Playwright

アーキテクチャの詳細は [docs/REFACTORING_OVERVIEW.md](docs/REFACTORING_OVERVIEW.md) を参照してください。

### コントリビューション

プルリクエストを歓迎します！以下のガイドラインに従ってください：

1. フォークしてフィーチャーブランチを作成
2. テストを追加・実行（`npm test`）
3. コミットメッセージは日本語OK
4. プルリクエストを作成

## ライセンス

（未定）

## 連絡先

- **GitHub Issues**: [https://github.com/Unson-LLC/brainbase/issues](https://github.com/Unson-LLC/brainbase/issues)
- **リポジトリ**: [https://github.com/Unson-LLC/brainbase](https://github.com/Unson-LLC/brainbase)

---

**注意**: このプロジェクトは現在開発中です。APIや仕様は予告なく変更される可能性があります。

---
name: branch-worktree-rules
description: brainbaseにおけるブランチ運用とworktree管理のルール。正本ディレクトリのシンボリックリンク方式、コミット先の分離を定義。worktreeで作業する際に使用。
---

## Triggers

以下の状況で使用：
- worktreeで作業を開始するとき
- コミット先を確認したいとき
- セッションブランチを作成したいとき

# ブランチ・Worktree運用ルール

brainbase-uiのセッション管理とgit worktree運用の標準ルールです。

## 基本原則

**ファイルの性質によってコミット先を分離する:**

| ファイル種別 | 性質 | コミット先 |
|-------------|------|------------|
| 正本ディレクトリ | 全セッションで共有 | main直接 |
| プロジェクトコード | ブランチごとに異なりうる | セッションブランチ |

---

## 正本ディレクトリの定義

以下は「正本」として、全worktreeで共有される：

```
/Users/ksato/workspace/
├── _codex/          # ナレッジ正本
├── _tasks/          # タスク正本
├── _inbox/          # 受信箱
├── _schedules/      # スケジュール
├── _ops/            # 共通スクリプト
├── .claude/         # Claude設定・Skills
└── config.yml       # 設定ファイル
```

**正本の特徴:**
- 常に最新を全セッションで共有したい
- ブランチ分岐の対象ではない
- mainに直接コミットする

---

## Worktree構造（シンボリックリンク方式）

worktree作成時、正本ディレクトリはシンボリックリンクで正本パスを参照：

```
/Users/ksato/workspace/.worktrees/session-xxx/
├── _codex -> /Users/ksato/workspace/_codex      # シンボリックリンク
├── _tasks -> /Users/ksato/workspace/_tasks      # シンボリックリンク
├── _inbox -> /Users/ksato/workspace/_inbox      # シンボリックリンク
├── _schedules -> /Users/ksato/workspace/_schedules
├── _ops -> /Users/ksato/workspace/_ops
├── .claude -> /Users/ksato/workspace/.claude
├── config.yml -> /Users/ksato/workspace/config.yml
├── CLAUDE.md                                     # 実ファイル（各worktreeに存在）
├── brainbase-ui/                                # 実ファイル（ブランチローカル）
└── projects/                                    # 実ファイル（ブランチローカル）
```

**メリット:**
- どのworktreeからでも同じ正本を編集
- 正本の変更はmainに自動的に属する
- パス解決の混乱がない

---

## コミットフロー

### 1. プロジェクトコード（セッションブランチ経由）

```
worktreeで編集 → セッションブランチにコミット → mainにマージ
```

```bash
# 現在のブランチを確認
git branch
# * session/session-XXXX

# コードの変更をコミット
git add brainbase-ui/
git commit -m "feat: 機能追加"

# アーカイブ時にmainにマージ
```

### 2. 正本ファイル（main直接コミット）

```
worktreeで編集（シンボリックリンク経由）→ mainで直接コミット
```

```bash
# 正本ファイルを編集（シンボリックリンク経由で自動的に正本を編集）
vim _codex/projects/salestailor/project.md
vim .claude/skills/new-skill/SKILL.md

# mainに直接コミット
cd /Users/ksato/workspace
git add _codex/ .claude/
git commit -m "docs: ナレッジ追加"
```

---

## /merge コマンドの動作

セッション終了時の `/merge` コマンドは以下を実行：

1. **セッションブランチの変更確認**
   - プロジェクトコードの変更があればセッションブランチにコミット

2. **正本の変更確認**
   - 正本ディレクトリの変更があればmainに直接コミット
   - 「正本の変更をmainにコミットしますか？」と確認

3. **マージ実行**
   - セッションブランチをmainにマージ

---

## Worktree作成時のセットアップ

brainbase-uiがworktree作成時に自動実行：

```bash
# worktree作成
git worktree add .worktrees/session-xxx -b session/session-xxx

# シンボリックリンク作成
cd .worktrees/session-xxx
rm -rf _codex _tasks _inbox _schedules _ops .claude config.yml
ln -s /Users/ksato/workspace/_codex _codex
ln -s /Users/ksato/workspace/_tasks _tasks
ln -s /Users/ksato/workspace/_inbox _inbox
ln -s /Users/ksato/workspace/_schedules _schedules
ln -s /Users/ksato/workspace/_ops _ops
ln -s /Users/ksato/workspace/.claude .claude
ln -s /Users/ksato/workspace/config.yml config.yml
```

---

## ルールまとめ

| 状況 | 編集場所 | コミット先 |
|-----|---------|------------|
| Skills追加・更新 | worktree内（シンボリックリンク経由） | main直接 |
| タスク更新 | worktree内（シンボリックリンク経由） | main直接 |
| ナレッジ追加 | worktree内（シンボリックリンク経由） | main直接 |
| プロジェクトコード | worktree内（実ファイル） | セッションブランチ |
| 設定ファイル変更 | worktree内（シンボリックリンク経由） | main直接 |

---

## ファイル配置の判断フロー

新規ファイルを作成する際、**どこに配置すべきか**を判断するフローチャート：

### ステップ1: ファイルの性質を確認

**質問**: このファイルは誰がアクセスするか？

- **佐藤のみ** → `_codex/` へ進む
- **GM・関係者も** → プロジェクトリポジトリへ進む

---

### ステップ2: _codex/ に置く場合

`_codex/` は**運用ドキュメントの正本**であり、以下に該当する場合のみ使用：

**✅ _codex/ に置くべきもの:**
- 戦略・方針（01_strategy.md）
- 体制図・RACI定義
- KPI定義（数値目標の定義）
- 意思決定ログ
- 顧客情報（機密含む）
- 社内専用の運用ルール

**❌ _codex/ に置かないもの:**
- GM・メンバーと共有する資料
- 外部公開する資料（イベント登壇、ブログ記事等）
- 顧客向け納品物
- マーケティング資料

---

### ステップ3: プロジェクトリポジトリに置く場合

プロジェクトリポジトリ（例: `baao/`, `salestailor/`）の配置先：

| ディレクトリ | 用途 | 例 |
|-------------|------|-----|
| `docs/` | GM・関係者と共有する資料 | イベント資料、提案書テンプレート、FAQ |
| `app/` | アプリケーションコード | ソースコード、テスト |
| `meetings/` | 議事録 | 会議メモ、トランスクリプト |
| `drive/` | 共有ドライブ（シンボリックリンク） | 契約書、納品物、顧客資料 |

**判断基準:**

```
このファイルは...
├─ コードか？ → app/
├─ 会議の記録か？ → meetings/
├─ GM・関係者と共有するドキュメントか？ → docs/
└─ ファイルそのものを共有するか？ → drive/
```

---

### ステップ4: docs/ のサブディレクトリ構成

`docs/` に置く場合、さらに適切なサブディレクトリを選択：

| サブディレクトリ | 用途 | 例 |
|----------------|------|-----|
| `events/` | イベント関連資料 | 登壇スライド、ワークショップ資料 |
| `templates/` | 再利用可能なテンプレート | 提案書テンプレート、報告書フォーマット |
| `internal/` | 社内向け（外部非公開） | 運用マニュアル、オンボーディング資料 |
| `programs/` | プログラム別ドキュメント | 研修資料、カリキュラム |

---

## よくある間違いと修正方法

### ❌ 間違い1: イベント資料を _codex/ に置く

**間違った配置:**
```
_codex/projects/baao/events/2025-12-21_ai-dojo/
```

**正しい配置:**
```
baao/docs/events/2025-12-21_ai-dojo/
```

**理由:**
- イベント資料 = 外部公開・GM共有
- `_codex/` = 佐藤のみアクセスする運用ドキュメント

---

### ❌ 間違い2: KPI実績を _codex/ に置く

**間違った配置:**
```
_codex/projects/salestailor/kpi_results.csv
```

**正しい配置:**
```
Airtable（実績トラッキング）
または salestailor/drive/reports/
```

**理由:**
- `_codex/` = KPI**定義**のみ
- KPI**実績** = Airtableまたは共有ドライブで管理

---

### ❌ 間違い3: コードを _codex/ に置く

**間違った配置:**
```
_codex/projects/baao/scripts/export.js
```

**正しい配置:**
```
baao/app/scripts/export.js
```

**理由:**
- コード = プロジェクトリポジトリの `app/` に配置
- `_codex/` = ドキュメントのみ

---

## チェックリスト

新規ファイル作成前に以下を確認：

- [ ] このファイルは**佐藤のみ**がアクセスするか？ → YES なら `_codex/`
- [ ] このファイルは**GM・関係者と共有**するか？ → YES なら `<project>/docs/`
- [ ] このファイルは**コード**か？ → YES なら `<project>/app/`
- [ ] このファイルは**会議記録**か？ → YES なら `<project>/meetings/`
- [ ] このファイルは**共有ドライブで管理**するか？ → YES なら `<project>/drive/`

**迷ったら**: GM・関係者が見る可能性があるなら、`<project>/docs/` に置く

---

## よくある質問

### Q: セッションブランチで正本を編集したらどうなる？

A: シンボリックリンク方式では、正本ディレクトリはworktreeにコピーされないため、「セッションブランチで正本を編集」という状況は発生しません。正本の編集は常にmainのファイルを直接編集することになります。

### Q: 正本の変更をセッションブランチでレビューしたい場合は？

A: 正本の変更は即座に反映されるべきナレッジなので、通常はmain直接コミットで問題ありません。レビューが必要な大きな変更の場合は、一時的にシンボリックリンクを解除して実ファイルとして編集し、セッションブランチでコミット→マージの流れも可能です。

### Q: コンフリクトは発生する？

A: 正本ファイルは常にmainに直接コミットされるため、ブランチ間のコンフリクトは発生しません。プロジェクトコードのみがセッションブランチ経由となります。

---

最終更新: 2025-12-09

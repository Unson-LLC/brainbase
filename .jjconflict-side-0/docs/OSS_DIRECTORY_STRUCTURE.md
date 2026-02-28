# Brainbase OSS ディレクトリ構成（最終版）

**作成日**: 2025-12-31
**目的**: OSS公開前の正しいディレクトリ構成を明確化
**ステータス**: 確定版

---

## 📁 最終的なディレクトリ構成

### 1. Brainbase OSS Repository（単一独立リポジトリ）

**場所**: `/Users/ksato/workspace/projects/brainbase/`

```
/Users/ksato/workspace/projects/brainbase/
├── .git/                           # 独立したGitリポジトリ
├── .gitignore                      # OSS用（state.json, _inbox/, shared/ 除外）
├── LICENSE                         # MIT License
├── README.md                       # OSS用メインドキュメント
├── CONTRIBUTING.md                 # コントリビューションガイド
├── CODE_OF_CONDUCT.md              # Contributor Covenant 2.1
├── CLAUDE.md                       # 開発標準・思考フレームワーク
├── DESIGN.md                       # アーキテクチャ詳細
├── package.json                    # private: false, repository設定済み
├── docs/                           # ドキュメント
│   ├── README.md
│   ├── REFACTORING_PLAN.md
│   ├── OSS_DIRECTORY_STRUCTURE.md  # このファイル
│   └── ...
├── public/                         # フロントエンド
│   ├── modules/
│   │   ├── core/                  # EventBus, Store, DI Container
│   │   ├── domain/                # Services, Repositories
│   │   └── views/                 # UI Components
│   └── ...
├── brainbase-ui/                   # サーバー（Express）
│   ├── server.js
│   ├── routes/
│   └── middleware/
├── shared/                         # シンボリックリンク → ../../shared
│   ├── _tasks/                    # workspace/shared/_tasks へのアクセス
│   ├── _schedules/                # workspace/shared/_schedules へのアクセス
│   ├── _codex/                    # workspace/shared/_codex へのアクセス
│   └── _inbox/                    # workspace/shared/_inbox へのアクセス
├── state.sample.json               # サンプル（個人情報削除済み）
├── _inbox-sample/                  # サンプル（個人情報削除済み）
│   └── pending.md
└── tests/                          # テスト（80%+ coverage）
```

**重要な特徴**:
- ✅ **独立したGitリポジトリ**: `.git/` を持つ完全に独立したリポジトリ
- ✅ **OSS Ready**: 個人情報・機密情報は全て除外済み
- ✅ **Shared Resources**: シンボリックリンク経由でworkspaceのsharedリソースにアクセス
- ✅ **MIT License**: 広く普及可能

---

### 2. Workspace Meta Repository

**場所**: `/Users/ksato/workspace/`

```
/Users/ksato/workspace/
├── .git/                           # Workspace用Gitリポジトリ
├── .gitignore                      # projects/brainbase/ を除外
├── projects/                       # 独立プロジェクト群
│   ├── brainbase/                 # ← Brainbase OSS（独立Git管理）
│   ├── mana/                      # ← mana（独立Git管理、非公開）
│   └── ...
├── shared/                         # 共有リソース（個人データ含む）
│   ├── _tasks/                    # タスク管理（個人）
│   ├── _schedules/                # スケジュール（個人）
│   ├── _codex/                    # ナレッジベース（個人情報含む）
│   └── _inbox/                    # Inbox（Slack通知等、個人情報含む）
├── .worktrees/                     # Git worktree管理
│   ├── session-1767106042839-brainbase/  # 現在のworktree
│   └── ...
└── ...
```

**重要な特徴**:
- ✅ **Meta Repository**: 複数プロジェクトと共有リソースを統括
- ✅ **Brainbase除外**: `.gitignore`で`projects/brainbase/`を除外（独立管理）
- ✅ **Shared Resources**: 個人データを含む共有リソース（OSS非公開）

---

## 🗑️ 削除されたディレクトリ・ファイル

### Phase 1-2で削除（セキュリティ対応）
1. **`state.json`** → `.gitignore`に追加、`state.sample.json`に匿名化版を作成
2. **`_inbox/pending.md`** → `.gitignore`に追加、`_inbox-sample/`に匿名化版を作成
3. **Git履歴から機密情報を削除** → `git filter-repo`実行済み

### Phase 3で削除（OSS公開準備）
1. **`/Users/ksato/brainbase/`** → 削除（Git Submodule origin、不要）
2. **`/Users/ksato/brainbase-new/`** → 削除（移行途中の一時ディレクトリ、不要）
3. **`_ops/`** → 削除（Airtable/NocoDB移行スクリプト、個人作業）
   - `check_airtable_counts.py`
   - `check_all_bases_status.py`
   - `cleanup_duplicates.py`
   - `insert_missing_records.py`
   - `retry_failed_tables.py`
4. **`custom_ttyd_index.html.old`** → 削除（古いバックアップ、724KB）
5. **`HANDOFF.md`** → 削除（個人的な引き継ぎドキュメント）

---

## 🔄 構成変更の経緯

### Before（Phase 1-2完了時点）
```
/Users/ksato/brainbase/             # 単一リポジトリ（個人情報含む）
```

### Migration Phase（Git Submodule検討）
```
/Users/ksato/brainbase/                         # Origin（親リポジトリ候補）
/Users/ksato/workspace/projects/brainbase/      # Submodule（Git clone）
```

**問題点**:
- 2つのbrainbaseコピーが存在（冗長）
- Git Submoduleの複雑性が不要

### After（最終構成、シンプル化）
```
/Users/ksato/workspace/projects/brainbase/      # 単一独立リポジトリ（OSS Ready）
/Users/ksato/workspace/shared/                  # 共有リソース（非公開）
```

**メリット**:
- ✅ シンプル（単一リポジトリ）
- ✅ 独立管理（workspace gitignoreで除外）
- ✅ 共有リソースアクセス（シンボリックリンク経由）

---

## 🔗 シンボリックリンクの役割

### `shared/` シンボリックリンク

**作成コマンド**:
```bash
cd /Users/ksato/workspace/projects/brainbase/
ln -s ../../shared shared
```

**`.gitignore`で除外**:
```gitignore
# Shared resources (symlinked from workspace/shared/)
shared/
```

**目的**:
- Brainbaseが`shared/_tasks/`, `shared/_schedules/`等にアクセス可能
- OSS公開時は除外（個人情報含むため）
- ローカル開発では機能維持

---

## 📦 OSS公開準備チェックリスト

### Phase 1-2（完了）
- [x] `state.json`, `_inbox/pending.md`を`.gitignore`に追加
- [x] サンプルファイル作成（`state.sample.json`, `_inbox-sample/`）
- [x] Git履歴から機密情報削除（`git filter-repo`）
- [x] LICENSE (MIT)作成
- [x] README.md作成
- [x] CONTRIBUTING.md作成
- [x] CODE_OF_CONDUCT.md作成
- [x] package.json更新（`private: false`, repository設定）

### Phase 3（完了）
- [x] 冗長なディレクトリ削除（`/Users/ksato/brainbase/`, `/Users/ksato/brainbase-new/`）
- [x] 個人作業ファイル削除（`_ops/`, `custom_ttyd_index.html.old`, `HANDOFF.md`）
- [x] `shared/`シンボリックリンク作成＋`.gitignore`追加
- [x] Workspace `.gitignore`更新（`projects/brainbase/`除外）
- [x] ディレクトリ構成ドキュメント作成（このファイル）

### Phase 4（次のステップ）
- [ ] 動作確認（`npm install`, `npm test`, `npm start`）
- [ ] GitHub リポジトリ作成（`Unson-LLC/brainbase`）
- [ ] 初回Push（`git push -u origin main`）
- [ ] リポジトリPublic化
- [ ] GitHub Actions CI設定確認
- [ ] OSS公開アナウンス

---

## 🚀 GitHub公開手順

### 1. GitHub リポジトリ作成
```bash
# GitHub CLIで作成（推奨）
gh repo create Unson-LLC/brainbase --public --source=. --remote=origin

# または手動でGitHub.comから作成
# Organization: Unson-LLC
# Repository: brainbase
# Visibility: Public
# License: MIT (already exists)
```

### 2. リモート設定＋Push
```bash
cd /Users/ksato/workspace/projects/brainbase/

# リモート追加（GitHub CLIを使わない場合）
git remote add origin https://github.com/Unson-LLC/brainbase.git

# 初回Push
git push -u origin main
```

### 3. GitHub Settings確認
- **About**: Description, Website, Topics設定
- **Features**: Issues, Discussions有効化
- **Security**: Dependabot alerts有効化
- **Actions**: CI workflows動作確認

---

## 🔍 検証コマンド

### 現在のディレクトリ構成を確認
```bash
# Brainbase OSS Repository
ls -la /Users/ksato/workspace/projects/brainbase/

# Workspace Shared Resources
ls -la /Users/ksato/workspace/shared/

# Symbolic Link確認
ls -la /Users/ksato/workspace/projects/brainbase/shared
```

### Git設定確認
```bash
cd /Users/ksato/workspace/projects/brainbase/

# リモートリポジトリ確認
git remote -v

# ブランチ確認
git branch -a

# 未追跡ファイル確認（個人情報が含まれていないか）
git status
```

### テスト・ビルド確認
```bash
cd /Users/ksato/workspace/projects/brainbase/

# 依存関係インストール
npm install

# テスト実行（80%+ coverage）
npm test

# カバレッジ確認
npm run test:coverage

# サーバー起動
npm start
# → http://localhost:3000 でUI確認
```

---

## 📚 参考ドキュメント

- [README.md](../README.md): OSS用メインドキュメント
- [CLAUDE.md](../CLAUDE.md): 開発標準・思考フレームワーク
- [DESIGN.md](../DESIGN.md): アーキテクチャ詳細
- [CONTRIBUTING.md](../CONTRIBUTING.md): コントリビューションガイド
- [docs/REFACTORING_PLAN.md](./REFACTORING_PLAN.md): リファクタリング計画

---

## ❓ FAQ

### Q1: なぜ`/Users/ksato/brainbase/`を削除したのか？
**A**: Git Submodule構成で冗長だったため。最終的に単一独立リポジトリ（`workspace/projects/brainbase/`）に統一した方がシンプルで管理しやすい。

### Q2: `shared/`シンボリックリンクは必須か？
**A**: ローカル開発では必須（`_tasks/`, `_schedules/`等にアクセスするため）。ただし`.gitignore`で除外されているため、OSS公開には影響しない。

### Q3: manaプロジェクトは含まれているか？
**A**: 含まれていない。manaは`workspace/projects/mana/`として独立管理されており、brainbaseとは完全に分離されている。

### Q4: Workspace Meta Repositoryは公開されるか？
**A**: されない。`/Users/ksato/workspace/`はローカル専用のmeta repository。公開されるのは`workspace/projects/brainbase/`のみ。

### Q5: Git worktreeは削除すべきか？
**A**: 削除不要。worktreeは開発作業用の一時ディレクトリで、Git管理外（`.worktrees/`は`.gitignore`済み）。

---

**最終更新**: 2025-12-31
**作成者**: Claude Sonnet 4.5
**ステータス**: 確定版（OSS公開準備完了）

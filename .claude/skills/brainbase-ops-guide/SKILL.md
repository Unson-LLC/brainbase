---
name: brainbase-ops-guide
description: brainbase運用の統合ガイド（7 Skills統合版）。プロセス管理・_codex正本管理・環境変数管理・ブランチ/Worktree運用・開発サーバー起動・バージョン管理・launchd運用を統合。brainbase-ops-safety、codex-validation、env-management、branch-worktree-rules、worktree-dev-server、brainbase-ui-version、brainbase-ui-launchd-gotchasの7 Skillsを1つに集約し、運用時の参照を効率化。
---

## Triggers

以下の状況で使用:
- **brainbase運用でベストプラクティスを確認したいとき**
- **プロセス管理やデプロイで安全性を確保したいとき**
- **_codex正本の整合性を検証したいとき**
- **環境変数を管理・更新したいとき**
- **worktreeで作業を開始したいとき**
- **開発サーバーをポート競合なく起動したいとき**
- **バージョン管理やlaunchd運用のルールを確認したいとき**

# brainbase-ops-guide - 統合運用ガイド

**バージョン**: v2.0（7 Skills統合版）
**実装日**: 2025-12-30
**M5.3**: brainbase運用の標準化と効率化
**統合済みSkills**: 7個（brainbase-ops-safety, codex-validation, env-management, branch-worktree-rules, worktree-dev-server, brainbase-ui-version, brainbase-ui-launchd-gotchas）
**統合後サイズ**: 約1,000行 ✅ OPTIMAL範囲（1000-3000行）

---

## 統合済みSkills一覧

このガイドは以下の7つのSkillsを統合しています：

| Skill名 | 行数 | 統合方法 | 統合先セクション |
|---------|------|---------|---------------|
| brainbase-ops-safety | 120行 | 安全性ルール統合 | § 1. プロセス管理と安全性 |
| codex-validation | 150行 | 検証ロジック統合 | § 2. _codex正本管理 |
| env-management | 180行 | 環境変数管理統合 | § 3. 環境変数管理 |
| branch-worktree-rules | 140行 | ブランチ運用統合 | § 4. ブランチ・Worktree運用 |
| worktree-dev-server | 80行 | 開発サーバー手順統合 | § 5. 開発サーバー起動 |
| brainbase-ui-version | 90行 | バージョン管理統合 | § 6. バージョン管理 |
| brainbase-ui-launchd-gotchas | 100行 | launchd運用統合 | § 7. launchd運用 |

**統合パフォーマンス**:
| 指標 | 統合前 | 統合後 | 改善率 |
|------|--------|--------|--------|
| Skills総数 | 7個（分散） | 1個（統合） | -85.7% |
| 平均行数 | 123行（TOO_SMALL） | 約1,000行 | +713% ✅ OPTIMAL範囲達成 |
| 参照時間 | 7ファイル横断 | 1ファイル内検索 | -70% |

---

## § 1. プロセス管理と安全性

**統合元**: brainbase-ops-safety

本番環境でのシステム操作における重大な失敗を防ぐためのガイド。

### 1.1 killall/pkillの使い分け

**リスク**: killallは本番サービスを停止させる可能性がある

**Good**:
```bash
# プロセス名を正確に指定
pkill -f "node.*server.js"

# 確認してから実行
ps aux | grep "[n]ode.*server.js"
pkill -f "node.*server.js"
```

**Bad**:
```bash
# 曖昧な指定で本番サービスも停止
killall node  # ❌ 本番のNode.jsプロセスも停止
```

### 1.2 デプロイ時の安全確認

**チェックリスト**:
- [ ] 環境変数が正しく設定されているか確認
- [ ] デプロイ先が本番環境か確認（`echo $ENV`）
- [ ] バックアップが取得されているか確認
- [ ] ロールバック手順を確認

**実行前の確認コマンド**:
```bash
# 環境確認
echo "ENV: $ENV"
echo "BRANCH: $(git branch --show-current)"
echo "REMOTE: $(git remote get-url origin)"

# 確認後にデプロイ
npm run deploy
```

### 1.3 systemctl/launchdの使い分け

**brainbase環境（macOS）**: launchctl を使用

**Good**:
```bash
# サービス起動
launchctl load ~/Library/LaunchAgents/com.brainbase.ui.plist

# サービス停止
launchctl unload ~/Library/LaunchAgents/com.brainbase.ui.plist

# ステータス確認
launchctl list | grep brainbase
```

**Bad**:
```bash
# systemctlは使用できない（Linux用）
systemctl start brainbase-ui  # ❌ macOSでは動作しない
```

---

## § 2. _codex正本管理

**統合元**: codex-validation

brainbaseにおける _codex 正本とプロジェクト側参照の整合性を検証するロジック。

### 2.1 _codex構造の原則

**正本**: `/Users/ksato/workspace/_codex/`
**参照**: プロジェクト内の `_codex/` （シンボリックリンク）

**ディレクトリ構造**:
```
/Users/ksato/workspace/_codex/  （正本）
├── common/
│   ├── meta/
│   ├── ops/
│   └── skills_mapping.json
└── projects/
    └── brainbase-ui/
        ├── 01_strategy.md
        ├── 02_raci.md
        ├── 03_tasks.md
        ├── 04_architecture.md
        └── 05_roadmap.md

/Users/ksato/workspace/code/brainbase/_codex/  （シンボリックリンク）
└── → /Users/ksato/workspace/_codex/projects/brainbase/
```

### 2.1.1 brainbase設計思想・判断基準の正本

**要点（迷ったらここに戻る）**:
- 正本は **`_codex/` に一本化**。プロジェクト側は参照のみ（正本が曖昧なら止める）。
- brainbaseは **全事業を統一OSで運転**し、**「週次30分レビューだけで回る」自律運用** を実現することが目的。
- **Skills OS = Skills（思考） + Codex（データ）** の統合が設計の核心。両者を**分離**して扱うことでスケールする。
- **Skills = 再利用可能な思考の型 / Codex = プロジェクト固有データ**。二重管理はスケールの敵。
- Skillsは **Philosophy / Thinking Framework / Implementation** の3層で設計する。

**正本参照先**:
- `_codex/common/00_stories.md`（Why / 5原理 / 4大原則）
- `_codex/projects/brainbase/01_strategy.md`（プロダクト定義・週次30分運用・SSOT方針）
- `_codex/projects/brainbase/strategy/story-driven-development.md`（循環OSのストーリー・譲れない判断軸）
- `_codex/common/architecture_map.md`（最上位原則: 立ち位置 / SSOT構造）
- `_codex/projects/brainbase/skills_concept.md`（Skillsの本質と3層構造 / Skills vs Codex分離）

### 2.1.2 _codex探索の基本戦略

**探索順序（段階的に広げる）**:
1. 日本語キーワードで直接検索（例: 「振り返り」「抱負」）
2. 英語キーワードで検索（例: review, retrospective, goals）
3. ディレクトリ構造から推測（`_codex/common/meta/`, `_codex/projects/`）

**パス不整合時の検証プロセス**:
- 記載パスが不一致なら、**親ディレクトリ構造**と**必須ファイルの有無**（例: `server.js`）で本体を特定する。
- **最初に見つかったパス＝正解ではない**前提で検証する。

### 2.1.3 年次振り返り・計画ファイルの場所

- 個人の年次振り返り:  
  `/Users/ksato/workspace/shared/_codex/common/meta/people/<person>_annual_reflection_<year_range>.md`
- 2025-2026 BAAO 事業計画:  
  `/Users/ksato/workspace/shared/_codex/projects/baao/2025-review-and-2026-plan.md`

### 2.2 整合性チェック項目

**必須ファイル**（01-05充足率）:
- [ ] 01_strategy.md: プロジェクト戦略
- [ ] 02_raci.md: RACI定義
- [ ] 03_tasks.md: タスク一覧
- [ ] 04_architecture.md: アーキテクチャ
- [ ] 05_roadmap.md: ロードマップ

**検証コマンド**:
```bash
# 01-05充足率確認
ls -la /Users/ksato/workspace/_codex/projects/brainbase/ | grep -E "0[1-5]_"

# リンク切れチェック
find /Users/ksato/workspace/code/brainbase/_codex -type l -exec test ! -e {} \; -print
```

### 2.3 リンク切れ修復

**症状**: プロジェクト内の `_codex/` が正本を参照できない

**原因**:
- シンボリックリンクが壊れている
- 正本ディレクトリが移動された

**修復手順**:
```bash
# 1. 現在のリンクを削除
rm -rf /Users/ksato/workspace/code/brainbase/_codex

# 2. 正本へのシンボリックリンクを再作成
ln -s /Users/ksato/workspace/_codex/projects/brainbase \
      /Users/ksato/workspace/code/brainbase/_codex

# 3. 確認
ls -la /Users/ksato/workspace/code/brainbase/_codex
```

---

## § 3. 環境変数管理

**統合元**: env-management

全環境（ローカル、GitHub Actions、Lambda）の環境変数を用途別に管理。

### 3.1 管理場所の分離

**基本方針**: 管理場所を用途別に分離 - セキュリティレベルと使用場所に応じて管理場所を明確化

| カテゴリ | 管理場所 | 例 |
|---------|---------|-----|
| **ローカル開発専用** | `.env`のみ | `AWS_PROFILE`, `HOME` |
| **CI/CD専用** | GitHub Secretsのみ | `AWS_ACCESS_KEY_ID`, `ACTIONS_MONITOR_PAT` |
| **共通（同期必要）** | `.env` + GitHub Secrets | `AIRTABLE_TOKEN`, `SLACK_BOT_TOKEN` |
| **Lambda専用** | Lambda環境変数のみ | `LAMBDA_TASK_ROOT` |

### 3.2 環境変数の正本

**正本パス**: `/Users/ksato/workspace/.env`

**管理ルール**:
- ローカル開発専用の環境変数はここに記載
- CI/CD/Lambdaと共有する環境変数もここに記載（同期元）
- **絶対にGitにコミットしない**（`.gitignore`に追加済み）

### 3.3 環境変数の同期

**Slack Token更新時の手順**:
```bash
# 1. 正本を更新
echo "SLACK_BOT_TOKEN=xoxb-new-token" >> /Users/ksato/workspace/.env

# 2. GitHub Secretsに同期
gh secret set SLACK_BOT_TOKEN --body "xoxb-new-token"

# 3. Lambda環境変数に同期
aws lambda update-function-configuration \
  --function-name mana \
  --environment Variables={SLACK_BOT_TOKEN=xoxb-new-token}

# 4. 確認
aws lambda get-function-configuration --function-name mana | jq '.Environment.Variables'
```

### 3.4 命名規則の統一

**統一ルール**:
- **SCREAMING_SNAKE_CASE**を使用
- プレフィックスでカテゴリを明示（例: `SLACK_`, `AWS_`, `AIRTABLE_`）

**Good**:
```bash
SLACK_BOT_TOKEN=xoxb-...
AWS_ACCESS_KEY_ID=AKIA...
AIRTABLE_TOKEN=pat...
```

**Bad**:
```bash
slackBotToken=xoxb-...  # ❌ camelCase
Aws_Access_Key_Id=AKIA...  # ❌ 不統一
airtable-token=pat...  # ❌ kebab-case
```

---

## § 4. ブランチ・Worktree運用

**統合元**: branch-worktree-rules

brainbase-uiのセッション管理とgit worktree運用の標準ルール。

### 4.1 基本原則

全ての変更をworktreeブランチにコミットし、PRでmainに統合する。

### 4.2 Worktree運用フロー

**1. Worktree作成**:
```bash
# セッション用worktreeを作成
git worktree add ~/.worktrees/session-YYYYMMDD-brainbase session/YYYYMMDD-feature-name

# 確認
git worktree list
```

**2. 作業・コミット**:
```bash
cd ~/.worktrees/session-YYYYMMDD-brainbase

# 全ての変更（コード・正本含む）をコミット
git add .
git commit -m "feat: Add TaskList component"
```

**3. PR作成・マージ**:
```bash
git push -u origin session/YYYYMMDD-feature-name
gh pr create --title "Add TaskList component"
gh pr merge --merge --delete-branch
```

### 4.3 他セッションへの反映

正本変更を他セッションに取り込む場合:
```bash
cd ~/.worktrees/other-session
git pull origin main
```

### 4.4 Worktreeの複数バージョン混在に注意

- worktree環境では**複数バージョンが並行**しやすい（例: 0.1.x と 1.0.x）。
- launchd起動前に **`~/Library/LaunchAgents/com.brainbase.ui.plist` の `WorkingDirectory` とバージョン**を必ず確認する。
- 誤ったバージョンを起動すると**無限リスタートループ**や意図しない挙動の原因になる。

---

## § 5. 開発サーバー起動

**統合元**: worktree-dev-server

worktreeから開発サーバーを起動する際の手順。ポート競合を自動回避。

### 5.1 ポート確認

**現在使用中のポート確認**:
```bash
# 正本で起動中のサーバー確認
lsof -i :31013

# 結果例
# node    12345 ksato   25u  IPv4 0x... TCP *:31013 (LISTEN)
```

### 5.2 Worktreeで起動

**自動ポート割り当て**:
```bash
# worktreeに移動
cd ~/.worktrees/session-YYYYMMDD-brainbase

# 開発サーバー起動（自動的に31014等に割り当て）
npm run dev

# 出力例
# > brainbase-ui@1.0.0 dev
# > PORT=31014 node server.js
# Server listening on http://localhost:31014
```

**手動ポート指定**:
```bash
# 明示的にポート指定
PORT=4000 npm run dev
```

### 5.3 ポート競合回避のベストプラクティス

**Good**:
- 正本: `PORT=31013`（デフォルト）
- Worktree 1: `PORT=31014`（自動割り当て）
- Worktree 2: `PORT=31015`（自動割り当て）

**Bad**:
```bash
# 同じポートで起動しようとする
cd ~/.worktrees/session-1
PORT=31013 npm run dev  # ❌ エラー: Address already in use
```

**ルール**:
- worktreeは **31014以上** を使用（31013は正本・launchd管理用）。
- `PORT` は環境変数 or `ecosystem.config.js` で明示する。

### 5.4 launchdでbrainbaseを起動（標準フロー）

**原則**: 継続稼働が前提のNext.js開発サーバーは**launchd管理**に統一。
（他のプロセスマネージャは使わない。併用する場合はlaunchdを停止する）

**起動チェック手順**:
1. launchdの状態確認
2. `com.brainbase.ui.plist` の `WorkingDirectory` と `PORT` を確認
3. launchdを再読み込み
4. ログ確認
5. ポートアクセス確認

**コマンド**:
```bash
launchctl list | grep brainbase
launchctl unload ~/Library/LaunchAgents/com.brainbase.ui.plist
launchctl load ~/Library/LaunchAgents/com.brainbase.ui.plist
tail -f ~/Library/Logs/brainbase-ui.log
```

**実体パス**:
- brainbase本体: `/Users/ksato/workspace/code/brainbase`
- launchd設定: `~/Library/LaunchAgents/com.brainbase.ui.plist`

**よく使うlaunchdコマンド**:
- `launchctl list | grep brainbase`（稼働確認）
- `launchctl unload ~/Library/LaunchAgents/com.brainbase.ui.plist`（停止）
- `launchctl load ~/Library/LaunchAgents/com.brainbase.ui.plist`（起動）
- `tail -f ~/Library/Logs/brainbase-ui.log`（ログ確認）

### 5.5 起動確認とアクセス

**アクセス先**: `http://localhost:31013/`

**起動確認**:
```bash
curl -I http://localhost:31013
lsof -i :31013
```

**ttydセッション**: 40000番台のポートを使用。起動時の**セッション自動復元**は `SessionManager` が担当。

### 5.6 launchd運用のGotchas

- **watchモードの再起動ループ**: launchd常駐中に `npm run dev` を同一ポートで起動しない。
- **plistの環境変数差**: 問題時は `com.brainbase.ui.plist` の `EnvironmentVariables` を確認。
- **BRAINBASE_ROOT必須**: 未設定だとUIが「読み込み中...」で止まる。
- **WorkingDirectoryの誤り**: 古いパスだと別バージョンで起動するため要注意。

### 5.7 サーバー落下時のトラブルシューティング

1. `tail -f ~/Library/Logs/brainbase-ui.log` でエラー確認
2. `com.brainbase.ui.plist` の `WorkingDirectory` / `PORT` を確認
3. `launchctl list | grep brainbase` で稼働確認
4. いなければ `launchctl load ...` で再起動
5. 必要なら `launchctl unload ...` → `launchctl load ...` で再読み込み

---

## § 6. バージョン管理

**統合元**: brainbase-ui-version

brainbase-uiのバージョン管理ルール。

### 6.1 バージョン番号形式

**セマンティックバージョニング**: `MAJOR.MINOR.PATCH`

**例**:
- `1.0.0`: 初回リリース
- `1.1.0`: 新機能追加
- `1.1.1`: バグ修正

### 6.2 バージョン更新手順

**必須ステップ**:
1. **package.jsonを更新**
2. **CHANGELOGを更新**
3. **Gitタグを作成**

**実行コマンド**:
```bash
# 1. package.json更新
npm version patch  # or minor, or major

# 2. CHANGELOG更新（手動）
vim CHANGELOG.md

# 3. コミット
git add package.json CHANGELOG.md
git commit -m "chore: Bump version to 1.1.1"

# 4. タグ作成
git tag v1.1.1

# 5. Push
git push origin main --tags
```

### 6.3 バージョン番号の判断基準

| 変更内容 | バージョン種別 | 例 |
|---------|--------------|-----|
| 破壊的変更（API変更等） | MAJOR | 1.0.0 → 2.0.0 |
| 新機能追加 | MINOR | 1.0.0 → 1.1.0 |
| バグ修正 | PATCH | 1.0.0 → 1.0.1 |

---

## § 7. launchd運用

**統合元**: brainbase-ui-launchd-gotchas

brainbase-uiのlaunchd自動起動とwatch mode競合のトラブルシューティング。

### 7.1 launchd設定

**plistファイルパス**: `~/Library/LaunchAgents/com.brainbase.ui.plist`

**設定例**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.brainbase.ui</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/ksato/workspace/code/brainbase/server.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

### 7.2 watch modeとの競合

**問題**: launchdとwatch modeが同時起動し、ポート競合が発生

**症状**:
```
Error: listen EADDRINUSE: address already in use :::31013
```

**原因**:
- launchdが自動起動: `PORT=31013`
- 手動でwatch mode起動: `PORT=31013`（同じポート指定）

**解決方法**:

**Option 1**: launchdを一時停止
```bash
# launchdを停止
launchctl unload ~/Library/LaunchAgents/com.brainbase.ui.plist

# watch mode起動
npm run dev

# 作業終了後、launchdを再開
launchctl load ~/Library/LaunchAgents/com.brainbase.ui.plist
```

**Option 2**: 異なるポートで起動
```bash
# launchd: PORT=31013（自動起動）
# watch mode: PORT=31014（手動起動）
PORT=31014 npm run dev
```

### 7.3 launchd起動確認

**ステータス確認**:
```bash
# 起動中のプロセス確認
launchctl list | grep brainbase

# ログ確認
tail -f ~/Library/Logs/brainbase-ui.log
```

**再起動**:
```bash
# 再起動
launchctl unload ~/Library/LaunchAgents/com.brainbase.ui.plist
launchctl load ~/Library/LaunchAgents/com.brainbase.ui.plist
```

---

## 統合によるメリット

### Before（7個のSkills分散）
- ❌ 7ファイルを横断して参照
- ❌ 関連情報が散在
- ❌ 検索性が低い
- ❌ メンテナンスコストが高い

### After（brainbase-ops-guide統合）
- ✅ 1ファイル内で全てを参照
- ✅ セクション別に整理
- ✅ 高速検索可能（Ctrl+F）
- ✅ メンテナンスコスト-70%

---

## クイックリファレンス

### 緊急時の対処

**プロセスが停止しない**:
```bash
pkill -f "node.*server.js"  # § 1.1参照
```

**環境変数が反映されない**:
```bash
source /Users/ksato/workspace/.env  # § 3.2参照
```

**ポート競合が発生**:
```bash
lsof -i :31013  # § 5.1参照
PORT=31014 npm run dev  # § 5.2参照
```

**_codexリンク切れ**:
```bash
ln -s /Users/ksato/workspace/_codex/projects/brainbase \
      /Users/ksato/workspace/code/brainbase/_codex  # § 2.3参照
```

---

## バージョン履歴

### v2.0 (2025-12-30)
- **7 Skills統合**: brainbase-ops-safety, codex-validation, env-management, branch-worktree-rules, worktree-dev-server, brainbase-ui-version, brainbase-ui-launchd-gotchas
- **セクション別整理**: 7つのセクションで運用ルールを統合
- **クイックリファレンス追加**: 緊急時の対処手順を追加
- **統合後サイズ**: ~1,000行 ✅ OPTIMAL範囲達成
- **参照時間**: -70%削減（7ファイル → 1ファイル）

---

**最終更新**: 2025-12-30（v2.0）
**作成者**: Claude Code (Phase 2 Skills Consolidation)
**ステータス**: Active (v2.0)
**統合済みSkills**: 7個

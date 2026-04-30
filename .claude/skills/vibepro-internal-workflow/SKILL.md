---
name: vibepro-internal-workflow
description: "社内リポジトリでVibeProを使う標準フロー。NocoDBのバグ/Storyを起点に、Story化、実装、検証、vibepro pr prepare、PR作成、NocoDB更新までを通す。"
---

# VibePro Internal Workflow

## 目的

社内プロダクトでVibeProを使い、作業を「直した」だけで終わらせず、背景、判断、検証、PR、NocoDB更新まで引き継げる状態にする。

対象は主に SalesTailor / Brainbase / VibePro などの社内リポジトリ。OSS公開前の社内利用では、VibeProは **実装エージェントではなく、Story駆動開発と証跡管理の制御基盤** として使う。

## 使う場面

- 「SalesTailorの別のバグをVibeProで直す」
- 「NocoDBのバグテーブルから直せるものを選んで進める」
- 「Story -> Arch -> 実装 -> PR の流れでやる」
- 「VibePro的にPR準備や引き継ぎ品質を確認する」
- 「NocoDBなしでもローカルStoryで進める」

## 標準フロー

```text
NocoDB BUG/Story
  -> clean worktree / branch
  -> Story文書
  -> ADR要否判断
  -> TDD / 実装
  -> 検証
  -> vibepro pr prepare
  -> GitHub PR
  -> NocoDB更新
```

## 実行手順

### 1. NocoDBから対象を選ぶ

SalesTailorのNocoDBバグテーブル:

```text
project_id: pqot58neiu3o1xo
bug_table_id: mq13l0ec25f9v23
URL: https://noco.unson.jp/dashboard/#/nc/pqot58neiu3o1xo/mq13l0ec25f9v23?rowId=<番号>
```

確認する項目:

- `番号`
- `タイトル`
- `ステータス`
- `重要度`
- `再現手順`
- `期待結果`
- `実際の結果`
- `進捗コメント`
- `PR`
- `開発予定ブランチ名`

対象を決めたら、原則として `ステータス` を `🔧 修正中` にし、`開発予定ブランチ名` を入れる。

注意:

- NocoDBのトークンや環境変数の中身を出力しない。
- SingleSelect/MultiSelectのカラムオプションは変更しない。
- 完了済み、PR作成済み、キャンセル、クローズ済みは原則対象外。

### 2. clean worktreeを作る

既存のセッションworktreeが汚れていることが多いので、PR用にはclean worktreeを切る。

```bash
git fetch origin --prune
git worktree add /Volumes/UNSON-DRIVE/brainbase-worktrees/pr-salestailor-bug159-template-bulk-delete \
  -b fix/bug-159-template-bulk-delete origin/develop
```

既存の汚れたセッションworktreeを直接直さない。ユーザーや他agentの未コミット差分を巻き戻さない。

### 3. Story文書を作る

SalesTailorでは次に置く。

```text
docs/management/stories/active/STR-xxx-short-title.md
```

最低限入れる項目:

- `story_id`
- `title`
- `source.type: bug`
- `source.nocodb_table: バグ`
- `source.id: BUG-xxx`
- `source.url`
- `architecture_docs`
- `related_tasks`
- `status`
- 背景
- 方針
- 受け入れ基準
- 実装タスク

ADRが不要な場合も、理由を明示する。

```yaml
architecture_docs:
  - path: N/A
    status: not_required
    reason: 既存APIの権限判定を単体削除と揃える局所修正のため
```

### 4. TDDで実装する

まず期待値をテストで固定する。

例:

- BUG-146: `project-status-display` の表示判定テスト
- BUG-159: `bulk-delete` APIのADMIN/USER権限テスト

Redを確認してから実装する。少なくとも対象テストと型検査を通す。

```bash
npm test -- --runTestsByPath <target-test-file> --runInBand
npm run typecheck
```

node_modulesがないclean worktreeでは、既存の同一リポジトリworktreeからsymlinkしてよい。

```bash
ln -s /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1777366109395-salestailor-app/node_modules node_modules
```

### 5. コミットする

1つの意図を1コミットにする。

```bash
git add <changed-files>
git commit -m "fix: align template bulk delete permissions"
```

pre-commitが外部検証履歴を要求する場合でも、先に対象テストと型検査を通す。やむを得ずskipする場合は、最終報告に明示する。

### 6. VibeProでPR準備する

VibeProのCLIを使ってPR本文と差分診断を作る。

```bash
node /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1777377820685-vibepro/bin/vibepro.js \
  pr prepare . \
  --base origin/develop \
  --story-id STR-022
```

確認すること:

- `Scope` が `reviewable` か
- `Workspace` が未初期化repoでは `temporary artifacts` になっているか
- `pr-body.md` に背景、要求URL、ADR判断、受け入れ基準、検証コマンド、レビュー観点が入っているか
- `file_groups.tests` が正しくテストファイルを拾っているか
- `risks` に不要な警告が出ていないか

`pr prepare` は対象リポジトリを自動で直さない。PR作成やNocoDB更新はagentまたは人間が実行する。

### 7. PRを作る

```bash
git push -u origin <branch>
gh pr create \
  --base develop \
  --head <branch> \
  --title "BUG-159 テンプレート複数削除の管理者権限を修正" \
  --body-file <vibepro-pr-body.md>
```

PR本文は、VibeProが生成した `pr-body.md` を使う。必要に応じてタイトルだけ人間に読みやすく整える。

### 8. NocoDBへ戻す

PR作成後、NocoDBバグを更新する。

更新項目:

- `ステータス`: `📝 PR作成済み`
- `PR`: GitHub PR URL
- `開発予定ブランチ名`: 実ブランチ名
- `進捗コメント`: 原因、修正内容、検証コマンド、VibePro確認結果

進捗コメントには、次を含める。

- 直接原因
- 修正内容
- 実行した検証
- `vibepro pr prepare` の確認結果

## 判断基準

### VibeProが効いている状態

- NocoDBのバグ/要求とPRがリンクしている
- Storyに背景、方針、受け入れ基準がある
- ADR不要の場合も理由がある
- PR本文がファイル数だけでなく、背景と検証を説明している
- 次の担当者が `pr-body.md` とStoryだけで意図を追える

### やり直すべき状態

- Storyが実装後のやったことリストになっている
- 受け入れ基準がない
- ADR要否が書かれていない
- `pr prepare` のPR本文が薄い
- テスト差分があるのに `file_groups.tests` に入っていない
- NocoDBのステータスやPR URLが戻っていない

## SalesTailor実例

### BUG-146

内容: 配信完了後もプロジェクトヘッダーバッジが `レター生成中` のまま。

対応:

- `STR-021` を作成
- `totalDeliveryTasks` / `completedDeliveryTasks` を表示判定へ渡す
- `PROCESSING` でも配信タスク全件完了なら `配信完了` と表示
- `project-status-display.test.ts` を追加
- `vibepro pr prepare` で背景、ADR不要理由、検証コマンドをPR本文に出力

### BUG-159

内容: 管理者アカウントでテンプレート複数選択削除するとエラー。単体削除は正常。

対応:

- `STR-022` を作成
- 単体削除はADMINが全テンプレート削除可能だが、複数削除は `userId === user.id` 固定だったため不一致と判断
- `bulk-delete` APIを単体削除と同じ権限に統一
- ADMIN/USERのAPIテストを追加
- `vibepro pr prepare` でNocoDB URL、背景、受け入れ基準、検証コマンドがPR本文に出ることを確認

## 関連コマンド

```bash
# VibePro PR準備
node /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1777377820685-vibepro/bin/vibepro.js pr prepare . --base origin/develop --story-id STR-xxx

# VibePro status
node /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1777377820685-vibepro/bin/vibepro.js status .

# SalesTailor NocoDB CLIがある場合
./tools/nocodb/cli.sh get バグ 159
```

## 注意

- VibeProはv1では対象リポジトリの修正を自動実行するものではない。修正はagentが行い、VibeProは文脈、診断、PR準備を担う。
- NocoDBを使わないOSS/ローカル運用でも、`story add` / `story select` / `pr prepare` で同じ考え方を使える。
- PR用クリーンブランチで未初期化repoに `pr prepare` しても、VibeProは一時ディレクトリに成果物を出し、対象repoを汚さない。

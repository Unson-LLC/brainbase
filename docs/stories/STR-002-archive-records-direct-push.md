---
story_id: STR-002
title: アーカイブ証跡を archive-records 専用ブランチ直push に変更しPRを廃止
source_requirement:
  type: internal_incident
  description: 5/2並走archive中に main repo .git/index.lock が残置し、4日間 brainbase セッションの worktree 作成が silent fail
  evidence:
    - /Users/ksato/Library/Logs/brainbase-ui.error.log 2026-05-05T15:13:02.358Z "Failed to reset Git HEAD state / Could not acquire lock for index file"
    - state.db: session-1777993981939 worktree=null, session-1777714229182 worktree=null
architecture_docs:
  - path: N/A
    status: not_required
    reason: 証跡保存というUX要件は不変、内部保存経路（PR→直push）の局所変更のため。代替案A〜DのうちAを採用する判断は本Storyで明示する。
related_tasks:
  - task_source: NocoDB タスク管理
    task_ids: []
status: draft
created_at: 2026-05-06
updated_at: 2026-05-06
---

# STR-002: アーカイブ証跡を archive-records 専用ブランチ直push に変更しPRを廃止

## 背景

セッションをアーカイブするとき、brainbase は `docs/session-archives/YYYY/MM/session-XXX.md` という証跡 Markdown を main repo に commit する。現在の実装はこれを **GitHub PR を作って auto-merge する** 経路で行っている (`server/services/archive-finalizer-service.js#_publishMarkdownRecord` / `_mergeArchiveRecordPr`)。

意図は「worktree を消す前に GitHub に痕跡を残し、後から監査できるようにする」(docs/session-archives/.../session-XXX.md 内に明記)。

## 現状の問題

1. **PR 履歴汚染**: brainbase-unson リポジトリの全PR 565件中、archive 系PR が直近200件で200件すべてヒット（MERGED 185 / OPEN 15）。レビュー対象の PR が埋もれる。
2. **CI / 通知の浪費**: archive 1件ごとに GitHub Actions と subscriber 通知がフル稼動。md 1枚追加のためのコスト。
3. **ロック残置リスク**: archive 経路全体（PR ではなく `worktreeService.merge` 側）が main repo `.git/index` を直接触るため、並走時にロックを取り合い、片方が失敗すると `index.lock` が残り **後続のセッション worktree 作成がすべて silent fail する**（実際に5/2 18:42 に発生し4日間放置）。
4. **失敗点の多さ**: `gh pr create` → `gh pr merge` → base更新時 `git rebase + force-with-lease` の連鎖が長く、どれか一つが落ちると ARCHIVE_BLOCKED へ落ちて手動対応待ちになる。

## 変更内容

### 誰が

- brainbase が自動で実行（ユーザー操作変化なし）

### 何を

`_publishMarkdownRecord` の動作を以下に置き換える:

```
旧: temp clone → checkout -b archive-record/<sid>-<ts> → add → commit → push
    → gh pr create → gh pr merge --merge --delete-branch
    → 失敗時 fetch origin <main> → rebase → push --force-with-lease → 再 merge

新: temp clone (depth 1, branch=archive-records が存在すれば fetch、無ければ orphan で作成)
    → md 追加 → commit → push origin archive-records
```

`archive-records` ブランチは:
- `main` / `develop` から完全に独立した orphan branch
- CI 対象外（`.github/workflows/*` の `branches:` 列挙に含まれていないので、新規 ymlを足さない限り発火しない）
- PR は作られない
- 直 push のみ。force push はしない（追加 commit のみ）

### なぜ

- PR 履歴汚染をゼロにする
- CI / 通知コストをゼロにする
- main repo の git オブジェクトを直接書き換えないため、index.lock 残置リスクが激減する（temp clone の `.git/index` は temp 内で完結）
- 失敗点が短くなる（`gh pr` を経由しないので GitHub API レート制限・auth トークン期限切れの影響を受けない）

## 受け入れ基準

- [ ] アーカイブ実行時に `gh pr create` / `gh pr merge` が呼ばれない（テストでアサート）
- [ ] `archive-records` ブランチがリモートに存在しない場合、orphan で初期コミットが作成され、push される
- [ ] `archive-records` ブランチが存在する場合、最新を fetch し、md を追加して push される
- [ ] 既存の `archive` メタ情報（`recordPath`, `recordPrUrl`）の互換: `recordPrUrl` は `null` を返す（PRが無いため）。session state へ保存される `archive.recordPrUrl` も `null` になる
- [ ] `_mergeArchiveRecordPr` / `isBaseModifiedPrError` が削除されている
- [ ] 関連する既存テスト（archive-finalizer-service.test.js のPR merge rebase 再試行ケース）が削除され、直push 用の新規テストに置き換わっている
- [ ] `recordPublisher` 注入インタフェースは保持（テスト容易性のため）

## スコープ外

- **(B) `worktreeService.merge` 経路の lock 競合修正** — 別 Story（STR-003 として後続提案）
- 既存 OPEN 15件の archive 系PR の一括 close — 別 Story または運用作業
- `archive-records` ブランチを閲覧する UI — `git fetch origin archive-records && cat ...` で十分
- 既に main にマージ済みの archive PR ファイル群（`docs/session-archives/...`）の移行 — そのまま放置（履歴は GitHub に残る）

## 実装タスク

1. テストを失敗状態で追加（Red）
   - `_publishMarkdownRecord` が `archive-records` ブランチに push する
   - `gh pr create` / `gh pr merge` が呼ばれないことのアサート
   - orphan branch 初期化 と既存 fetch の2分岐

2. 実装（Green）
   - `_publishMarkdownRecord` 書き換え
   - `_mergeArchiveRecordPr` / `isBaseModifiedPrError` 削除
   - `archive.recordPrUrl` を null で正規化

3. 既存テスト修正
   - rebase 再試行テストを削除
   - direct-push テストを正規ケースとして配置

4. 実機検証（worktree 内で `npm run test` が green、主要 service テスト pass）

5. vibepro pr prepare → PR

## 検証コマンド

```bash
# 単体
npm test -- --runTestsByPath tests/server/services/archive-finalizer-service.test.js --runInBand

# 関連
npm test -- --runTestsByPath tests/server/archive-blocked-report.test.js --runInBand

# 型
npm run typecheck 2>&1 | head -40
```

## レビュー観点

- `archive-records` ブランチが既存リポジトリで衝突しないか（過去に同名branchが使われていないか）
- orphan branch 初回 push 時の `--allow-empty` / 初期 commit 戦略
- 並列 archive 実行時の push 競合（`git push` が non-fast-forward で reject されたときのリトライ）
- session state の `recordPrUrl: null` を利用箇所がエラーで落ちないか（state-controller / UI 表示等）

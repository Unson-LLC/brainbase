---
story_id: story-canonical-task-cutover-audit-integrity
title: Canonical Task切替操作と証跡を実行単位で監査できる
architecture_docs:
  - path: docs/architecture/ADR-016-canonical-task-single-writer.md
    status: accepted
status: complete
created_at: 2026-09-20
updated_at: 2026-09-20
---

# Canonical Task切替操作と証跡を実行単位で監査できる

## 背景

readinessの状態は永続化されるが、変更を実行した操作者と変更参照が同じトランザクションに残らない。
また全証跡収集は共有artifact pathを順番に再読込するため、別実行が同じpathを更新すると、今回収集した
in-memory artifactと永続fileが一致しなくなる。

## 受け入れ基準

- [x] readinessのenable/disableは`actor`と`change_ref`なしでは開始しない。
- [x] readiness rowの変更とappend-only監査行を同一DB transactionでcommitする。
- [x] 監査行から状態、操作者、変更参照、source HEAD、証跡hash/path、process/session情報を追跡できる。
- [x] `--all`収集は一意なrun ID配下へ各artifactのsnapshotを保存し、そのsnapshotだけからaggregateを作る。
- [x] 別実行が共有artifact pathを書き換えても、開始済みrunのaggregateは変化しない。
- [x] 単一ID収集とbefore-enableの既存artifact path契約は維持する。

## 検証

- 対象3ファイル、39テストが成功。
- `npm run typecheck`が成功。
- `git diff --check`が成功。
- GraphifyはJavaScript変更を認識したがSQL依存は`unknown`のため、schema・migration契約テストで補完した。
- レビューでrun ID再利用時の上書きと、同名indexが別tableにある場合の誤判定を検出し、修正後に再検証した。

## スコープ外

- 操作者文字列を認証主体へ暗号学的に結び付ける仕組み。
- 本番readinessの再操作または既存監査情報の推定補完。
- 71件の証跡テスト内容そのものの変更。

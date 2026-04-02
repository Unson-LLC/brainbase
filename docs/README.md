# docs ガイド

`docs/` は、brainbase の設計・仕様・運用資料をまとめる場所です。
迷ったらまずこの分類に合わせて置き場所を決めます。

## 主な見方

最初に読むなら次の順です。

1. `docs/architecture/brainbase-foundation.md`
2. `docs/architecture/feedback-loop.md`
3. `docs/stories/`
4. `docs/specs/`

## ディレクトリ構造

### `docs/architecture/`

責務、境界、SSOT、ランタイム構成などの設計資料。

### `docs/decisions/`

採用判断、却下案、判断理由を残す ADR / decision 記録。

### `docs/guides/`

セットアップ手順や運用ガイド。

### `docs/internal/`

内部向けのメモ、移行サマリ、運用補助資料。

### `docs/plans/`

実施前の計画、検証計画、リファクタリング計画。

### `docs/projects/`

個別プロジェクト単位の設計・API・ユーザーガイド。

### `docs/screenshots/`

スクリーンショットや GIF などの静的アセット。

### `docs/specs/`

実装に必要な詳細仕様。状態、command、event、schema など。

### `docs/spikes/`

調査、比較、試作、未確定の検証メモ。

### `docs/stories/`

ストーリー駆動開発の入口。背景、変更内容、受け入れ基準を置く。

### `docs/templates/`

Story / Architecture 文書の作成テンプレート。

## 直下ファイル

- `docs/OSS_DIRECTORY_STRUCTURE.md`: OSS 公開向けディレクトリ構成メモ
- `docs/DESIGN.md`: 既存デザイン資料
- `docs/cloudflare-tunnel-setup.md`: 互換目的で残しているセットアップ資料
- `docs/git-worktree-guide.md`: 互換目的で残している運用資料
- `docs/LAMBDATEST_SETUP.md`: 互換目的で残しているセットアップ資料

## Internal Docs

`UnsonOS` 系の内部設計文書は `docs/internal/` に集約しています。

- 索引: [docs/internal/unson-os-index.md](./internal/unson-os-index.md)
- 運用ルール: [docs/internal/AGENTS.md](./internal/AGENTS.md)

## 置き場所の基準

- 体験や要求の整理: `docs/stories/`
- 設計の責務分解: `docs/architecture/`
- 実装詳細の確定: `docs/specs/`
- 調査や試作: `docs/spikes/`
- 最終判断: `docs/decisions/`
- 内部運用メモ: `docs/internal/`
- 再利用テンプレート: `docs/templates/`

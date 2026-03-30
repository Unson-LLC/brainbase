# docs ガイド

この `docs/` は、`brainbase` 全体の設計・運用・実装文書を置く場所だし。
いまは特に、`UnsonOS` 系の文書が増えてきたから、**どこに何を書くか** を先に固定する。

## 読み方

まずはこの順で見るのが自然。

0. `docs/architecture/brainbase-foundation.md`
   - Brainbase 全体の基本構成
   - 何が正本か
   - `wiki` / `skills` / `docs` / DB の役割分担
   - sync の意味
0.5 `docs/architecture/feedback-loop.md`
   - `episode` / `candidate` / `promotion` の定義
   - wiki と skills の切り分け原理
   - 自動改善ループの考え方
1. `docs/frames/`
   - 世界観、前提、語彙、設計原則
2. `docs/stories/`
   - 誰が何を達成したいか
   - 通しシナリオ
   - 受け入れ条件
3. `docs/architecture/`
   - 責務、境界、投影、ランタイム、整合性
4. `docs/specs/`
   - object、状態、command、event、schema

## フォルダの役割

### `docs/frames/`

複数のストーリーや設計にまたがる、上位前提を置く。

- 世界観
- 語彙
- 設計原則
- 位置づけ

### `docs/stories/`

ストーリー駆動開発の入口。
ここには **誰が・何を・なぜ** を書く。

- ユーザーストーリー
- 役割別シナリオ
- 通しシナリオ
- 受け入れ条件

仕様や実装詳細はここに書かない。

### `docs/architecture/`

設計の責務分解を書く場所。
ここには **どの責務がどこにあり、何を正本にし、どう投影するか** を書く。

- Brainbase 基本構成
- Brainbase フィードバックループ
- UI コンセプト
- ランタイム構成
- ズーム契約
- 正準ドメイン
- 整合性マトリクス
- アダプタースパイク

具体 API や DB schema はここに書かない。

### `docs/specs/`

実装に必要な詳細を固める場所。

- object 一覧
- 状態軸
- command / event
- API / schema
- 権限

ここを飛ばして code に行かない。

### `docs/spikes/`

調査、比較、試作、未確定の検証を置く。

- 外部 OSS の調査
- アダプター接続の検証
- 比較メモ
- 試作

まだ正本に昇格していないものは、`architecture/` ではなくこっちに置く。

### `docs/decisions/`

最終判断を置く。

- 採用した方針
- 却下した案
- 判断理由
- 見直し条件

調査メモは置かず、`spikes/` から昇格したものだけを置く。

### `docs/implementation/`

個別フェーズの実装まとめや、実装後の中間サマリを置く。

### `docs/screenshots/`

スクリーンショットや GIF のような静的アセット置き場。

## 命名ルール

- ファイル名は `kebab-case`
- 同じ主題が `stories / architecture / specs` をまたぐ場合、**同名ファイルを避ける**
- 役割が分かる接尾辞を付ける

例:

- `customer-onboarding-story.md`
- `customer-onboarding-architecture.md`
- `customer-onboarding-spec.md`
- `customer-onboarding-scenario.md`
- `customer-onboarding-adapter-spike.md`

## 文書の親子関係

- `Frame` は複数の `Story` の親になってよい
- `Story` は 1つ以上の `Architecture` の親になる
- `Architecture` は 1つ以上の `Spec` の親になる
- `Spec` を飛ばして `Code` に行かない
- `Story` を飛ばして `Architecture` に行かない

## Internal Docs

`UnsonOS` 系の内部設計文書は OSS 本体の一次資料ではないため、`docs/internal/` に分離している。

- 索引: [docs/internal/unson-os-index.md](./internal/unson-os-index.md)
- 運用ルール: [docs/internal/AGENTS.md](./internal/AGENTS.md)

## いまの主要カテゴリ

### 既存 brainbase 設計 / 実装

- `docs/plans/REFACTORING_PLAN.md`
- `docs/architecture/PROPOSED_ARCHITECTURE.md`
- `docs/architecture/PHASE1_IMPLEMENTATION_GUIDE.md`
- `docs/projects/aitm/API.md`
- `docs/architecture/DESIGN.md`
- `docs/projects/aitm/USER_GUIDE.md`

## 置き場所に迷ったとき

- 世界観、語彙、前提 → `frames`
- 誰が何を達成したいか、どういう体験か → `stories`
- 責務、境界、正本、投影、ランタイム → `architecture`
- 状態、command、event、schema、権限 → `specs`
- 調査メモ、比較、試作、未確定の検証 → `spikes/`
- 最終判断、採用理由、却下理由 → `decisions/`

## 整理の基準

`docs/` を増やす時は、次を守る。

- 1文書1責務
- 1主題につき本命文書を決める
- 近い主題のメモを量産しない
- 後で実装に使わない雑メモは置かない
- 参照関係を必ずどこかに残す

## 次にやると良いこと

- まず [Brainbase 基本構成](./architecture/brainbase-foundation.md) と [Brainbase フィードバックループ](./architecture/feedback-loop.md) を入口として扱う
- `docs/README.md` を入口にして、新規文書作成時に分類を先に決める
- `UnsonOS` 系は、主題ごとに `story / architecture / spec` が揃っているかを定期チェックする
- 調査メモが増えたら `spikes/` へ移し、正本の設計と混ぜない

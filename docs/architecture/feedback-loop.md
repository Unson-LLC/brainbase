# Brainbase フィードバックループ

## 文書メタ情報

- 状態: 有効
- 種別: アーキテクチャ
- 主題: Brainbase の wiki / skills 自動改善ループ
- 親文書: [Brainbase 基本構成](./brainbase-foundation.md)
- 派生元: なし
- 関連文書: [UnsonOS 文書トレーサビリティ](./unson-os-document-traceability.md), [docs ガイド](../README.md)
- 置換: なし

## 目的

Brainbase の `wiki` と `skills` に自動改善がかかる原理を、用語定義から一貫して説明する。

この文書では次を固定する。

- フィードバックループの構造
- `episode` / `candidate` / `promotion` の定義
- `wiki` と `skills` の役割分担
- Brainbase での書き戻り先

## 一言でいうと

Brainbase のフィードバックループは、

1. 実行やレビューで出た個別の経験を `episode` として記録し
2. そこから再利用可能な知識を `wiki candidate` と `skill candidate` に分け
3. 正本へ昇格し
4. 次の実行がその正本を参照する

ことで、同じ失敗を減らす仕組みである。

## 用語定義

### `episode`

1 回のレビュー、失敗、修正、学びを表す記録。

- まだ個別の経験データ
- 一般化前の一次情報
- 例:
  - 「README の画像が 404 になった」
  - 「xterm の折り返し前半だけ hover しなかった」

### `candidate`

`episode` から作られた昇格候補。

- まだ正本ではない
- `wiki candidate`
- `skill candidate`

の 2 種類がある。

### `promotion`

`candidate` を正本に昇格すること。

- `episode -> candidate`
- `candidate -> wiki / skills`

までを含めて使う。

### `wiki`

正しさを固定するための知識層。

- 定義
- 原則
- 判断基準
- 仕様
- ストーリー
- 決定

### `skill`

動き方を固定するための知識層。

- 発火条件
- 実行手順
- チェックリスト
- recovery
- guardrails

## なぜ二本柱なのか

同じ学びでも、

- 「何が正しいか」
- 「どう動くべきか」

は別の種類の知識だから。

### `wiki` が担当するもの

- 意味
- ルール
- durable な判断
- 再利用される定義

### `skills` が担当するもの

- 実行
- 手順
- 発火条件
- 再発防止の運用

つまり、

- `wiki` = 正しさの知識
- `skills` = 行動の知識

である。

## 判断ルール

### `wiki` に行くもの

- Why
- policy
- definition
- rule
- decision
- spec

### `skills` に行くもの

- When
- how
- checklist
- recovery
- trigger

### 具体例

「README の相対画像は Markdown ファイル基準で解決するべき」

- これは `wiki`

「Markdown preview を直す時は、相対パス解決 -> 外部画像 -> 404 placeholder の順で確認する」

- これは `skill`

## ループの構造

Brainbase のフィードバックループは次の順で回る。

1. `review` / `explicit_learn` が発生する
2. その内容を `episode` として記録する
3. `episode` を一般化する
4. `wiki candidate` と `skill candidate` を作る
5. candidate を人が確認して正本へ昇格する
6. 次の実行がその正本を参照する

式で書くと、

`experience -> episode -> candidate -> promotion -> next execution`

である。

## Brainbase での書き戻り先

### `wiki`

- 正本:
  - サーバ DB `wiki_pages`
- 書き戻し:
  - `/api/wiki/page`
- 注意:
  - `docs/` に直接書き戻すループではない
  - ローカルへ配るには `wiki pull/sync` が必要

### `skills`

- 正本:
  - repo の `.claude/skills/*/SKILL.md`
- 書き戻し:
  - Git 管理で更新
- 注意:
  - `skills` は server wiki と別の正本

## `episode` の位置づけ

`episode` は正本ではない。

役割は、

- 個別の経験を失わず残す
- 一般化前の素材を保持する
- 再利用可能かどうかを後で判断できるようにする

ことにある。

つまり `episode` は、

- knowledge base そのものではなく
- knowledge に昇格する前の素材

である。

## 自動改善とは何か

Brainbase における「自動改善」は、モデルが勝手に賢くなることではない。

実際には次の処理である。

1. 経験を記録する
2. 経験を一般化する
3. 一般化した知識を `wiki` か `skills` に昇格する
4. 次回その知識を参照して実行する

つまり、自動改善の本体は **知識の書き戻しループ** である。

## よくある誤解

### `episode` がそのまま知識ベース

違う。`episode` は生データ。

### `wiki` と `skills` は同じもの

違う。`wiki` は正しさ、`skills` は行動。

### `docs/` に書いたら wiki が更新されたことになる

違う。`docs/` は repo の設計文書で、wiki 本文の正本ではない。

### 自動改善は完全放置で回る

違う。今の Brainbase は半自動で、最低でも `episode` の入口と candidate の確認が必要。

## 現在の運用モード

現在の Brainbase は `auto ingest + auto candidate generation + manual apply` を基本にする。

- `review artifact` と `explicit_learn` から `episode` を自動または半自動で作る
- `episode` から `wiki/skill candidate` を自動生成する
- `candidate` はいったん inbox に上がる
- 適用は `brainbase learn inbox` と `brainbase learn apply <id>` で行う

つまり、候補は自動で上がるが、正本への反映は人が最終確認する。

## 迷ったときの確認順

1. これは個別の経験か、再利用知識か
2. 再利用知識なら、正しさか、行動か
3. 正しさなら `wiki`
4. 行動なら `skills`
5. どちらに昇格するにしても、元は `episode` である

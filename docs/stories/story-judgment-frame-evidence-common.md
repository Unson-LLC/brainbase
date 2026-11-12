---
story_id: story-judgment-frame-evidence-common
title: 判断の枠組みの証拠判定をOSSの公開packageへ移し、一覧の読み直しを省けるようにする
status: in_progress
created_at: 2026-11-12
implementation_started: true
owner_repository: brainbase
depends_on:
  - story-judgment-harness-common-contracts-v1
---

# 判断の枠組みの証拠判定をOSSの公開packageへ移し、一覧の読み直しを省けるようにする

## 利用者成果

判断Hostを使う人として、同じ会話の中では哲学・目的・世界モデルの一覧を1回読めば済むようにしたい。一覧は数万字あり、依頼のたびに読み直すとトークンを使うだけで、判断は変わらない。

組織版のHostを作る開発者として、「一覧・本文・記録がそろったか」の判定をOSSの公開packageから使いたい。判定を組織版のrepositoryに持つと、同じ判定が2か所に分かれる。

## 背景

- 判定（`hasCompleteJudgmentFrame`）は、組織版のHostの中にだけあった。依頼ごとに、一覧の取得、同じdigestでの本文の取得、記録の3つを、この順で求める。
- 本文の取得（`brainbase_judgment_frame_read`）と記録（`brainbase_judgment_frame_record`）は、呼ばれるたびにサーバーが現在の一覧を作り直し、digestが違えば拒否する。同じ会話で読んだdigestで両方が成功したなら、一覧は変わっていない。

## 最小仕様

- `judgment-frame-evidence` を公開subpathとして出す。中身は次の4つ。
  - `frameReadMetadata`: 本文の取得結果から、digestと版だけの証拠を作る。本文は残さない。
  - `frameApplicationMetadata`: 記録の入力から、採用案が各参照をどう使ったかの証拠を作る。案の名前と理由はdigestだけ残す。
  - `hasCompleteJudgmentFrame`: 1つの依頼のイベント列が、枠組みとして完結しているかを返す。
  - `sessionFrameCatalogDigests`: 同じ会話のほかの依頼で成功した一覧取得のdigestを集める。
- `hasCompleteJudgmentFrame` は `sessionCatalogDigests` を受け取る。その依頼で一覧を読んでいなくても、渡されたdigestと記録のdigestが一致し、本文の取得と記録がその依頼で成功していれば、完結とする。
- その依頼で一覧を読んだ場合は、これまでどおりその一覧のdigestだけを基準にする。
- 記録の置き場（会話ごとのディレクトリ、依頼ごとの `<turn>.events`）は呼び出し側が渡す。OSS側は置き場を決めない。

## 受入条件

- [ ] AC-01: 同じ会話で読んだ一覧と同じdigestなら、一覧を読み直さなくても完結と判定する。本文の取得と記録は、その依頼で必要なままである。
- [ ] AC-02: 会話で読んでいないdigestの記録は、一覧なしでは完結と判定しない。
- [ ] AC-03: その依頼で一覧を読んだら、会話の過去のdigestではなく、その一覧に合わせる。
- [ ] AC-04: 同じ会話のほかの依頼で、成功した一覧取得のdigestだけを集める。失敗した取得、壊れたファイル、digestの形でない値、現在の依頼の記録は数えない。
- [ ] AC-05: `@unson/brainbase-mcp/judgment-frame-evidence` として公開packageのsubpathから読める。
- [ ] AC-06: 既存の判定（一覧だけ、順序の逆転、採用案への未適用、不適用の理由の欠落を拒否する）は変わらない。

## 範囲外

- 組織版のHost本体、指示文、MCPのツール説明の変更。組織版は、公開された版を取り込んでから切り替える。
- 一覧を検索で絞って返す形への作り替え。
- npm公開、組織版への取り込み、実行環境への反映。

## 検証

- `npx vitest run tests/judgment-frame-evidence.test.ts tests/judgment-harness-common-contracts.test.ts`
- `npm run build`

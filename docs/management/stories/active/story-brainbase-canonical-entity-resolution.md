---
story_id: story-brainbase-canonical-entity-resolution
title: 文章と正規Graphを根拠付きIDで接続する
status: active
period: 2026Q3
horizon: quarter
view: business
category: product
spec: docs/specs/story-brainbase-canonical-entity-resolution.md
architecture: docs/architecture/story-brainbase-canonical-entity-resolution.md
business_metric: 10分以内の初回価値で正規IDに根拠付き接続された事実を再利用できた利用者の割合
related_tasks:
  - task_source: GitHub
    task_ids:
      - canonical-graph-v2
      - common-entity-resolution
      - portable-resolution-receipt
      - adapter-integration
      - cycle-09-first-value
pr_scope_strategy: dependency_ordered_prs
pr_scope_reason: "Graph v2、共通Resolver、Receipt、利用アダプターは一つの利用者価値を構成するが、保存形式と公開契約を先に固定しないと並列実装が異なるID・relation・失敗意味論を作るため、依存順を保った複数PRで統合する。"
pr_scope_review_facets:
  - canonical-contract
  - storage-migration
  - resolution-runtime
  - adapter-compatibility
  - release-evidence
pr_scope_dependency_boundaries:
  - storage-migration->canonical-contract
  - resolution-runtime->canonical-contract
  - adapter-compatibility->storage-migration
  - adapter-compatibility->resolution-runtime
  - release-evidence->adapter-compatibility
created_at: 2026-08-17
updated_at: 2026-08-17
---

# 文章と正規Graphを根拠付きIDで接続する

## Current reality

Brainbase OSSは、人物、プロジェクト、関係、意思決定をローカルSSOTへ保存し、MCPから検索できる。しかし、正規エンティティ同士は安定IDのedgeで接続されていない。関係者は表示名、判断基準は自由文や別recordとして保持され、検索結果も正規データと投影を区別しない。

このため、`Atlas導入`、`田中`、判断基準を個別には取得できても、同じ正規Graph上の関係として辿れない。`田中さん`のような敬称付き表現、同姓同名、プロジェクト越境、会議時点の文脈を一つの共通規則で解決する仕組みもない。議事録、Slack、判断登録などが独自Resolverを持てば、同じ文章が利用経路ごとに異なるIDへ接続される。

## Intent

正規エンティティ同士を型付きID edgeで接続し、そのGraphを使って任意の文章中の表現を根拠付きで正規IDへ対応付ける。解決結果は、取得元の状態と文章の解決状態を分離したportable receiptとして、CLI、MCP、議事録、Slack、判断登録、資料生成から共通利用できるようにする。

## ユーザーストーリー

Brainbaseを使う人として、普段の文章に出てくる人物、プロジェクト、組織、意思決定を、過去に承認した正規エンティティへ安全に接続したい。そうすることで、表記揺れや利用経路の違いに左右されず、Brainbaseがどの事実をなぜ使ったかを確認しながら、最初の10分で自分の文脈が再利用される価値を体験できる。

## 受け入れ基準

- [ ] AC-1: Graph schema v2は正規entityと型付きID edgeを同じ`graph.json`に保持し、edge endpoint、relation、重複、cardinalityを検証する。
- [ ] AC-2: project、person、org、decisionを正規IDで参照でき、少なくとも人物のproject参加・責任、判断のproject適用、意思決定の置換をedgeとして表現できる。
- [ ] AC-3: v1の4 canonical filesを無変更で読み取れ、dry-run migrationはbyte-identicalを保ち、明示writeだけが既存の原子的transactionでv2へ移行する。
- [ ] AC-4: legacy名が一意に完全一致するときだけ自動edge化し、0件または複数候補は`unresolved`として残す。推測によるcanonical writeを行わない。
- [ ] AC-5: 共通Resolverは文章中のmention位置、project scope policy、`as_of`、alias・敬称、Graph relationを使い、各mentionを`resolved`、`ambiguous`、`unresolved`に分類する。
- [ ] AC-6: 取得元の`complete|partial|unavailable|invalid`と、文章全体の`complete|partial|none|blocked`を別軸で返し、検索0件と取得障害を混同しない。
- [ ] AC-7: portable receiptは入力本文を保存せず、入力hash、mention spanとsurface hash、候補根拠、採用canonical ID、source revision、各契約version、決定的digestを保持する。
- [ ] AC-8: 同じcanonical snapshot、入力、scope、`as_of`、Resolver versionから同じ解決結果とdigestを再計算でき、span、source revision、候補根拠の改変を検出できる。
- [ ] AC-9: `get_context`、`search`、CLIは既存必須入力と既存fieldを維持し、正規ID、record class、projection、relation pathを追加情報として返す。
- [ ] AC-10: 議事録、Slack、判断登録、資料生成のadapterは共通Resolverと同じReceiptを受け渡し、独自のalias辞書、confidence規則、未解決判定を実装しない。
- [ ] AC-11: `doctor`はGraph schema、edge整合性、未解決legacy参照、projection欠損、migration状態を区別し、破損や未確認をhealthyまたは0件へ丸めない。
- [ ] AC-12: fresh npm tarball installの実CLIとMCP stdioで、Atlas導入、田中、判断基準が同じ正規ID Graphへ接続され、`田中さん`も田中のcanonical IDへ解決される。
- [ ] AC-13: Cycle 09の実agent journeyで、取得元とReceiptを明示した実用回答を初回利用開始から600秒以内に得て、独立ペルソナが「Brainbaseなしより文脈再利用が楽になった」と認識する。

## 既存Storyとの関係

- `story-brainbase-portable-ontology-kernel`はOntology 1.0.0の意味監査とDecision supersessionを保持する。本Storyは、その上にGraph v2の型付きID edge、共通Resolver、Receiptを追加する。既存Ontology 1.0.0を同じversionのまま再定義しない。
- `story-brainbase-portable-connected-world-onboarding`はsource receipt、candidate review、canonical promotionを所有する。本Storyはpromotion後のcanonical ID接続と、文章から正規IDへの解決を所有する。
- 初回価値Storyの「10分」はコマンド応答時間ではなく、導入を開始してから利用者がBrainbase固有の価値を認識するまでの時間を指す。

## 境界

- Graph SSOTは正規entity、edge、Ontology-validな関係の正本である。Personal KG、legacy relationship、検索用index、会議資料は投影またはsourceであり、正規Graphを上書きしない。
- Resolverはcanonical entityを探索・順位付けするが、曖昧または未解決の表現から新しいcanonical entityを自動作成しない。
- Receiptは解決判断の証拠であり、外部送信、canonical write、判断登録の許可を与えない。各adapterの通常の承認境界を置き換えない。
- OSS標準契約はhosted backend、bb.unson.jp、Unson内部Graph、内部Decision/RACI、secretを必要としない。

## Invariants

- 正規entity間の関係は表示名ではなくstable IDで保存する。
- Graph schema version、Ontology version、Resolver version、Receipt schema versionを混同しない。
- source取得障害を`unresolved`や検索0件へ変換しない。
- `ambiguous`をconfidenceの閾値だけで`resolved`へ昇格しない。
- aliasと敬称除去はquery-timeの候補生成に使い、同一人物のcanonical mergeを自動実行しない。
- project scopeを越える候補は越境根拠を明示し、`strict`の既定では採用しない。fallbackはcallerが明示許可した場合だけ使う。
- 未来のedgeや失効済みedgeを`as_of`より前後へ遡及適用しない。
- 全adapterは共通ResolverとReceipt contractを利用し、解決規則を再実装しない。

## Failure modes

- Graph v2の未知relation、欠落endpoint、型違反、重複tuple、cardinality違反はfail loudし、writeを開始しない。
- v1 migrationで一意な根拠がない参照は未解決として報告し、暗黙に接続しない。
- Graph unavailableまたはinvalid時はresolutionを`blocked`とし、0 mentionや`unresolved`成功として返さない。
- span、input hash、source revision、receipt digestが一致しなければReceiptを受理しない。
- adapterが異なるResolver versionやReceipt schemaを要求する場合は互換adapterなしに黙って読み替えない。

## Done evidence

現在HEADに結び付いたcontract fixture、v1/v2 migration・rollback・concurrency test、全writerのedge生成test、Resolverのalias・同姓同名・scope・`as_of` test、Receipt改変test、旧MCP contract、MCP stdio E2E、fresh tarball consumer test、full test、typecheck、build、docs buildが成功していること。さらにCycle 09の実agent journeyと独立ペルソナ評価をcandidate tarballと公開registry版で分けて記録し、既知の知識構造Majorが0件であること。

## Public contract judgment

Graph v2と新しい解決結果はadditiveに公開する。既存CLI flag、MCP tool名、必須入力、`SearchResult`の既存field、`get_context`の既存fieldを削除しない。v1はdual-readで維持するが、v2 edgeを失う旧writerによるsilent rewriteは許可しない。公開候補versionはminor releaseとし、破壊的削除は別のmajor releaseへ送る。

## スコープ外

- 任意文章を自動でcanonical factへ昇格すること
- 一般用途の固有表現認識モデルやベクトルDBを必須依存にすること
- 全言語・全敬称・全業界語彙を最初から網羅すること
- Unson内部Graphのデータ、署名鍵、公開権限をOSSへ複製すること
- Receiptだけを根拠にSlack送信、判断登録、外部更新を自動許可すること

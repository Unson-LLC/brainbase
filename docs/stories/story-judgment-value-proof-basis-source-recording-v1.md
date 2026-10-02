---
story_id: story-judgment-value-proof-basis-source-recording-v1
title: 保存済み判断の根拠に確認済みのGraph出典を記録できる
status: proposed
created_at: 2026-10-02
implementation_started: false
owner_repository: brainbase
depends_on: ["story-m3-judgment-value-proof-surface", "story-judgment-value-proof-inheritance-v1", "story-ux-20261001-06-source-navigation"]
external_dependencies: ["Canonical Graphの認証済みreadback境界"]
---

# 保存済み判断の根拠に確認済みのGraph出典を記録できる

## 利用者成果

判断の見返しで、判断時に確認できたCanonical Graphの対象を、判断の根拠と同じIDで確認したい。出典を確認できなかった判断は出典なしのまま見返せ、後から作った推測リンクや出典によって、判断レシート・成果確認済み・事業成果を誤って示さない。

## 現在確認できていることと未確認

- **確認済みの観測（C509読取）**: 現行MCP/Hostのbasis入力には`source`と`project`がなく、保存済み20件、basis 6要素、`source=0`だった。
- **確認済みの別経路の観測**: 認証済みGraph照会で哲学IDを2件見つけた。
- **未確認**: その2件がPersonal Webの`/api/graph/entities/:id`と同じ認証・scope・readback経路で読めること。Foundationの哲学・目的をこの`local_graph`出典として扱えることも未確認。
- **判断境界**: D-20261001-07で承認済みなのはsourceのreadback/navigationだけであり、producerによる新規記録や既存journalのbackfillは承認されていない。

したがって、このStoryは将来producerが満たす条件を定義する提案であり、現在の20件への記録追加、既存記録の書換え、Graph照会、Web routeの実装を含まない。

## D-20261002-02で承認された設計範囲

2026-10-02 18:29 JSTのD-20261002-02で承認されたのは設計だけである。このStoryで具体化するのは、Canonical Graph 4型に限定したReader Host契約の境界と、readbackできない出典を記録しない不変条件であり、producer、Host、Graph、journalの実装や現在データへの反映ではない。

この文書から実journal、認証済みreadback、Receipt、実成果が確認済みになったとはいえず、実成果は未確認のままである。

- **将来のHost注入ポート（設計案）**: Hostが`authority`、認証済みprincipal、現在のread ACL、project scopeを解決し、その信頼済みcontextをreaderへ渡す。producerの入力にあるauthority、principal、scope、project名、検索結果を採用・上書きしてはならない。readerはbasisと同じID・型に加え、Graphのentity recordが返す明示的なrevisionとdigestを返す。どれかが不明な場合にlatest、`as_of`、表示名、推測値で埋めない。
- **現行Personal Webとの境界**: 現行のowner-localな`GET /api/graph/entities/:id`は、entityのID・型・digestを読む既存routeであり、`source.authority: 'local_graph'`というラベルだけではないprincipal、現在のACL、project scope、entity record revisionの証明にならない。このrouteは将来の「Hostが解決した認証済みCanonical Graph reader」と別契約であり、単独ではAC-02の`available`を満たさない。
- **失敗時の境界**: readerが`available`でない場合、sourceは記録しない。これはsourceの有無に関する不変条件であり、そのときvalue-proof全体をsource-freeで保存するかproducerを保留するかは別のarchitecture未決事項として残す。
- **D-20261002-03で承認された版照合**: `source.version`は、認証済みreadbackが返した同じ対象entity recordの明示的なrevisionを意味する。`basis.version`が同じ対象record revisionを表すと確認できる場合は`source.version`との一致を必須とし、意味不明・不一致・対象record revisionの欠落時はsourceを記録せず未確認とする。digestだけ、Graphファイル全体の版、`latest`、`as_of`、表示名は対象entityのrecord revisionの代用にしない。

## 対象と契約上の位置づけ

- 対象は`decision.basis[]`の任意欄である`source`を、判断時点の信頼できるGraph readbackに基づいて記録するproducer境界と検証条件。
- `source`がない既存のvalue-proof v1は引き続き有効であり、source-free記録はsource-freeのまま扱う。
- `local_graph`の出典対象はCanonical Graphの`person`、`org`、`project`、`decision`の4型に限る。sourceの`entity_id`は同じbasis entryの`entity_id`と一致させる。
- `basis[].layer`（哲学、目的、現状と見通し、判断方法、守る条件、その他）は、sourceの有無・型・IDから独立して保存する。layer、`application`、表示名からsourceを推測しない。
- `source`はURLでも、任意のpathでも、Graphに検索すれば見つかるかもしれないIDでもない。UX-20261001-06のhost-owned readerが同一ID・型・指定版/digestを読み戻せる場合に限るtyped descriptorである。

## 受入条件

- [ ] **AC-01（旧記録の有効性）**: `decision.basis[].source`が欠落または`null`の既存value-proof v1は、従来どおり検証・読取できる。sourceがない記録を、後続の検索結果や`layer`から補完しない。source-free記録の表示・リンク・未確認状態を成功扱いに変えない。
- [ ] **AC-02（producerの記録条件）**: producerは、判断時点で将来のHost注入ポートが解決した認証済みCanonical Graph readerのreadbackが`available`であり、返却された対象のIDと型がbasis entryと一致した場合だけ`local_graph` descriptorを記録できる。呼出し元が渡した任意のURL、project名、表示名、検索候補、または現行Personal Webのowner-local GETだけではreadbackの代わりにならない。
- [ ] **AC-03（descriptorの範囲）**: `local_graph`は`person`、`org`、`project`、`decision`だけを受け付ける。`source.entity_id`は同じentryの`entity_id`と完全一致させ、`source.version`はreadbackした同じ対象entity recordの明示的なrevisionをそのまま固定する。`basis.version`が同じ対象record revisionと確認できる場合は`source.version`との一致を必須とし、意味不明・不一致・record revision欠落時はsourceを記録しない。digestだけ、Graphファイル全体の版、`latest`、`as_of`、表示名をrevisionの代用にしない。`project`やscopeを現行basis入力に存在するものとして推測せず、必要なscope/authorityはHostの信頼境界で検証する。
- [ ] **AC-04（layerの独立性）**: `layer=philosophy`や`layer=objective`であることだけを理由に`local_graph` sourceを付けない。sourceが記録できても、layerを変更・補完・型変換しない。layerがないbasisもsourceのreadback条件を満たせば記録対象になり得るが、sourceの存在はlayerの記録を意味しない。
- [ ] **AC-05（反証時の扱い）**: readerが`not_found`、`ambiguous`、`forbidden`、`unavailable`を返す、ID・型・version・digestが一致しない、`basis.version`の意味が不明または`source.version`と不一致、対象entity record revisionが欠落、authority・principal・現在のACL・project scopeが不明または一致しない、またはreaderが例外・不正payloadを返す場合、producerはsourceを記録しない。digestだけやGraphファイル全体の版をrecord revisionとして扱わない。このsource omissionは不変条件であり、value-proof全体をsource-freeで保存するかproducer全体を保留するかは未決である。いずれの場合も出典あり・存在・確認済みへ昇格させない。
- [ ] **AC-06（URLと架空出典の禁止）**: `source.kind`のURL型、外部URL、任意path、URLから作ったGraph IDは受け付けない。producer・journal・rendererのいずれも、出典がない記録にリンクや出典を生成しない。遷移はUX-20261001-06のreadback成功後に同一OriginのGraph routeへ委譲する。
- [ ] **AC-07（Foundationの分離）**: `philosophy`または`objective`のFoundation出典を、`local_graph`のentity type列挙に追加して表現しない。現行Personal Webのowner-local Graph routeと、Hostが解決した認証済みCanonical Graph readerが同一経路・認証・scope・revision/digest契約であることは確認済みとせず、必要なら別provider/reader契約のStoryとarchitecture判断を先に置く。
- [ ] **AC-08（Receipt・成果との非混同）**: source descriptorの記録・readback成功は、判断レシートの発行、実行完了、`outcome_verified`、事業成果、本人の評価を意味しない。`execution`、`outcome`、`feedback`、evidence refは既存の契約と実証結果を保持し、sourceだけで`canonical_readback`や成果確認済みを追加しない。
- [ ] **AC-09（移行と後方互換）**: 既存journalの読取はsource欠落を許容し、旧producerはsourceなしで動作できる。移行処理は既存JSONの書換えやsourceの自動backfillを行わない。将来の新producerだけが確認済みsourceを追加し、旧記録のbackfillは別の承認済みStory・個別readback・監査証跡なしには実施しない。
- [ ] **AC-10（失敗の可視性）**: sourceの検証不能を`0件`、成功、存在しない、成果未確認から成果確認済み、または「sourceなし=Graphに存在しない」と読み替えない。producer・reader・UIの各層で、未確認理由と未実施の範囲を区別できる。
- [ ] **AC-11（Reader Host契約の境界）**: `available`を返せるのは、Hostがauthority・認証済みprincipal・現在のread ACL・project scopeを解決し、Canonical Graph 4型のID・型とentity recordの明示的なrevision・digestを同じreadbackで検証できた場合だけである。`basis.version`が同じ対象record revisionを表すと確認できる場合は`source.version`と一致させ、意味不明・不一致・revision欠落時はsourceを記録しない。現行`GET /api/graph/entities/:id`の`local_graph`ラベル、digest、Graphファイル全体の版、`as_of`指定、またはowner-localであることを、ACL・scope・revisionの代用にしない。

## 実装前に佐藤さんのarchitecture判断が必要な未決論点

このStoryを実装着手へ進める前に、少なくとも次を判断する。判断がない間は、既存のsource-free契約とUX-20261001-06のreadback/navigationだけを維持する。

1. **authorityの所有者**: producerが使うCanonical Graph readerをどのHost境界で提供し、認証主体・project/scope・ACL・現在版を同じ経路で照合するか。
2. **scope/projectの保持方法**: 現在のdescriptorに`project`を追加せずHostの信頼境界だけで束縛するか、source descriptorへscope/revisionを追加するか。入力に無いprojectを推測する実装は採用しない。
3. **Foundationの接続方式**: 哲学・目的を別provider/readerで扱う場合の正本、認証、scope、revision/digest、Web route、失敗状態をどう契約するか。`local_graph`への単純なenum追加は選択肢にしない。
4. **失敗理由の保存場所**: readerの一時的な戻り値だけに留めるか、journalのsidecar／evidenceとして監査保存するか、UI／Receiptへ未確認理由を表示するか。source omissionは固定するが、理由の永続化先と粒度は未決である。
5. **失敗時のproducer方針**: readback不能時にvalue-proof全体をsource-freeで保存するか、producer全体を保留するか。sourceを記録しないことだけを不変条件とし、どちらも選択しない。
6. **journalの原子性と移行**: sourceの検証結果とvalue-proof本体を同一atomic writeにするか、source検証のsidecarを別atomic writeにするか、部分書込みと旧producerとの同時稼働をどう扱うか。backfillを禁止または別承認にする監査方法も未決である。
7. **表示・Receipt境界**: source readbackを判断カードへ表示する範囲と、判断レシート・`canonical_readback`・成果確認・事業成果の証拠を混ぜない表示規則。

## 対象外

- producer、MCP/Host入力、journal writer、schema/contract、Graph reader、Graph DB、実Graph、実journalの変更。
- 将来のReader Host注入ポート、authority/principal/ACL/project scope/revisionの照会契約の実装。
- 現在保存済み20件へのsource追加、sourceのbackfill、欠落projectの補完。
- Personal Webの`/api/graph/entities/:id`、Graph画面、UX-20261001-06のreadback/navigation実装。
- Foundationの哲学・目的の保存、Web Graph routeへの接続、provider/readerの新設。
- sourceの有無から判断レシート、実行・成果、Receipt、本人評価、事業成果を生成すること。

## 検証と完了

このPRでは文書整合だけを検証する。実装時の最小回帰候補は、source-free旧記録、4つの`local_graph`型、ID不一致、layer独立、URL型、Hostのauthority/principal/ACL/scope/revision欠落、現行owner-local GETをHost readbackと誤認しないこと、readback各失敗、version/digest不一致、Foundation型の拒否、旧producerとの併用、backfill禁止である。fixtureは架空Graphだけを使い、実journal・認証済みGraph・常駐Web・事業成果を完了証拠にしない。

このStoryを採用しても、現在のC509記録に出典が付き、UX-06の画面遷移が実データで確認できたこと、Receiptが発行されたこと、または事業成果が確認されたことを意味しない。

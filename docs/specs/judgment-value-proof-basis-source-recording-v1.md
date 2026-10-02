---
spec_id: judgment-value-proof-basis-source-recording-v1
story_id: story-judgment-value-proof-basis-source-recording-v1
status: proposed
spec_maturity: design_only
owner_repository: brainbase
---

# 保存済み判断の根拠出典記録 v1 Spec（提案）

## 1. 既存契約との関係

このSpecは、`decision.basis[]`にある任意の`source`を将来のproducerが記録する条件だけを定める。現行のvalue-proof v1とUX-20261001-06のdescriptor/readback契約を置き換えず、次を不変とする。

- `source`のない既存記録は有効であり、source-freeのまま読める。
- source-free記録に出典リンクを作らない。実際のsource readbackが成功しない限り、存在・出典あり・確認済みとは表示しない。
- producerがsourceを記録しなかった理由を、Graph不存在、判断receipt未発行、成果未確認、事業成果なしと推測しない。
- このSpecの採用は、既存journalの記録・backfillや実Graphのreadback承認を意味しない。

## 2. Descriptorと不変条件

UX-20261001-06で定義済みのdescriptorを、producerが満たしたreadbackの結果からのみ生成する。

```ts
type LocalGraphBasisSource = {
  kind: 'local_graph';
  entity_id: string;
  entity_type: 'person' | 'org' | 'project' | 'decision';
  version?: string | null;
  digest?: string | null;
};
```

不変条件:

1. `source.entity_id === basis.entity_id`。同じbasis entryの対象を指し、別の検索結果や表示名を参照しない。
2. `entity_type`はCanonical Graphの`person`、`org`、`project`、`decision`の4型だけである。Foundationの`philosophy`や`objective`をこの列挙へ足さない。
3. `version`または`digest`を保存する場合は、producerが成功したreadbackの値をそのまま固定する。値のないreadbackをlatestや推測値で埋めない。
4. `basis.layer`はdescriptorの一部ではなく、sourceの存在・型・IDを決めない。`philosophy`／`objective` layerだからといってFoundation sourceや`local_graph` sourceを生成しない。
5. descriptorはURL、外部URL、任意path、project名、表示名、検索クエリを持たない。project/scopeは記録shapeへ推測で追加せず、Hostのtrusted contextで照合する。

## 3. Producerがsourceを記録できる条件

producerは次の全条件を満たした場合だけsourceを付ける。

| 条件 | 必須の確認 | 記録する値 |
| --- | --- | --- |
| basisの対象 | 同じbasis entryの非空`entity_id` | `source.entity_id`へ同じ文字列 |
| Canonical Graph readback | Host-owned readerが認証済みauthority/scopeで対象を読める | readerが返した4型の`entity_type` |
| identity | readback IDとbasis IDが完全一致 | 一致したIDだけ |
| 版・digest | descriptorに保存する値がreadbackと一致 | readbackのversion/digestをそのまま |
| 読取結果 | `available`であり、正規形・ACL・scopeの検証が完了 | `kind: 'local_graph'` |

呼出し元のproject、scope、URL、表示名、layer、application、過去の検索結果は、trusted readbackの代わりにならない。C509で観測された「source/projectなし」の現在入力を、producerが勝手に補完してはならない。

## 4. 検証・反証・保存方針

### 4.1 受け付けるもの

- 4つのCanonical Graph型のいずれかで、basis IDとsource IDが一致する。
- readerが返す認証・scope・ACL・正規形が確認済みで、指定したversion/digestがある場合は同じ値で一致する。
- sourceの有無とlayerの有無が独立しており、どちらも別の欄の意味を変更しない。

### 4.2 拒否またはsourceを付けないもの

- `not_found`、`ambiguous`、`forbidden`、`unavailable`、reader例外、不正payload。
- ID、型、version、digest、authority、scopeの不一致または未確認。
- `source.entity_id`がbasis IDと異なるdescriptor。
- `url`等の未定義kind、外部URL、任意path、Graph IDを推測したdescriptor。
- `layer=philosophy`／`objective`だけを根拠にしたFoundation出典。

上記では、sourceを記録せずsource-freeとして扱える範囲を維持する。source readback不能をvalue-proof全体の成功、Graph不存在、Receipt発行、`outcome_verified`へ変換しない。実装時にsource記録だけを拒否してvalue-proofを保存するか、producer全体を保留するかは、architecture判断が返るまで未決定とする。

## 5. Foundation（哲学・目的）の境界

Foundationの哲学・目的は、現在のWeb Graph routeと認証済みGraph照会が同じ経路であること、正本・scope・ACL・revision/digest・失敗状態を照合できることが未確認である。よって本Specでは未対応とする。

将来対応する場合も、`local_graph`の`entity_type`へ`philosophy`や`objective`を追加するだけの変更は禁止する。別provider/readerのsource kind、正本所有者、認証・scope境界、exact revision/digest、Web route、readback失敗状態、移行と表示の契約を別Storyで定義し、architecture判断を得る。

## 6. 移行・後方互換

- 現行schema/versionのsource任意性を保ち、source欠落の旧recordを再書込みしない。
- 旧producerはsourceなしで継続できる。新producerはreadback成功時だけsourceを追加し、失敗時はsource-freeのままにする。
- readerに必要なproject/scopeが旧recordにないことを理由に、旧recordを0件・破損・Graph不存在としない。読めない出典は未確認として扱う。
- sourceを既存journalへ一括追加するbackfill、ID検索による後付け、layer/applicationからの補完はこのSpecの移行に含めない。実施には別の承認済みStory、対象ごとのreadback、変更前後とauthorityの監査証跡が必要である。
- source-bearingで不正なrecordを見つけた場合、正しいrecordへ黙って書き換えず、失敗理由を保ったまま読取・表示を成功扱いにしない。

## 7. Receipt・成果・UX-06との接続

- source descriptorは根拠対象のtyped identityであり、judgment receiptではない。
- `canonical_readback`を含むevidence ref、実行artifact、outcome、human feedbackは、それぞれの既存契約で確認された場合だけ記録する。sourceのreadback成功から推測しない。
- UX-20261001-06はreadback成功後に同一OriginのGraph routeへ遷移できる契約であり、source記録・backfill・Foundation接続を承認するものではない。
- C509の20件、basis 6要素、source 0から、実データの出典記録、Receipt、画面遷移、事業成果を推定しない。

## 8. Architecture判断待ち

実装前に次を決めるまで、このSpecのstatusは`proposed`のままとする。

1. producerが呼ぶCanonical Graph readerの所有Host、認証主体、project/scope、ACL、current/historical readの境界。
2. project/scopeをdescriptorへ保存するか、trusted contextだけで照合するか。現行入力にない値の推測は禁止。
3. version/revisionが返らないGraph readbackを未確認とするか、digestだけで固定できるか。
4. readback失敗時のsource-free保存とproducer保留の選択、および未確認理由のReceipt/UI表現。
5. Foundation provider/readerを別契約として設計するか、その正本・Web route・scope・revision/digest・失敗状態。
6. source追加のjournal原子性、旧producer併用、backfillの承認・監査境界。

## 9. 実装時の検証項目（文書PRでは未実施）

架空fixtureで、sourceなし旧record、4つのGraph entity type、ID一致、ID不一致、型不正、URL型、layer独立、readerの4失敗、version/digest不一致、Foundation型拒否、旧producer併用、backfill不実施を確認する。実journal、実Graph、認証済みWeb、常駐host、判断receipt、事業成果はこの文書PRの検証対象にしない。

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

### 2.1 Reader Host契約（設計案、永続descriptorとは別）

producerが直接組み立てる入力ではなく、将来のHost注入ポートが解決してreaderへ渡すcontextとreadback結果の概念契約を定める。フィールド名・wire format・永続化方式はこのSpecでは決めない。

- **Host-owned context**: `authority: 'local_graph'`、Hostが解決した認証済みprincipal（opaqueな識別子）、現在のread ACLの判定、project scopeの解決状態（対象projectと一致／不明／不一致）を含む。producerが渡したprincipal、scope、project名、検索候補をcontextとして採用しない。
- **Canonical record**: readerはbasisと同じentity ID・4型の`entity_type`に加え、Graphが返したentity recordの明示的なrevisionとdigestを返す。revision/digestの未提供をGraph形式、`as_of`、latest、表示名、推測値で補わない。
- **`available`**: authority・principal・現在のACL・project scopeがHost境界で解決済みで、ID・型が一致し、record revision/digestをreadbackできた状態だけを表す。その他は`not_found`、`ambiguous`、`forbidden`、`unavailable`、または検証不能な失敗状態とする。
- **永続descriptorとの分離**: 現行の`LocalGraphBasisSource`はkind・entity ID・型・任意のversion/digestだけを持つ。Host context（principal、ACL、scope）をdescriptorへ保存するか、sourceの`version`へrecord revisionを写すかは、§8の未決事項であり、ここで追加採用しない。

### 2.2 現行Personal Webのowner-local GETとの境界

現行`GET /api/graph/entities/:id`は、owner-localなPersonal Web routeとしてentityのID・型・digestを返し、`source.authority: 'local_graph'`というsource labelを示す。しかし、このrouteの応答には認証済みprincipal、現在のACL、project scope、entity record revisionを証明する契約がなく、`as_of`指定やdigestをそれらの代用にはできない。したがって、現行routeは将来の「Hostが解決した認証済みCanonical Graph reader」と別契約であり、単独の成功を§2.1の`available`へ昇格させない。ACL・scope・revisionを持つように現行GETを変更することも、この文書PRの対象外である。

## 3. Producerがsourceを記録できる条件

producerは次の全条件を満たした場合だけsourceを付ける。

| 条件 | 必須の確認 | 記録する値 |
| --- | --- | --- |
| basisの対象 | 同じbasis entryの非空`entity_id` | `source.entity_id`へ同じ文字列 |
| readerのauthority/principal | Host-owned readerが`local_graph` authorityと認証済みprincipalを解決し、producer入力では上書きできない | Hostが返したcontextだけ。principalをdescriptorへ推測保存しない |
| 現在のACL | Hostが現在のread ACLを`allowed`として確認する | ACLの未確認・不一致はsourceなし |
| project scope | Hostが対象scopeを解決し、要求されたproject scopeとの一致を確認する | scopeの未確認・不一致はsourceなし。basis入力のproject名では補完しない |
| identity/type | readback IDとbasis IDが完全一致し、4型の`entity_type`である | 一致したID・型だけ |
| entity record revision | Graphが返した明示的なrecord revisionをreadbackする | providerが返した値だけ。Graph形式、`as_of`、latestをrevisionにしない |
| entity digest | Graphが返した正規化済みrecord digestをreadbackする | providerが返した値だけ。推測・再計算値を採用しない |
| 読取結果 | 上記contextとidentity/type、revision/digestの検証が完了した`available` | `kind: 'local_graph'`とreadback値 |

呼出し元のproject、scope、URL、表示名、layer、application、過去の検索結果は、trusted readbackの代わりにならない。C509で観測された「source/projectなし」の現在入力を、producerが勝手に補完してはならない。

## 4. 検証・反証・保存方針

### 4.1 受け付けるもの

- 4つのCanonical Graph型のいずれかで、basis IDとsource IDが一致する。
- Hostが返すauthority、認証済みprincipal、現在のread ACL、project scopeが確認済みで、readerがentity recordのID・型・明示的なrevision・digestを返す。
- 指定したversion/digestがある場合はreadbackの同じ値で一致する。`source.version`と`basis.version`を同一にするか独立に扱うか、revisionがない場合にdigest-onlyを許すかは§8.3の未決事項である。
- sourceの有無とlayerの有無が独立しており、どちらも別の欄の意味を変更しない。

### 4.2 拒否またはsourceを付けないもの

- `not_found`、`ambiguous`、`forbidden`、`unavailable`、reader例外、不正payload。
- ID、型、version、digest、authority、principal、現在のACL、scope、entity record revisionの不一致または未確認。
- `source.entity_id`がbasis IDと異なるdescriptor。
- `url`等の未定義kind、外部URL、任意path、Graph IDを推測したdescriptor。
- `layer=philosophy`／`objective`だけを根拠にしたFoundation出典。

上記のいずれかに該当した場合、sourceは記録しない。これはsource omissionの不変条件であり、source readback不能をvalue-proof全体の成功、Graph不存在、Receipt発行、`outcome_verified`へ変換しない。一方、value-proof全体をsource-freeで保存するか、producer全体を保留するかは別のarchitecture判断であり、ここでは未決定とする。

## 5. Foundation（哲学・目的）の境界

Foundationの哲学・目的は、現在のWeb Graph routeと認証済みGraph照会が同じ経路であること、正本・scope・ACL・revision/digest・失敗状態を照合できることが未確認である。よって本Specでは未対応とする。

将来対応する場合も、`local_graph`の`entity_type`へ`philosophy`や`objective`を追加するだけの変更は禁止する。別provider/readerのsource kind、正本所有者、認証・scope境界、exact revision/digest、Web route、readback失敗状態、移行と表示の契約を別Storyで定義し、architecture判断を得る。

## 6. 移行・後方互換

- 現行schema/versionのsource任意性を保ち、source欠落の旧recordを再書込みしない。
- 旧producerはsourceなしで継続できる。新producerはreadbackが`available`のときだけsourceを追加し、readerが失敗したときは必ずsourceを記録しない。value-proof全体をsource-freeで保存するかproducerを保留するかは未決であり、移行方針として決めない。
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

1. producerが呼ぶ将来のReader Host注入ポートの所有Host、認証主体、project/scope、現在のACL、current/historical readの境界。現行Personal Webのowner-local GETをこの契約へ読み替えない。
2. project/scope、principal、ACLをdescriptorへ保存するか、trusted contextだけで照合するか。現行入力にない値の推測は禁止。
3. `source.version`と`basis.version`、Graph entity record revision、digestの関係を、(a)両者がある場合の完全一致、(b)record revisionとbasis側の版の独立検証、(c)revisionがない場合のdigest-only、のどれにするか。latest、`as_of`、Graph formatをrevisionの代用にするかも決めていない。
4. readback失敗理由をreaderの一時結果だけにするか、journalのsidecar／evidenceとして保存するか、UI／Receiptで表示するか。理由の保存場所・粒度・保持期間は未決である。
5. readback失敗時にsource omissionを維持した上でvalue-proof全体をsource-freeで保存するか、producer全体を保留するか。sourceを付けない不変条件以外は選択しない。
6. Foundation provider/readerを別契約として設計するか、その正本・Web route・scope・revision/digest・失敗状態。
7. source追加のjournal原子性をvalue-proof本体と同一writeにするか、source検証sidecarを別atomic writeにするか、旧producer併用、部分書込み、backfillの承認・監査境界をどうするか。
8. source readbackを判断カードへ表示する範囲と、判断レシート・`canonical_readback`・成果確認・事業成果の証拠を混ぜない表示規則。

## 9. 実装時の検証項目（文書PRでは未実施）

架空fixtureで、sourceなし旧record、4つのGraph entity type、ID一致、ID不一致、型不正、URL型、layer独立、Hostのauthority/principal/ACL/scope/revision欠落、現行owner-local GETをHost readbackと誤認しないこと、readerの4失敗、version/digest不一致、Foundation型拒否、旧producer併用、backfill不実施を確認する。実journal、実Graph、認証済みWeb、常駐host、判断receipt、事業成果はこの文書PRの検証対象にしない。

この文書PRでは実成果未確認であり、設計記述・架空fixture・文書検証を、実journalの保存、認証済みreadback、Receipt発行、または事業成果の確認済み証拠に扱わない。

# Company OS Knowledge Adapter v1 Spec

親Story: [`story-company-os-knowledge-adapter-v1`](../stories/story-company-os-knowledge-adapter-v1.md)

このSpec／Storyの版はv1である。採用locatorの意味契約を追加した現行sidecarは
`knowledge-condition-adapter.v2`として保存し、旧v1 sidecarは明示的に再解釈せずreadonly互換で読む。

## 目的と範囲

既存の Knowledge Event、feedback、candidate、candidate promotion、Graph maintenance、
MeetingKnowledgeEventBridge の記録を、今回の判断に使った条件へ正確に辿れるようにする。
OSS が提供するのは、host-owned な既存記録を読む port と、条件・元証拠・採用記録の
locator だけを保存する personal canonical adapter である。既存の会社 runtime、承認
provider、tenant、RACI、Human Gate の判定をOSSへ移さず、旧HTTP routeや廃止経路も復活させない。

このSpecでいう「接続」は、既存記録の本文をGraphへ取り込むことや、採用・承認を自動化する
ことではない。`JudgmentProblem` の exact snapshot、判断方法の版、Objectiveの版を、既存
記録の安定したID・revision・digest・provenanceへ結び付けることである。採用recordは、
source recordのrevisionとは別に、採用record全体の内容を表す意味付きlocatorを公開する。

## 公開契約

`src/knowledge-adapter.ts` は次を公開する。

- `LegacyKnowledgeRecordPort`: host-owned 記録の現在状態・ACL・exact locator・provenanceを読む
- `KnowledgeAdoptionReadPort`: host-owned adoption recordの意味付きlocatorを読むreadonly境界。書込みや本文返却はしない
- `KnowledgeConditionReferenceAdapter`: `attach` と `read` の最小port
- `GraphKnowledgeConditionAdapter`: personal canonical SSOT + sidecar の実装
- `KnowledgeAdapterError`: `validation_error`、`authorization_denied`、
  `source_unavailable`、`condition_conflict`、`condition_not_found`、`integrity_mismatch`、
  `store_corrupt`、`readback_mismatch` の機械可読コード
- `KNOWLEDGE_ADAPTER_SIDECAR`: `evidence/knowledge-condition-adapter.json`

対象記録のlocatorは、次の種類を受け付ける。

```text
knowledge_event | knowledge_feedback | candidate | candidate_promotion
graph_maintenance_plan | human_gate_receipt | graph_maintenance_receipt
meeting_bridge_event | meeting_bridge_candidate
```

条件は既存のDecision adapterと同じ構造を使う。

```ts
{
  problem_snapshot: { snapshot_id, problem_id, revision },
  method: { id, version },
  objective_refs: [{ id, type: "objective", revision }]
}
```

`source` は `kind` と `id` を必須とし、接続を作るにはproviderが正のrevisionと
`sha256:<64 lowercase hex>` digestを返さなければならない。呼出し側がrevisionまたはdigestを
指定した場合、providerの現在値と一致しなければ `integrity_mismatch` とする。条件・source・
adoptionの本文はこのportを越えない。

`KnowledgeAdoptionReference` は次の形で、`revision`を再利用しない。

```ts
{
  id: string,
  schema: string,       // host adoption recordの意味スキーマ。catalog versionではない
  contentDigest: string // 採用record全体のcanonical content identity
}
```

学習採用storeは `company-os-learning-adoption-record.v1` のschemaとrecord全体のdigestを
`LearningAdoptionLocator` として公開する。`readAdoptionByLocator` はlocatorのID・schema・
contentDigestを正本recordへ照合し、現在のACL、候補・検証record、採用targetのexact readbackを
通過した場合だけ返す。採用record内部のcatalog versionや採用targetのrevisionを、adoption
locatorとして外へ流用してはならない。

## providerと状態の独立

`LegacyKnowledgeRecordPort` が返す値は、次の軸を分ける。

- `source_status`: `present`、`quarantined`、`retracted`、`not_found`、`denied`
- `acl_status`: `allowed`、`denied`、`unknown`
- `source`: host-owned recordのexact locator
- `provenance`: 元証拠のlocator配列。本文や推測した不足値は含めない

正式な採用・共有・判断利用・ACLは同じ状態ではない。`KnowledgeAdoptionReadPort` は採用
recordの `id`・`schema`・`contentDigest`だけをreadonlyで返し、利用範囲と採用状態を表す。
共有範囲はACLとしてhost側で判定し、adapterは共有や判断利用の権限を採用状態から推論しない。
`recorded` なのにexact adoption locatorがない応答は不完全として `unavailable` にする。
ACL拒否、provider障害、exact locator欠落を成功や不在へ変換しない。

`quarantined` は「隔離された既存記録」であり、真実・採用・承認を意味しない。Human Gate、
candidate promotion、Graph maintenanceの承認結果は、それぞれhost-owned recordとして
参照するだけで、adapterが採用済みと推論してはならない。旧記録に条件sidecarがなければ、
本文・タイトル・provenanceから条件を補作せず `condition_status: "unrecorded"` と返す。

## attach / read

`attach(source, conditions, context, options?)` は次の順で動く。

1. source、条件、trusted host context、idempotency keyの形を検証する。
2. SSOTのcanonical aggregateとsidecarを読み、事前snapshotを作る。
3. SSOT lock外でrecord providerの現在ACL・source status・exact revision/digest・provenanceを読む。
4. `KnowledgeAdoptionReadPort` があれば同じくlock外でreadonly readし、exact adoption locatorだけを保持する。
5. sidecarの `kind + NUL + id` が未登録なら bindingを追加する。同じsource keyが既にあり、
   conditions、exact source、provenance、adoption、idempotency keyが全て同じ場合だけ
   `operation: "existing"` としてidempotentに返す。差分は `condition_conflict` とする。
6. lock内で事前snapshotとのCAS、sidecar schema、staged binding readbackを確認し、canonical
   4ファイルとsidecarを共通SSOT transactionで公開する。provider readやawaitをlock内で行わない。

sidecarのbindingは次のlocatorと監査情報だけを持つ。

```text
binding_id, idempotency_key, source,
source_status_at_attach, conditions, provenance, adoption?, legacy_adoption?, attached_at
```

現行`adoption`は`id/schema/contentDigest`のv2 locatorである。旧v1 sidecarに保存された
`id/revision/digest`は`legacy_adoption`として元の形を保持するだけで、v2 locatorへ再解釈
しない。旧bindingは明示的なmigrationまたは再attachまで採用・条件を検証済みとして返さない。

既存のknowledge本文、candidate本文、Meeting transcript、secret、tenant dataを複製しない。
同じsourceの別revision/digestは既存bindingを上書きせずconflictまたはintegrity mismatch
として扱う。

`read(source, context)` はproviderの現在ACL・source・provenanceを先に確認し、sidecarのlocator
と一致した場合だけ条件を返す。結果の意味は次の通り。

| 状態 | 意味 |
| --- | --- |
| `recorded` | 現在読めるsource・provenance・adoption（保存時に記録した場合）が一致し、条件を返せる |
| `unrecorded` | sourceは読めるが、条件bindingが存在しない。本文から補作しない |
| `denied` | sourceまたは保存したadoptionの現在ACLが拒否した。条件を成功として返さない |
| `unavailable` | ACL不明、retracted、exact locator不足、provider障害、adoption readback不足 |
| `integrity_mismatch` | 要求locator、現在source/provenance、保存locatorのいずれかが不一致 |

provider障害は `source_unavailable` error とし、`not_found` へ変換しない。providerが明示的に
`not_found` を返した場合のみ、read結果の `source_status` にその状態を保持する。

## 互換性・切替・切戻し

旧入口の会社HTTP routeをこの実装が直接呼ばない。組織adapterは
`LegacyKnowledgeRecordPort`／`KnowledgeAdoptionReadPort`へ適合させ、Knowledge Event、feedback、
candidate promotion、Graph maintenance、Human Gate、MeetingKnowledgeEventBridgeの各旧入口を
名前付きfixtureで固定し、経路ごとにread結果・current ACL・権限拒否を検証する。外部サービスや
社内runtimeの本番接続はこのOSS共通契約の必須条件ではない。adapter単独でOSSのpersonal SSOTへ
保存したbindingは、既存host recordの所有権や承認を変更しない。

経路の切替はhost側のport bindingで行い、失敗時は旧read経路へ戻せる。OSS adapterのsidecarを
削除・上書きして切替を表現せず、保存済みbindingは旧版のschemaとして読める期間を維持する。
現行実装はv1 sidecarを読み込み時にメモリ上のv2表現へ移すが、旧adoption locatorを
`legacy_adoption`として保持し、採用条件の検証済み状態へ昇格させない。新しい契約版を導入
するときも、既存版を黙って解釈し直さず、明示的なmigrationまたは旧版readbackを用いる。

## 検証

| 受入条件 | 検証 |
| --- | --- |
| AC-01 | 9種類のhost record locator、exact conditions、provenance、readonly adoption locatorのport適合fixtureと実store binding/readback |
| AC-02 | quarantineを採用済みと解釈しないこと、source/adoption ACL拒否、Human Gateやcandidate promotion本文の複製なし |
| AC-03 | provenanceを保持し、条件sidecarがない旧sourceを`unrecorded`として返すこと。本文からの補作なし |
| AC-04 | 各旧入口のport適合fixture、provider readback、current ACL、idempotent retry、別条件conflict、revision/digest mismatch、provider障害、canonical CAS conflict、SSOT transaction rollback、切替／切戻し境界 |

検証コマンドは `npm run build` と
`npx vitest run tests/knowledge-adapter.test.ts tests/company-os-learning-adoption.test.ts` とする。
この検証はOSSのadapter・port・personal storeの契約を示すもので、組織HTTP route、外部配備、
Mana transport、PR/CIの完了を示さない。

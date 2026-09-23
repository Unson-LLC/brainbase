# Company OS Knowledge Adapter v1 Spec

親Story: [`story-company-os-knowledge-adapter-v1`](../stories/story-company-os-knowledge-adapter-v1.md)

## 目的と範囲

既存の Knowledge Event、feedback、candidate、candidate promotion、Graph maintenance、
MeetingKnowledgeEventBridge の記録を、今回の判断に使った条件へ正確に辿れるようにする。
OSS が提供するのは、host-owned な既存記録を読む port と、条件・元証拠・採用記録の
locator だけを保存する personal canonical adapter である。既存の会社 runtime、承認
provider、tenant、RACI、Human Gate の判定をOSSへ移さず、旧HTTP routeや廃止経路も復活させない。

このSpecでいう「接続」は、既存記録の本文をGraphへ取り込むことや、採用・承認を自動化する
ことではない。`JudgmentProblem` の exact snapshot、判断方法の版、Objectiveの版を、既存
記録の安定したID・revision・digest・provenanceへ結び付けることである。

## 公開契約

`src/knowledge-adapter.ts` は次を公開する。

- `LegacyKnowledgeRecordPort`: host-owned 記録の現在状態・ACL・exact locator・provenanceを読む
- `KnowledgeAdoptionReadPort`: host-owned adoption recordを読むreadonly境界。書込みや本文返却はしない
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

## providerと状態の独立

`LegacyKnowledgeRecordPort` が返す値は、次の軸を分ける。

- `source_status`: `present`、`quarantined`、`retracted`、`not_found`、`denied`
- `acl_status`: `allowed`、`denied`、`unknown`
- `source`: host-owned recordのexact locator
- `provenance`: 元証拠のlocator配列。本文や推測した不足値は含めない

正式な採用・共有・判断利用・ACLは同じ状態ではない。`KnowledgeAdoptionReadPort` は採用
recordの `id`・revision・digestだけをreadonlyで返し、ACLはsource providerの現在判定に
委譲する。`recorded` なのにexact adoption locatorがない応答は不完全として
`unavailable` にする。ACL拒否、provider障害、exact locator欠落を成功や不在へ変換しない。

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
source_status_at_attach, conditions, provenance, adoption?, attached_at
```

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
`LegacyKnowledgeRecordPort`／`KnowledgeAdoptionReadPort`へ適合させ、経路ごとにread結果と
権限拒否を検証する。adapter単独でOSSのpersonal SSOTへ保存したbindingは、既存host recordの
所有権や承認を変更しない。

経路の切替はhost側のport bindingで行い、失敗時は旧read経路へ戻せる。OSS adapterのsidecarを
削除・上書きして切替を表現せず、保存済みbindingは旧版のschemaとして読める期間を維持する。
新しい契約版を導入するときも、既存版を黙って解釈し直さず、明示的なmigrationまたは旧版
readbackを用いる。

## 検証

| 受入条件 | 検証 |
| --- | --- |
| AC-01 | 9種類のhost record locator、exact conditions、provenance、readonly adoption locatorの実store binding/readback |
| AC-02 | quarantineを採用済みと解釈しないこと、source/adoption ACL拒否、Human Gateやcandidate promotion本文の複製なし |
| AC-03 | provenanceを保持し、条件sidecarがない旧sourceを`unrecorded`として返すこと。本文からの補作なし |
| AC-04 | provider readback、idempotent retry、別条件conflict、revision/digest mismatch、provider障害、canonical CAS conflict、SSOT transaction rollback |

検証コマンドは `npm run build` と `npx vitest run tests/knowledge-adapter.test.ts` とする。
この検証はOSSのadapter・port・personal storeの契約を示すもので、組織HTTP route、外部配備、
Mana transport、PR/CIの完了を示さない。

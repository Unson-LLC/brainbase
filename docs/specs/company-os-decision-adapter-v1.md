# Decision adapter v1 Spec

親Story: [`story-company-os-decision-adapter-v1`](../stories/story-company-os-decision-adapter-v1.md)

## 目的と範囲

既存の Decision 作成・AI decision-log の利用者が、今回の判断に使った Problem
snapshot、判断方法、Objective を同じ canonical Decision ID から辿れるようにする。
OSS が提供するのは、純粋な port/契約と personal canonical store adapter である。
旧 `/api/info/decisions`・`/api/info/ai/decision-log` の組織 HTTP route、tenant、RACI、
承認、旧社内 runtime の実組み込みは本Specの範囲外である。

## 公開契約

`src/decision-adapter.ts` は次を公開する。

- `DecisionAdapterPort`: `createDecision`、`createAiDecisionLog`、`readDecision`
- `DecisionAdapterStore`: canonical store の read/write 境界
- `GraphDecisionAdapterStore`: personal Graph SSOT を使う単独利用者向け実装
- `DecisionAdapterConditions`: `problem_snapshot`、`method`、`objective_refs` の必須束
- `DecisionAdapterConditionValidator`: snapshot/objective の現在 read ACL・存在確認を注入する境界
- `DecisionAdapterError`: 機械可読な `code`
- `DECISION_ADAPTER_SIDECAR`: `evidence/decision-adapter.json`

新規書込みの条件は次の構造である。

```ts
{
  problem_snapshot: { snapshot_id, problem_id, revision },
  method: { id, version },
  objective_refs: [{ id, type: "objective", revision }]
}
```

`snapshot_id` は `sha256:<64 lowercase hex>`、revision は正の十進表記、各 ID/版は空白を
含まない非空値とする。`objective_refs` は一つ以上を要求する。adapter は DAG/Objective
の本文を保存せず、必要なら `DecisionAdapterConditionValidator` に exact ref を渡す。
provider は現在の ACL と正本の存在を確認し、拒否または不明を成功に変換しない。

## Canonical write/read

`createDecision` は既存 `DecisionRecord` と Graph v2 の `type: decision` entity を同じ
`decision_id` で追加し、sidecar の `decisions[decision_id]` に条件参照を保存する。既存 ID
は conflict とし、更新や supersede は別契約に委譲する。canonical と sidecar の構造・条件・
認可は SSOT lock 内の commit 前に検証する。返却する `event_id` は互換 response の識別子で、
レスポンスは原子的 commit の acknowledgement であり、commit 後の current ACL/readback を
同じ書込みの失敗として再評価しない。canonical event store を新設しない。

`createAiDecisionLog` は `decision_id` を必須とする。AI log の summary、decision type、
rationale、confidence、references は sidecar の `ai_logs` に保持し、Graph entity kind や
Decision本文の複製を作らない。返却する `ai_decision_id` と `event_id` は旧 response の
形を維持する。

`readDecision` は canonical Decision と Graph entity の readback を確認し、記録された条件に
対して current authorization/ACL を別の読取りとして検証する。sidecar が
ない既存 record は、次のように返す。

```text
condition_status: "unrecorded"
conditions: undefined
authority_status: "unrecorded"
```

この場合、本文から Objective、権限、Problem を推測しない。sidecar がある場合も、記録
された参照が「現在も正しい」とはみなさず、validator の現在確認結果を経て返す。

書込みが commit された後に current ACL や認可が変わり、後続の `readDecision` が拒否されても、
既に commit された canonical/sidecar を巻き戻さない。読取り拒否は、保存の失敗や他の writer
の更新を示すものではない。

## 原子性・切戻し

canonical 4ファイルと sidecar は `mutatePersonalOsWithSidecar` 一回で commit する。sidecar
のschema不正、trusted validator／認可の拒否、Graph v1、既存ID、commit 前の staged
readback不一致は全て失敗し、新しい Decision、sidecar、互換 response を成功として残さない。
SSOT publish failure は共通 transaction recovery に委譲する。既存旧recordの read は sidecar
不在でも継続できる。commit 後の current ACL/readback 拒否は保存済みデータを巻き戻さず、
別の `readDecision` の結果として返す。

## 互換fixtureと検証

匿名化した旧 route fixture は `decision_id`/`event_id` と `ai_decision_id`/`event_id` の
response 必須キーを固定する。旧組織 routeを起動したことや、組織の認可結果を証明する
fixtureではない。

| 受入条件 | 検証 |
| --- | --- |
| AC-01 | 条件束と同じ Decision ID の create/readback、および AI log の関連付け |
| AC-02 | 条件欠落・不正参照の拒否、sidecarなし旧recordの `unrecorded`、推測なし |
| AC-03 | canonical Graph/Decision と sidecarの一回の原子commit、duplicate SSOTなし |
| AC-04 | 旧response fixture、commit前のvalidator拒否、SSOT publish failure後の全体rollback、およびcommit後のread拒否が保存を巻き戻さないこと |

検証コマンドは `npm run build`、`npx vitest run tests/decision-adapter.test.ts` とする。
OSS adapter単独と契約fixtureの検証が完了しても、組織版既存 HTTP route への実組み込み・
外部配備・PR/CI完了を示さない。

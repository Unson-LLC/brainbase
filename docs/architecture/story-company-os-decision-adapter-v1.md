# ADR: OSS Decision adapter の所有境界

- 状態: 採用
- 日付: 2026-09-23
- 親Story: `story-company-os-decision-adapter-v1`

## 決定

OSS は、既存の canonical Decision と Graph entity を同じ Decision ID で扱う
`DecisionAdapterPort` と、単独利用者向けの canonical store adapter を所有する。
Decision の本文は既存の `decisions.jsonl`、Graph 上の対象は既存の `graph.json` が
正本である。Problem snapshot、DAG 版、Objective 版は定義を複製せず、
`evidence/decision-adapter.json` sidecar に不変参照だけを保存する。

新しい書込みには、Problem snapshot、判断方法の ID/版、Objective の ID/版を明示的に
要求する。adapter は参照の形と一致を検証し、提供された trusted validator がある場合は
現在の read ACL と正本への存在確認を委譲する。Objective や権限を Decision の本文、
Graph の名前、caller の任意フラグから推測しない。

旧形式の Decision と AI decision-log は読み出せる。条件 sidecar が存在しない旧記録は
`condition_status: unrecorded` として返し、Objective・authority の値を補完しない。
AI log は canonical Graph に新しい entity kind を追加せず、既存 Decision ID に結びつく
sidecar の互換メタデータとして保持する。

組織版の HTTP route、tenant、RACI、承認、旧社内 runtime、外部サービスは OSS の責務に
含めない。組織側はこの port に trusted provider を注入する。今回の実装は旧 route の
レスポンス形を確認する匿名 fixture と OSS の純粋な adapter/store を提供するが、既存
組織 route への組み込みは行わない。

## 保持する境界

```text
legacy-compatible request
        |
        v
DecisionAdapterPort -- required refs --> DecisionAdapterStore
        |                                    |
        |                                    +-- decisions.jsonl (Decision SSOT)
        |                                    +-- graph.json (canonical Graph SSOT)
        |                                    +-- evidence/decision-adapter.json (atomic refs only)
        |
        +-- trusted condition validator (optional provider boundary)
```

- Decision の新規書込みと条件 sidecar は、既存 SSOT lock/transaction で一つに commit する。
- Graph v1 は旧読み出しを許すが、新規 canonical Decision 書込みは Graph v2 を要求する。
- 同じ Decision ID の既存 record がある場合は上書きせず、revision/更新契約がないため拒否する。
- sidecar の破損、canonical readback の不一致、trusted provider の拒否は fail closed とする。
- `event_id` と `ai_decision_id` は互換 response/証跡識別子であり、別の canonical Decision
  正本を作らない。

## 切戻し

既存の Decision record と旧読み出しは保持する。新しい adapter が使えない場合は
sidecar を参照しない旧 read を続けられる。sidecar と canonical aggregate の更新失敗は
共通 transaction recovery に委譲し、途中状態を成功として返さない。

## 却下した案

- 旧組織 route や `info-ssot` controller を OSS にコピーする: tenant/RACI と runtime の
  所有境界が混ざり、廃止経路を復活させるため。
- Objective/Problem/DAG の本文を Decision sidecar にコピーする: 二重正本となり、版の
  readback と更新追跡を壊すため。
- `ai_decision` を Graph の新しい entity kind として追加する: 現行 ontology の意味を
  変更し、旧 response 互換のために canonical Graph を拡張する必要がないため。

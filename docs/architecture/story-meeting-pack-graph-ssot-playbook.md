# Meeting Pack Decision Approval Pairing Architecture

## Decision

Meeting Pack の `decision_candidates` protected output は、同一 workflow run 内で生成される `graph_ssot_decision` human approval step に metadata として `output_id`, `output_key`, `output_type`, `approval_kind` を付与する。Mac Companion approval inbox はこの metadata を使い、Decision 候補を `output_only` ではなく承認可能な human step として扱う。

## Boundary / Scope / Owner

Boundary は `server/services/meeting-automation/meeting-automation-service.js` の review-ingest run assembly と Mac Companion inbox route の read model に限定する。責務 owner は MeetingAutomationService が output と human step の対応を確定し、Companion inbox は保存済み metadata を読むだけにする。People SSOT owner resolution や Graph SSOT glossary/project resolution の判断ロジックはこの変更の scope 外であり、副作用 side effect を持たせない。

## Alternatives Considered

Alternative 1: Companion inbox 側で `write_back_target` から output を推測する案は、read model に workflow assembly の責務が漏れるため rejected。

Alternative 2: `decision_candidates` を output_only のまま別カードで表示する案は、承認導線がなくユーザー要望を満たさないため rejected。

Chosen option は、workflow creation 時に protected output と human step を明示的に pairing する設計である。

## Compatibility Impact

Compatibility impact は additive。既存の output payload, API contract, DB schema, CLI behavior は変更しない。追加 metadata は backward compatible で、古い run に metadata がない場合は従来通り output_only または未ペア扱いになる。Migration は不要。

## Rollback Plan

Rollback は該当 service/test commits を revert する。DB migration や operator action は不要。metadata 追加のみなので rollback 後も既存 Meeting Pack outputs は読み取り可能である。

## Execution Topology

Execution topology は既存の review-ingest -> protected output creation -> human step creation -> companion inbox read path のままにする。新しい worker, queue, retry, external side effect は追加しない。artifact lifecycle は one workflow run 内で `write_back_target` lookup により決定する。

## Accepted Followups

Accepted followups はなし。Graph SSOT project/person resolution の精度改善は別 story の責務として defer する。この PR の non-blocking follow-up にはしない。

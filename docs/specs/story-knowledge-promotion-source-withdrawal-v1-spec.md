# 元の記憶の撤回による共有の取消 v1 仕様

Story: `docs/stories/story-knowledge-promotion-source-withdrawal-v1.md`
実装: `src/knowledge-promotion.ts`（`KnowledgePromotionService.withdrawPersonalShares`）
前提: `docs/specs/story-knowledge-promotion-common-v1-spec.md`

## 状態

`source_withdrawn`（取消済み）を終わりの状態に加える。次の状態からだけ移る。

| 取消前 | 取消後 | Graph |
|---|---|---|
| `pending_owner_approval` | `source_withdrawn` | 触らない |
| `pending_org_review` | `source_withdrawn` | 触らない |
| `org_accepted` | `source_withdrawn` | `graph.withdrawPromotedEntity` で撤回済み・検索対象外にする |

`owner_rejected`、`org_rejected`、`source_stale`、`source_withdrawn` は取消の対象にしない（そのまま残す）。

## 入口

`withdrawPersonalShares({ personal_event_id, reason? }, { principal, tx? })` → `{ personal_event_id, withdrawals: KnowledgePromotionWithdrawal[] }`

- `tx` を渡すと、その中で実行する（組立て側は撤回の記録と同じトランザクションで呼ぶ）。渡さなければ `store.transaction` を開く。
- 戻り値の `withdrawals` は、この呼び出しで取り消した申請だけ。再試行では空になる。

## 不変条件

- WD-1（本人だけ）: 主体は人で、`sources.readPersonalKnowledgeEvent` が返す記憶の `owner_person_id` と `organization_id` が主体と一致するときだけ取り消す。一致しない・見つからないときは `knowledge_promotion_source_not_found`（404）。サービス主体は `knowledge_promotion_human_principal_required`（403）。
- WD-2（撤回の後だけ）: 記憶がまだ有効（`active: true`）なら `knowledge_promotion_source_still_active`（409）で止め、何も書かない。
- WD-3（審査規則に諮らない）: 取消は本人の権利であり、`reviewPolicy` を呼ばない。`reviewPolicy` が無くても、プロジェクトの権限が無くても取り消せる。
- WD-4（申請の取得）: `store.listRequestsBySource('personal_knowledge_v1', id, ctx)` で、主体が読める申請を取る。組立て側は、承認と順番が付くように行を押さえて返す（PostgreSQLでは `FOR UPDATE`）。`owner_person_id`・`organization_id` が主体と違う申請は無視する。
- WD-5（Graphの取り下げ）: `org_accepted` の申請では、状態を変える前に `graph.withdrawPromotedEntity({ request_id, graph_entity_id, organization_event_id, organization_id, project_code, normalized_payload_hash, withdrawal_id, withdrawn_at, reason }, ctx)` を呼ぶ。`{ id, outcome: 'retracted' | 'projection_replaced' }` が返らなければ `knowledge_promotion_graph_withdrawal_failed`（409）で止め、例外で全体を戻す。`projection_replaced` は、Graphの事実が別の書込みで置き換わっていて、この申請の事実ではなくなっていたことを表し、その事実は書き換えない。
- WD-6（取消の記録）: 申請ごとに `store.recordWithdrawal` へ追記する。`withdrawal_id` は `kpw_` ＋ 申請ID・元の版から決まる値。承認の系譜（`createLineage`）は呼ばない。
- WD-7（決定の履歴）: 申請の `decisions` に `{ action: 'source_withdrawal', decision: 'withdraw', actor_person_id, decided_at, receipt_id: withdrawal_id, reason }` を足す。状態の更新は `expected_revision` で行い、版が違えば `knowledge_promotion_state_conflict`（409）。
- WD-8（取消済みの申請）: `decideOwnerConsent` と `reviewOrganization` は、取消済みの申請に `knowledge_promotion_source_withdrawn`（409）を返す。同じ判断の再試行でも、取消済みを承認済み・却下済みとして返さない。
- WD-9（理由）: `reason` は500文字までで、秘密・メールアドレス・個人のパスを含めば `knowledge_promotion_requires_safe_reason`（400）。

## 差し込み口（追加）

- `store.listRequestsBySource(sourceKind, sourceId, ctx)` → `KnowledgePromotionRequest[]`
- `store.recordWithdrawal(withdrawal, ctx)` → `void`
- `graph.withdrawPromotedEntity(input, ctx)` → `{ id, outcome } | null`（`org_accepted` の申請があるときだけ要る）

どれも任意の差し込み口で、要るときに無ければ `knowledge_promotion_withdrawal_unavailable`（503）で止める。

## シナリオ

- W-1: 本人承認前・組織レビュー待ちの申請は、撤回の後の取消で `source_withdrawn` になり、Graphへ書かない。後の本人承認・組織レビューは409。
- W-2: 承認済みの申請は、取消でGraphの事実を取り下げてから `source_withdrawn` になる。系譜と組織の知識イベントは残る。
- W-3: Graphの取り下げが失敗すると、状態も取消の記録も残らない。
- W-4: まだ有効な記憶、他人・別組織の記憶、サービス主体では取り消せない。審査規則が無くても、プロジェクトの権限が無くても本人は取り消せる。
- W-5: 撤回が先に確定すると、承認は409で拒否され何も書かない。承認が先に確定すると、その後の取消でGraphから取り下げる。
- W-6: 呼び出し側の `tx` の中で実行でき、再試行は空の結果を返して二重に記録しない。却下済み・古い版の申請はそのまま残る。
- W-7: 理由に秘密やメールアドレスがあれば取り消さない。

## 検証

- `npm run build`
- `npx vitest run tests/knowledge-promotion.test.ts tests/graph-core-package-exports.test.ts`

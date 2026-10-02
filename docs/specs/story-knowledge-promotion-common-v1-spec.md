# 共通昇格処理 v1 仕様

Story: `docs/stories/story-knowledge-promotion-common-v1.md`
実装: `src/knowledge-promotion.ts`（package出口 `@unson/brainbase-mcp/knowledge-promotion`）

## 承認の種類と状態

| 承認の種類 | 元 | 状態の流れ |
|---|---|---|
| `personal_share` | 個人KG v1のイベント（`personal_knowledge_v1`） | `pending_owner_approval` →（本人承認）`pending_org_review` →（組織レビュー承認）`org_accepted` |
| `organization_candidate` | 組織の候補（`organization_candidate`） | `pending_org_review` →（組織内承認）`org_accepted` |

終わりの状態は `owner_rejected`、`org_rejected`、`org_accepted`、`source_stale`、`source_withdrawn`（本人が元の記憶を撤回して取り消した。`docs/specs/story-knowledge-promotion-source-withdrawal-v1-spec.md`）。`org_accepted` からは取消でだけ `source_withdrawn` へ移る。終わりの状態から他の状態へは移らない。同じ判断の再試行だけは、今の状態をそのまま返す。

## 不変条件

- INV-1（本人の承認）: `personal_share` は `pending_owner_approval` で本人承認を受けるまで組織レビューへ進まない。本人承認の主体は申請の `owner_person_id` と同じ人、同じ組織に限る。本人承認は、申請に保存した `normalized_payload_hash` と一致するハッシュを伴うときだけ受け付ける。
- INV-2（組織の承認）: `org_accepted` とGraphへの書込みは、差し込まれた `reviewPolicy.authorize` が許可を返したときだけ起きる。`reviewPolicy` が無ければ `knowledge_promotion_review_policy_unavailable`（503）で止まる。主体が人（`principalType: 'person'`）でなければ承認・申請とも拒否する。`personal_share` の組織レビューで主体が本人と同じなら拒否する。
- INV-3（出所を装わない）: `organization_candidate` への本人承認は `knowledge_promotion_owner_consent_not_applicable`（409）で拒否する。組織の知識イベントには承認の種類を記録し、組織候補に `owner_consented: true` を付けない。
- INV-4（却下）: `reject` は終わりの状態へ移り、知識イベント・Graph・系譜を書かない。
- INV-5（版）: 承認の直前に元を読み直す。元が無い、有効でない、または版が申請時と違えば、申請を `source_stale` にしてGraphへ書かず、`knowledge_promotion_source_stale`（409）を返す。
- INV-6（同一トランザクション）: 承認時の知識イベント記録、Graph書込み、系譜、申請の更新は、`store.transaction` の中で同じ `tx` を渡して行う。どれかが失敗すれば例外を返し、呼び出し側のトランザクションごと戻る。
- INV-7（原文を越境させない）: 正規化は既存の `personal_knowledge_normalized.v1` と同じ規則で行う（本文・原文・会話・プレビュー等の欄名、秘密・メールアドレス・個人のパスを拒否）。Graph変更案と組織の知識イベントには正規化済みの内容とハッシュだけを入れ、要約・原文を入れない。系譜の `sanitization` は `raw_copied: false`、`personal_body_copied: false`、`sanitized_preview_copied: false` とする。
- INV-8（冪等と版の照合）: `request_id` は承認の種類・元の種類とID・元の版・プロジェクト・正規化済みの内容のハッシュから決まる。同じ申請の再試行は同じ申請を返す。判断は `expected_revision` を要し、今の `revision` と違えば `knowledge_promotion_stale_revision`（409）で止める。署名つき権限を持つ呼び出しでは、`store.claimAuthorityUse` で同じ権限の二度使いを止める。
- INV-9（受領記録の互換）: `personal_share` の本人承認の受領記録（`pkoc_`）と組織レビューの受領記録（`pkor_`）は `brainbase-unson` の `personal-knowledge-normalization.js` と同じ入力・同じ計算で作る。組織候補の承認は別の接頭辞（`pkca_`）で、承認の種類と元の版を入力に含める。

## 差し込み口

- `store`: `transaction(work)`、`createRequest(request, ctx)`（同じ `request_id` の既存を返す）、`findRequest(requestId, ctx)`、`updateRequest(requestId, patch, { expectedRevision }, ctx)`（版が違えば `null`）、`createLineage(lineage, ctx)`、任意で `claimAuthorityUse(use, ctx)`。
- `sources`: `readPersonalKnowledgeEvent(eventId, ctx)` → `{ event_id, owner_person_id, organization_id, body_hash, version, active }`、`readOrganizationCandidate(candidateId, ctx)` → `{ candidate_id, organization_id, project_code, version, active, evidence_hash, source_event_ids }`、`recordOrganizationCandidateOutcome(outcome, ctx)`（組織候補の承認・却下を元の候補へ反映する）。
- `reviewPolicy`: `authorize({ action, approvalKind, request, source, normalized, principal, authority }, ctx)` → `{ allowed: true, decider_person_id? }` または `{ allowed: false, code, status? }`。`action` は `request`、`owner_consent`、`organization_review`。
- `knowledgeEvents`: `recordOrganizationEvent(event, ctx)` → `{ event_id, candidate_id?, semantic_state, quarantine_reason? }`、任意で `reconcileGraphProjection(input, ctx)`。
- `graph`: `commitNormalizedPromotion(mutation, ctx)` → `{ id }`。

`ctx` は `{ tx, principal }`。`principal` は `{ personId, actorPersonId?, organizationId, projectCodes, role?, principalType }` で、認証済みの文脈から組立て側が作る。

## シナリオ

- S-1: 本人がv1のイベントから申請→本人承認→別人のGMが承認すると、知識イベント・Graph・系譜が一度だけ書かれ、`org_accepted` になる。
- S-2: 本人承認の前に組織レビューを送ると `knowledge_promotion_owner_consent_required`（409）で止まり、何も書かない。
- S-3: 本人が却下すると `owner_rejected` になり、その後の組織レビューは拒否される。組織が却下すると `org_rejected` になりGraphへ書かない。
- S-4: 他人のイベント、別組織のイベント、秘密やメールアドレスを含む要約・正規化済み内容は申請できない。
- S-5: 審査規則が拒否・未設定、主体がサービス、本人と同じ人の組織レビューは、どれもGraphへ書かない。
- S-6: 組織候補は申請→組織内承認でGraphへ入り、元の候補へ承認結果が記録される。本人承認は拒否される。昇格レビュー待ちでない候補、別プロジェクトの候補は申請できない。
- S-7: 承認の直前に元の版が変わっている・撤回されていると `source_stale` になりGraphへ書かない。
- S-8: 同じ申請・同じ判断の再試行は一度しか書かず、古い `expected_revision` は409になる。
- S-9: 個人共有の受領記録は既存の二段階昇格と同じ値になる。

## 検証

- `npm run build`
- `npx vitest run tests/knowledge-promotion.test.ts tests/graph-core-package-exports.test.ts`

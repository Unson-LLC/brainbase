---
spec_id: spec-g0-human-approval-authority-guard
story_id: story-g0-human-approval-authority-guard
status: accepted
---

# Spec: G0人承認の権限条件

`CompanyAuthorityHumanApprovalService` は、署名済みCompany Authority文脈の `authority.decision` が `approval` であり、`accountable_person_id` と `approver_person_id` が空でない場合だけ人承認bindingを作る。

承認時のfresh resolveにも同じ条件を適用する。条件を満たさない場合は、workflow状態を変更せず、承認receiptを発行・消費しない。

既存bindingの形式、署名検証、対象承認者、revision一致、TTL、一回消費の契約は変更しない。

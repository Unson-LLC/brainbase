# Story: G0の人承認をCompany Authorityへ拘束する

Brainbase運用者として、agentレポートの人承認を、Company Authorityが人承認を要求し、実行責任者・最終責任者・承認者を特定できる場合だけ受け付けたい。これにより、自動許可や責任者不在の権限文脈を、人の承認として誤って実行しない。

## 受け入れ条件

- [x] `authority.decision=approval` 以外の文脈から人承認stepを作らない。
- [x] `accountable_person_id` または `approver_person_id` が欠ける文脈から人承認stepを作らない。
- [x] 承認時の再解決でも同じ条件を満たさない限り、receiptを発行・消費しない。
- [x] 正しい人承認文脈の署名、対象者、revision、TTL、一回消費の既存契約を維持する。

- Spec: [docs/specs/story-g0-human-approval-authority-guard-spec.md](../../../specs/story-g0-human-approval-authority-guard-spec.md)

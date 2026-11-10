---
story_id: story-canonical-task-create-audit-atomic-v1
title: Task作成と監査を同一DBトランザクションで確定する
status: active
period: 2026Q4
spec: docs/specs/story-canonical-task-create-audit-atomic-v1-spec.md
business_metric: 作成成功かつ監査欠落となるTask件数を0にする
created_at: 2026-10-20
updated_at: 2026-10-20
---

# Task作成と監査を同一DBトランザクションで確定する

## 背景

`brainbase-organization` のworker Task作成Spec（`story-worker-task-create-v1-spec.md` 5項）は、Task作成と監査書込みを同一DBトランザクションで行うことを求める。現行のOSSカーネル `CanonicalTaskService.createTask` は、`executeOperation` の外で `auditRepository.upsertAuditLog` を呼ぶため、TaskのINSERTと監査のINSERTは別トランザクションになる。監査書込みが失敗した場合、Taskは作成済みのまま503を返し、成功にも失敗にも丸められない状態が残る。

## 誰が・何を・なぜ

agent credentialでTaskを作るworkerと、その監査を読む運用担当者は、Taskが作成されたなら監査行も同じ確定境界に存在することを求める。反対に監査が書けない場合はTask自体を残したくない。これにより「作成成功・監査欠落」という追跡不能な状態をなくす。

## 代表シナリオ

- 監査書込みが成功すれば、Taskと監査行が同じトランザクションでcommitされ、作成応答が返る。
- 監査書込みが失敗すれば、TaskのINSERTもrollbackされ、`task_audit_unavailable`（503）だけが返る。Taskは存在しない。
- 監査sinkがトランザクションclientを受け取れない構成では、従来どおり「作成後に監査」となり、監査失敗時は503を返す（成功に丸めない）。
- 同じidempotency keyの再送では、既存Taskを返し、監査のupsertは従来どおり再試行される。

## 受け入れ基準

- [ ] repository が `createWithAudit` を実装し、audit sink が `supportsTransactionClient: true` を宣言した場合、Task INSERTと監査INSERTは同じDBトランザクションで実行される。
- [ ] その構成で監査がthrowした場合、Taskは永続化されず、呼出しは `task_audit_unavailable`（503）で失敗する。
- [ ] 能力を持たないrepositoryまたはaudit sinkでは、既存の挙動（作成後に監査、監査失敗時503）を維持する。
- [ ] 公開Task payload、idempotency key、既存interfaceの意味は変わらない（追加のみ）。
- [ ] 再送・recovery経路でも監査は各呼出しで記録される。
- [ ] targeted test、typecheck、buildがHEADで成功する。

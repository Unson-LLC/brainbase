# Canonical Task 作成と監査の同一トランザクション Spec

## Public behavior

`CanonicalTaskService.createTask` は、次の両方を満たす構成では、TaskのINSERTと監査行のINSERTを一つのDBトランザクションで確定する。

- `repository.createWithAudit` が関数として存在する
- `auditRepository.supportsTransactionClient === true`

この構成で監査書込みが例外を投げた場合、TaskのINSERTはrollbackされ、呼出しは既存の監査エラー `task_audit_unavailable`（503、detailsなし）で失敗する。Taskは読み戻せない。

上記のどちらかを満たさない構成では、既存の挙動を変えない。Task INSERTのcommit後に監査を書き、監査失敗時は `task_audit_unavailable`（503）を返す。作成成功を成功として返さない。

## Interface additions

```ts
export interface CanonicalTaskTransactionClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface CanonicalTaskRepository {
  // 既存メソッドは不変
  createWithAudit?(
    input: JsonRecord,
    runAudit: (created: CanonicalTaskRecord, client: CanonicalTaskTransactionClient) => Promise<void>,
    storageScope?: string,
  ): Promise<CanonicalTaskRecord>;
}

export interface CanonicalTaskAuditRepository {
  supportsTransactionClient?: boolean;
  upsertAuditLog(
    entry: CanonicalTaskAuditEntry,
    options?: { client?: CanonicalTaskTransactionClient },
  ): Promise<void>;
}
```

追加はoptionalに限定し、既存の実装・呼出しはそのまま動く。

## Transaction contract

- transaction境界は `repository.createWithAudit` が所有する。repositoryは同一clientで Task INSERT → `runAudit(created, client)` → COMMIT の順に実行し、`runAudit` がthrowしたらROLLBACKする。
- `runAudit` に渡す `created` は、INSERTが返した行を既存の `normalizeResponse` に通したものと同一の内容で監査する。
- 監査entryの `id` は既存の決定的な値（`canonical-task:<fingerprint>`）を維持し、再送時に同じ行をupsertする。
- operation coordination（`executeOperation`）の状態遷移は変更しない。transactionの外側で従来どおり成功/失敗を記録する。
- recovery/replayでTaskが既に存在する場合は `runAudit` を呼ばない。その呼出しの監査は従来どおり `executeOperation` の後に実行する。

## Failure mapping

| 失敗位置 | 期待結果 |
| --- | --- |
| `runAudit` が `CanonicalTaskError` を投げる | そのエラーをそのまま返し、Taskはrollback |
| `runAudit` が任意のErrorを投げる | `task_audit_unavailable`（503、detailsなし）に変換し、Taskはrollback |
| Task INSERTが失敗 | 既存どおり `task_store_unavailable`（503） |
| 能力を持たない構成で監査が失敗 | 既存どおり `task_audit_unavailable`（503）。Taskは残る |

## 非対象

- WorkOSとDBをまたぐ原子性は扱わない。
- `update` / `transition` / `delete` の監査原子性は本Specの対象外とし、既存挙動を維持する。
- 新しい監査テーブルやBFFの監査イベントは追加しない。

# Company OS execution registration v1

対象Story: [story-company-os-execution-registration-v1](../stories/story-company-os-execution-registration-v1.md)。既存の [company-os-execution-authority-v1](./company-os-execution-authority-v1.md) と [company-os-execution-authority-http-v1](./company-os-execution-authority-http-v1.md) に、登録・報告・帰属・保存先のportを足す。既存の `start` の振る舞いは変えない。

## 帰属

```ts
type ExecutionAttributionMode = 'person' | 'delegated_service' | 'service';

interface ExecutionAttribution {
  mode: ExecutionAttributionMode;
  servicePrincipal?: string;
  delegationRef?: string;
  correlationId?: string;
}
```

| mode | 意味 | 必須 | 禁止 |
|---|---|---|---|
| `person` | 本人が直接開始した | なし | `servicePrincipal`、`delegationRef` |
| `delegated_service` | サービスが本人の代わりに開始した | `servicePrincipal`（`principal`と異なる）、`delegationRef` | なし |
| `service` | 自動ジョブが自分の権限で開始した | `servicePrincipal`（`principal`と同じ）、`delegationRef`（権限の根拠） | なし |

- 帰属は `start(input, { attribution })`・`register(input, { attribution })` のoptionsと、HTTPの `TrustedExecutionAuthorityRequestContext.attribution` からだけ受け取る。HTTP本文の `attribution` は未知の欄として400にする。
- 規則に合わない帰属は、serviceでは `validation_error`、HTTPの文脈では401にする。
- 帰属は、検査port（`ExecutionCheckRequest.attribution`）と許可（`ExecutionStartCapability.attribution`）へ渡し、記録（`ExecutionIntentRecord.attribution`）へ残す。
- 同じ実行IDでの再送で、保存済みの帰属と違えば `operation_conflict` にする。帰属が無い既存の記録には、帰属の無い再送だけが一致する。

## 登録

`register(input, options?) → { intent, capability, capabilityDigest, replayed }`

1. read権限の検査、既存の記録の確認、初回の検査、記録の作成、最終の検査（revisionのfencing）、予約の開始印までは `start` と同じとする。
2. 開始印の後、状態を `registered`、`reservationMark` を `started`、`effect.status` を `not_started` にする。許可の中身は記録の内部欄（`capability.grant`）に残す。
3. 外部作用portは呼ばない。`effect` は任意のportとし、未設定で `start` を呼べば `effect_unconfigured` にする。

同じ実行IDでの再送：

| 保存済みの状態 | 結果 |
|---|---|
| `registered` で、許可が有効期限内 | 保存済みの許可を `replayed: true` で返す |
| `registered` で、許可が期限切れ | `capability_expired` |
| `started`／`unknown`（報告済み）で、許可が残っている | 保存済みの許可を `replayed: true` で返す |
| `rejected` | 保存済みの失敗 |
| その他 | `recovery_required` |

返す記録と `readIntent` の結果には、`capability.grant` を含めない（`capability` は `expiresAt` と `digest` だけ）。

## 作用結果の報告

`reportEffect({ operationId, tenantId, principal, scopeId, capabilityDigest, status: 'started' | 'unknown' }) → intent`

- read権限を検査し、tenant・本人・scopeが記録と一致しなければ `scope_mismatch`、`capabilityDigest` が記録の `capability.digest` と違えば `capability_mismatch` とする。digestは発行した許可への束縛であり、秘密ではない。
- 状態の遷移：

| 現在 | `started` の報告 | `unknown` の報告 |
|---|---|---|
| `registered` | `started` | `unknown`（`failure.code = effect_unknown`） |
| `unknown` | `started`（照合による再開） | 変えずに返す |
| `started` | 変えずに返す | `operation_conflict` |
| その他 | `recovery_required` | `recovery_required` |

## 保存先のport

```ts
interface ExecutionIntentStore {
  initialize?(): Promise<void>;
  read(key: { tenantId: string; operationId: string }): Promise<ExecutionIntentRecord | undefined>;
  insert(intent: ExecutionIntentRecord): Promise<{ intent: ExecutionIntentRecord; created: boolean }>;
  update(
    key: { tenantId: string; operationId: string },
    mutate: (current: ExecutionIntentRecord) => ExecutionIntentRecord,
  ): Promise<ExecutionIntentRecord | undefined>;
}
```

- `insert` は、同じkeyが無ければ保存して `created: true`、あればそのまま返して `created: false` とする。keyごとに不可分に行う。
- `update` は、同じkeyの記録を読み、`mutate` の結果を不可分に書く。記録が無ければ `undefined` を返す。`mutate` が例外を投げたら書かずに、その例外をそのまま返す。
- serviceは、保存先から受け取った記録をすべて検査し、形が崩れていれば `ledger_invalid` にする。`ExecutionAuthorityError` 以外の保存先の失敗は `store_unavailable` にする。
- `ExecutionAuthorityServiceOptions` は `store` または `dataDir` を受け取る。`store` が無ければ `createSidecarExecutionIntentStore({ dataDir, sidecarPath })` を使う。

## HTTP

| method | path | body | service |
|---|---|---|---|
| POST | `/execution-authority/register` | `ExecutionStartInput` | `register` |
| POST | `/execution-authority/intents/{operationId}/effect` | `{ status, capabilityDigest }`（本人・tenant・scopeの別名は文脈と一致する場合だけ可） | `reportEffect` |

- 成功時はそれぞれ `{ action: 'register', operationId, result }`、`{ action: 'report_effect', operationId, result: { intent } }` を返す。
- どちらも変更として扱い、変更元の検証を通す。
- service factoryが `register`・`reportEffect` を持たない場合は、501 `operation_unconfigured` を返す。
- 新しい誤りの対応：`store_unavailable` は503、`capability_mismatch` は403、`effect_unconfigured` は501。

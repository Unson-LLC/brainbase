# Company OS execution authority v1

## 目的

予約済みの実行でも、作用を開始する直前に現在の権限・承認・制約・予約状態を再検証する。失効や不明を許可へ丸めず、外部作用の開始が不明になったときは未実行として再試行しない。

## 境界

`@unson/brainbase-mcp/execution-authority` は、実行開始契約、実行意図の永続化、現在値を返す検証port、予約台帳adapter、作用portを公開する。

- 組織のauthority・承認・制約の内容、RACI、tenantの実装は組織側providerが所有する。
- 実際の外部作用はManaなどの実行側が所有する。OSSの `ExecutionEffectPort` は試験では副作用なしのadapterを注入する。
- Problem snapshot参照は判断時点の証跡であり、実行許可やgrantではない。実行前の各providerが現在の判断を返す。
- 予約台帳は既存の `ResourceReservationService` を使う。実行側のsidecarから同じSSOT lockへ再入せず、二つのsidecar transactionを一つのatomic transactionとは主張しない。

## 公開API

主な型と入口は次のとおり。

- `ExecutionAuthorityService.start(input)`
- `ExecutionAuthorityService.readIntent(input)`
- `ExecutionAuthorityError` と `ExecutionAuthorityErrorCode`
- `ExecutionAuthorityPort`、`ExecutionApprovalPort`、`ExecutionConstraintPort`、`ExecutionReservationPort`
- `ExecutionReadAccessPort`
- `ExecutionEffectPort`
- `createResourceReservationExecutionPort({ service })`

`ExecutionStartInput` は `operationId`、`tenantId`、`principal`、`scopeId`、`runId`、`reservationId`、`approvalId`、`authorityRef`、`constraintRefs`、固定Problem snapshot参照を持つ。`readIntent` と既存operationの再送は、保存principalの一致だけでなく、`ExecutionReadAccessPort` の現在read ACLを必ず通す。Manaへ渡す `ExecutionEffectPort.start` の入力にも同じ安定した `operationId` を含める。

## 開始手順

`start` は次の順序で動く。

1. 入力とProblem snapshot参照を検証し、payload digestを計算する。
2. authority、承認、制約、予約の現在値を `initial` phaseで読む。providerの失効、期限切れ、不明、欠落はfail closedする。
3. 現在の検証結果と安定した操作IDを、既存canonical SSOT lock/transactionで `execution-authority/intents.json` へ保存する。保存直後のphaseは `recovery_required` であり、プロセスがここで止まっても自動再試行しない。
4. 作用直前に4つのproviderを `final` phaseで再検証する。初回のrevisionを `expectedRevision` として渡し、revisionが変わったら `revision_conflict` で止める。各providerは期限付きopaque `fencingToken` と `expiresAt` も返す。欠落・期限切れは `fencing_unsupported` または `capability_expired` として止める。
5. 最終検証のrevision・fencing token・期限から `ExecutionStartCapability` を作り、作用portへ渡す。final検証後にauthorityが変わるraceは、作用側がこのcapabilityを自身の開始境界で検証・消費して拒否する契約で閉じる。作用側がこの機能を提供できない場合はfail closedする。
6. 予約providerへ `expectedRevision` を渡して開始印を付ける。既存のResourceReservationServiceは現在の台帳と認可を自身のSSOT lock内で再確認し、ここが予約状態の線形化点になる。予約の線形化点をauthority・承認・制約全体の線形化点とは扱わない。印の失敗や不明は `recovery_required` として残す。
7. 予約開始後、sidecarへ `reservation_marked` と `effect: unknown` を保存してから `ExecutionEffectPort.start` を一度だけ呼ぶ。
8. 作用側がcapabilityを検証・消費して `started` を返したら、sidecarを `started` へ更新する。作用側が不明を返す、または呼出し後にプロセスが落ちる可能性がある場合は `unknown` として照合待ちにする。

予約sidecarと実行意図sidecarの間に分散atomic commitはない。したがって、予約印の後に実行意図の更新が失敗する状態、作用開始後に完了印が保存されない状態を `recovery_required` または `unknown` として残す。これらの状態を未実行へ戻す自動再試行、実作用のexactly-once、外部作用の取消しは契約しない。

## 保存と再試行

実行意図は次の状態を持つ。

- `recovery_required`: 作用境界へ進む前後の状態を照合する必要がある。
- `reservation_marked`: 予約開始済み。作用結果はまだ不明として扱う。
- `started`: 予約と作用開始が確認済み。同一payload・同一scopeで、現在read ACLを通った再試行は保存済み結果を返し、providerや作用を再実行しない。
- `unknown`: 作用側の結果が不明。照合前の再実行を拒否する。
- `rejected`: 現在の検証拒否またはrevision競合を保持する。

同じtenantの同じ `operationId` でpayloadが違えば `operation_conflict`、principalまたはscopeが違えば `scope_mismatch` とする。台帳を読むときもtenant・principal・scopeを照合する。Problem snapshot参照、初回・最終検証、失敗理由は同じ意図へ保存して、元の判断と現在の拒否を別々に追跡できるようにする。

## 失敗表

| 境界 | providerの応答 | 保存状態 | 呼び出し側の扱い |
| --- | --- | --- | --- |
| 現在検証 | revoked / expired / unknown | `rejected`（意図保存前なら台帳なし） | 作用・予約開始を行わない |
| 現在read ACL | revoked / expired / unknown | 保存内容を返さない | `read_*` で拒否する |
| revision fence | 初回と最終のrevisionが不一致 | `rejected` | 再評価して新しいoperationIdで開始する |
| 作用capability | 欠落・期限切れ・開始境界で拒否 | `rejected` または `unknown` | 作用側の判定に従い再実行しない |
| 予約開始 | 例外・`unknown` | `recovery_required`, reservation `unknown` | 予約台帳と意図を照合するまで再実行しない |
| 作用開始 | 例外・`unknown` | `unknown`, reservation `started` | Mana側の結果を照合するまで再実行しない |
| 意図確定 | 予約または作用後のsidecar更新失敗 | 直前のdurable状態 | 自動再実行せず照合する |

## 最小検証

`tests/execution-authority.test.ts` で、副作用のないportを使い次を確認する。

- 4 providerのinitial/final再検証、revision fence、予約印へのrevision伝播。
- final検証から期限付きfencing capabilityを作り、作用portで消費すること。final後のauthority失効を作用境界で拒否すること。
- started再送と `readIntent` が現在read ACLを通らない場合に拒否すること。
- 失効・期限切れ・不明、scope変更、payload衝突をfail closedすること。
- 意図を作用前に保存し、予約印・作用開始不明を永続化して再試行を拒否すること。
- 同じoperationIdのstarted再試行で作用を再実行しないこと。
- 既存ResourceReservationService adapterが現在台帳を読み、stale revisionを拒否すること。

実行コマンドは `npm run build` と `npx vitest run tests/execution-authority.test.ts` とする。組織provider、Manaの実作用、tenant/RACIの本番接続は別境界で検証する。

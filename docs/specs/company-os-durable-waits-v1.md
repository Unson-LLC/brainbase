# Story13: Durable Waits v1 最小Spec

## 目的

証拠・イベント・期限を待つ判断処理を、worker の停止や再起動で失わない。待機条件、責任者、再開方法、失敗時の処置、関連する判断 `run_id` と immutable Problem snapshot の参照を、既存の canonical SSOT と同じ sidecar transaction に保存する。

このSpecは待機の記録と claim の境界を定める。外部イベント購読、タイマー実装、DAGの実行、外部作用の再実行は含めない。

## 保存契約

- `DurableWaitStore` は `mutatePersonalOsWithSidecar` を使い、canonical Personal OS と `durable-waits/ledger.json` を同一 transaction で更新する。
- Ledger の各 record は `durable-wait.v1`、一意な `wait_id`、immutable Problem snapshot reference、owner scope、現在 ACL、condition、deadline/review、responsible、resume method、failure policy、`run_ref.run_id` を持つ。
- Problem snapshot は `{ snapshot_id, problem_id, revision }` の固定 locator として保存する。作成・読取・状態変更の境界で `DurableWaitProblemSnapshotPort` を通し、Story05 の current read/identity/`execution_permission=none` 検証を再実装しない。
- 保存された record の `read_policy` に対する現在の read ACL を、読取だけでなく claim/handoff/resume を含む全操作で確認する。保存は write ACL を確認する。
- snapshot の参照は変更しない。前提が変わったときは旧 wait を `new_problem` として停止し、新しい snapshot reference を `next_problem` に保存する。

## 状態と操作

```text
waiting -> claimed -> resumed
waiting/claimed -> handoff_required  (premise changed; new Problem required)
waiting/claimed -> reconciliation_wait (external effect unknown)
waiting/claimed -> failed | cancelled
```

- `create` は event condition または deadline/review interval の少なくとも一つを要求する。
- `claim` は event と timer の入力を同じ atomic mutation で競合解決する。claim request は `request_id`、lease owner、token に結合する。同じ wait の active claim があれば、二つ目の入力は同じ claim を返すが `claimed_by_this_request: false` とし、その request の principal/request_id では `resume` できない。勝者の再試行だけが同じ claim を `claimed_by_this_request: true` で受け取れる。
- lease が有効な間は別の responsible が claim できない。期限切れ後の `handoff` は lease を一度だけ更新し、前の lease token を再利用しない。
- `resume` は claim の owner、request_id、lease/token を組で検証して `resumed` と receipt を一度だけ記録する。store は外部作用を呼ばないため、再送・自動再実行はできない。既存 receipt の replay は、同じ勝者 credentials からだけ同じ receipt を返す。
- `markPremiseChanged` は新しい Problem snapshot reference を検証して `handoff_required` にする。`markEffectUnknown` は `reconciliation_wait` にし、外部作用の再実行を許可しない。
- worker 再起動後は同じ sidecar から wait と lease/claim 状態を読み戻す。結果と次の responsible は mutation と同時に保存する。

## 受入条件と検証

| AC | 最小シナリオ |
|---|---|
| AC-01 | 条件、期限/見直し、担当、再開方法、failure policy、run ref、Problem snapshot を作成して読み戻す |
| AC-02 | 同時 event/timer claim は一件、勝者だけが resume 可能、lease expiry handoff は新 lease 一件、二重 resume は同じ receipt |
| AC-03 | premise change は `handoff_required` + `next_problem`、effect unknown は `reconciliation_wait` となり再開を拒否 |
| AC-04 | 期限超過、別 Store instance による restart read、ACL付き handoff、結果と次責任の保存 |

テストは実際の Personal OS sidecar store を使い、in-memory のみの状態検証で完了扱いにしない。実行権限、外部 event bus、外部作用の成否は execution-authority/Mana 側の adapter で検証する。

## 接続ポート

- `DurableWaitProblemSnapshotPort.verify` が snapshot locator と current read/integrity を担当する。
- `DurableWaitAccessPort.authorize` が組織/tenant の owner ACL を拡張できる。既定値は Story05 の FoundationAcl 判定を使う。
- event/timer scheduler は `claim({ trigger: 'event' | 'timer', request_id })` を呼ぶ。execution-authority は勝者の `claimed_by_this_request` と bound credentials で `resume` の receipt を受け、実行の許可・実行・Outcome を別契約で扱う。負け側の入力をschedulerが再送することはこのstoreの責務外だが、storeは負け側resumeを拒否する。

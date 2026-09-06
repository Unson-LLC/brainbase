# Story: G0の権限承認後に正本Taskを一度だけ作る

Brainbase運用者として、外部実行から届いたTask候補を会社権限に基づく人承認の後だけ正本Taskへ変換し、同じrunから承認receiptと業務操作を追跡したい。これにより、承認済みという状態だけでなく、権限に拘束された実処理と受信側の保存結果を本番で確認できる。

## 受け入れ条件

- [x] `external_runner.v0` は、Task候補outputと対応する `task_store` 承認stepを明示的な契約として受け付ける。
- [x] Company Authorityの検証またはreceipt消費に失敗した場合、正本Taskを作らずhuman stepをpendingに保つ。
- [x] 正しい承認では、receipt消費後に正本Taskを一度だけ作り、runへreceipt IDと元human step IDを保存する。
- [x] materialization結果はTask IDと冪等な業務操作参照を返し、human stepへ保存する。
- [x] 同じ外部runの再送と同じ承認の再実行で正本Taskを増やさない。
- [ ] 本番で承認前0件、承認後1件、APIからのTask読戻し、run/receipt/操作参照の結合を確認する。

- Spec: [docs/specs/story-g0-authority-task-materialization-spec.md](../../../specs/story-g0-authority-task-materialization-spec.md)

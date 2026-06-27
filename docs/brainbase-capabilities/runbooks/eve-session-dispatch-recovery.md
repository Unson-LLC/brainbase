# Eve Session Dispatch 復旧Runbook

## 目的

Eve session dispatchは外部副作用です。Brainbaseに
`operator_reconcile_eve_session` または
`operator_reconcile_eve_session_timeout` が記録された場合、同じLoop Intentを
そのまま再実行してはいけません。先にBrainbase Workflow Mission Controlと
Eve runtime側の状態を照合します。

## セキュリティ境界

- `var/**/workflow-ledger.json` などのWorkflow Mission Control状態ファイルは、
  秘密情報を含む運用データとして扱います。
- `loop_intents.metadata.eve_session_ref.continuation_token` はBrainbase所有の
  resume材料です。チケット、Slack、ログ、PR、公開ドキュメントへ貼り付けてはいけません。
- Brainbase var-dir状態ファイルのread権限は、Brainbase runtimeユーザーと、
  Eve sessionをresume / reconcileできる運用者だけに限定します。
- var-dir状態が漏えいした可能性がある場合は、`EVE_API_TOKEN` をローテーションし、
  Eve側で該当continuation tokenの失効・期限切れ操作が可能なら実施し、
  対応内容を `audit_logs` に残します。

## `operator_reconcile_eve_session`

BrainbaseがEve `session_id` を受け取った後、Workflow Mission Controlの永続化に
失敗した場合に使います。

1. `action_required=operator_reconcile_eve_session` のblocked Workflow Runを開きます。
2. `metadata.runner.session_id` と `metadata.runner.continuation_token_present` を確認します。
3. 対応するLoop Intentに
   `metadata.eve_session_ref.persistence_recovery_required=true` があることを確認します。
4. Eve側で該当 `session_id` を確認し、resume、cancel、ignoreのどれにするか決めます。
5. Eve sessionを継続する場合は、既存のBrainbase `workflow_run_id` に紐づけて
   `external_runner.v0` のingest経路へ戻します。
6. Eve sessionを継続しない場合は、Brainbase runをblockedまたはcancelledで閉じ、
   理由を `audit_logs` に記録します。
7. operator判断のauditが残るまで、recovery flagを消してはいけません。

## `operator_reconcile_eve_session_timeout`

BrainbaseがEve create requestを送信したが、Eve `session_id` を受け取る前に
timeoutした場合に使います。Eve側にsessionが作られたかどうかは不明です。

1. `action_required=operator_reconcile_eve_session_timeout` のblocked Workflow Runを開きます。
2. `metadata.runner.session_id_known=false` を確認します。
3. Loop Intentに
   `metadata.eve_dispatch_timeout_recovery.recovery_required=true` があることを確認します。
4. Eve側で `loop_intent_id`、`workflow_binding_id`、`org_id`、`project_id`、
   request時刻を手がかりに該当sessionを探します。
5. 該当するEve sessionが見つかった場合は、operator auditを記録してから通常の
   `external_runner.v0` ingest経路へ戻します。
6. 該当するEve sessionが見つからない場合は、「remote sessionなし」と判断した証跡を
   `audit_logs` に記録し、timeout recovery markerを消してから新規Eve sessionを作ります。
7. timeout recovery markerが残っている間は、`force_new_session` を使ってはいけません。

## Eve API Token ローテーション

1. Brainbase runtimeが参照するsecret manager上で `EVE_API_TOKEN` を更新します。
2. 環境変数を読むBrainbase processを再起動します。
3. 非本番のLoop IntentでEve dispatch smoke testを実行します。
4. 401/403が `blocked_eve_session_create_failed` として継続していないことを確認します。
5. ローテーション時刻と実施者を `audit_logs` に記録します。

## 完了条件

- 復旧対応ごとにWorkflow Run、Loop Intent metadata、audit logが残っている。
- raw continuation tokenをBrainbase管理外へコピーしていない。
- 再実行前に、既存Eve sessionのresume / cancel、またはremote session不存在の確認が
  operator判断として記録されている。

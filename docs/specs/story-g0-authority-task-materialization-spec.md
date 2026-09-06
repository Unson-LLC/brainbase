---
spec_id: spec-g0-authority-task-materialization
story_id: story-g0-authority-task-materialization
status: accepted
---

# Spec: G0権限承認後の正本Task実体化

`external_runner.v0` のoutputは、`output_type=task_candidates`、`write_back_target=task_store`、配列の `payload` を組み合わせた場合だけ正本Task候補として扱う。human stepは `write_back_target=task_store` と `output_id` を持ち、同じenvelope内のTask候補outputを一意に参照する。片方だけの指定、参照不一致、型不正は保存前に拒否する。既存outputとhuman stepの契約は維持する。

Company Authority必須のTask承認では、署名済みbindingを再検証し、fresh contextを解決し、approval receiptを消費してからCanonical Taskを実体化する。いずれかに失敗した場合はhuman stepとreceiptを確定せず、Taskを生成しない。Task操作は既存の `workflow-task-create` operation keyで冪等に実行する。

承認者のプロジェクトアクセス判定では、署名とbinding整合を検証したCompany Authorityの `resource_ref` が `project:<project_code>` を示す場合、そのproject codeを使う。workflow保存用のtenant project IDと利用者セッションのproject codeが異なっても、未検証のmarkerや別projectの値ではアクセス判定を迂回できない。

materialization結果は `task_ids` と、`scope`、`operation_key`、`task_id` を含む `operation_refs` を返す。承認済みhuman stepは結果を保存し、元runは `company_authority_approval_receipt_id` と `source_human_step_id` を保存する。外部run再送は既存runを返し、承認再実行は保存済みmaterializationを返してTaskを増やさない。

本番確認では一意な外部run IDとTask名を使う。承認前と不正承認後にTaskが存在しないこと、正しい承認後にTaskが一件だけ存在すること、Task取得APIでsource refsを読み戻せること、runにreceiptとmaterializationが共存すること、再送後も件数が一件であることを証跡へ保存する。

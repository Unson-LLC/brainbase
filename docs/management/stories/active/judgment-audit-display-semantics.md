---
story_id: judgment-audit-display-semantics
title: Brainbase呼出監査表示の意味を正確にする
source_requirement:
  source: Codex conversation 2026-08-12
  approved_at: 2026-08-12
spec_docs:
  - .vibepro/spec/judgment-audit-display-semantics/spec.json
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "Brainbase呼出の対象・範囲と完了状態を、同じ監査表示契約として修正するため。"
status: active
created_at: 2026-08-12
updated_at: 2026-08-12
---

# Brainbase呼出監査表示の意味を正確にする

## Story

Brainbaseの利用状況を監査するownerとして、各呼出が何を対象にし、何件の応答を取得したかを、最終回答の先頭で誤解なく確認したい。

## 背景

現行の汎用表示は、実際に対象が確定している呼出も「対象未指定」と表示する。また、ツール応答が既知のエラー形式でないことを「成功」と表示するため、通信が完了したことと、対象データや業務結果が成功したことを区別できない。

## 受け入れ基準

- [ ] `brainbase_projects` は入力なしでも「プロジェクト一覧」と表示し、「対象未指定」と表示しない。
- [ ] `brainbase_run_receipt_inbox` と `brainbase_run_receipt_history` は、入力された識別条件と件数上限を監査行に表示する。`brainbase_admin_read` は管理ビュー名を表示する。
- [ ] エラーでない汎用Brainbase応答は「呼び出し完了」と表示し、対象データや業務結果の「成功」とは表示しない。件数が確定している場合は0件を含め表示する。
- [ ] 参照先ルーティング行、ツール応答内の固有監査行、失敗表示、`knowledge.resolve` の達成判定は変更しない。

## スコープ外

- Brainbaseツール自体の応答schemaや業務状態を変更すること
- 保存済みのepisode eventを過去に遡って書き換えること
- 汎用呼出表示と無関係なHook lifecycleを変更すること

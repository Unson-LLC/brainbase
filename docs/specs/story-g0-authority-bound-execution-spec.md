---
spec_id: spec-g0-authority-bound-execution
story_id: story-g0-authority-bound-execution
status: accepted
---

# Spec: G0権限必須承認と実行結果の束縛

`external_runner.v0` の `human_steps[]` に任意のboolean `company_authority_required` を追加する。値が `true` のstepは `company_authority_handoff` を必須とし、欠落または型不正ならworkflow、run、human stepを保存する前に拒否する。未指定または `false` の既存stepは従来の通常承認を維持する。

adapterは権限必須宣言をhuman step metadataへ保存する。承認時は署名markerの有無だけでなく、この宣言もCompany Authority経路の判定に使う。権限必須宣言があるstepは、marker欠落やservice不在、未消費receiptで通常承認へ縮退せず、stepをpendingのまま維持する。

通常workflowの承認再開では、receipt消費とhuman step承認を同じtransactionで確定する。handlerが作るoutput metadataへ `company_authority_approval_receipt_id` と `source_human_step_id` を保存し、再開run自体にも同じ帰属を保存する。同じstepの再承認は409で拒否し、handlerとoutputを再実行しない。

Company Authority承認に束縛された元runと再開runは、汎用rerun APIで再実行しない。handler失敗、timeout、workflow lock競合のいずれでも再開runにreceipt帰属を残す。handlerの開始後に結果を確定できない場合は外部副作用の成否をunknownとして扱い、外部結果を照合した新しい依頼とhandoffからやり直す。

`agent_report` とMeeting Review Packageの承認専用runは、取り込み時に保存済みの成果物を承認して閉じる経路であり、承認後handlerを持たない。この経路のoutputをG0の承認後実行成果物として扱わない。

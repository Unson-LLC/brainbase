---
task_id: TASK-judgment-live-result-summary-v1
story_id: story-judgment-live-result-summary-v1
status: implementing
updated_at: 2026-08-29
---

# Task: Judgment live result summary

1. 実MCP応答とHostの保存eventの差を再現する。
2. 0件・結果取得・任意本文非転載の単体テストをREDにする。
3. bounded outcome classifierとHost生成displayを実装する。
4. 単体・統合・typecheck・fresh task live-session E2Eを実行する。
5. 独立reviewとVibePro PR Gateを通す。
6. MCP正本のretrieval target matrixを契約化し、`resolve_entity`とquery付き`list_extension_entities`のoperation誤分類をRED/GREENで修正する。
7. fresh transcriptに後段付与されたmemory citationを再現し、Hook可視本文とreceiptのexact digest照合をRED/GREENで修正する。
8. 固定retrieval envelopeと構造化件数が併存する応答をREDで再現し、認識済みenvelopeの結果意味を優先する。
9. 現行UI/MCP topologyに合うknown-good SHA pinをlaunchd start/updateへ結合し、欠損rootと不正pinをfail closedにしてrollback runbookを更新する。launchd再起動後は固定sleep・単発probeを使わず、bounded pollingでAPIの対象SHA・`dirty=false`とruntime worktreeのexact HEAD・cleanを確認し、timeout・不一致・未応答はnon-zeroで後続面へ進めない。

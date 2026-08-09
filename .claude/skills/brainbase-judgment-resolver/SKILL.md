---
name: brainbase-judgment-resolver
description: Brainbase管理対象turnで、Hostがmodel生成前に採用したreceiptのactive DAGを適用し、Ontology・判断基準・Knowledge Resolver handoffをmodel-independentに扱うときに使うSkill。
---

# Brainbase Judgment Resolver

## Source of truth

- Capability: `docs/brainbase-capabilities/capabilities/judgment.resolve.yml`
- Runbook: `docs/brainbase-capabilities/runbooks/judgment-resolve.md`
- Runtime manifest: `config/judgment-runtime-manifest.json`

## Per-turn contract

1. Global `UserPromptSubmit` Hostが、Codexのcurrent request、順序付きの生のuser/assistant発話、prior accepted receipts、project/runtime、適用instructionのdigestからcanonical `conversation_context`を作る。modelは文脈を要約・選別・生成しない。
2. Hostはmodel生成前に内部Resolver bridgeを呼び、request/contextへ束縛されたreceiptをturn journalへ原子的に1件だけ採用する。採用前のtransport retryは許すが、採用後は再解決しない。modelから呼べる`brainbase_judgment_resolve` toolは公開しない。
3. modelはreceiptの`active_nodes`、`active_edges`、`active_node_definitions`だけを今回の判断手順として実行する。node IDを独自promptへ読み替えず、返された`instruction`に従う。全DAGを毎回実行しない。
4. `needs_classification`はResolver障害ではない。`clarification` nodeに従って質問へ答えるためのmodel生成を続ける。binding拒否、receipt欠落、request/context不一致だけはmodel生成前にfail closedする。
5. `required_capabilities`に`knowledge.resolve`があれば、`brainbase_knowledge_resolve`を別に呼び、そのreceiptを取得する。
6. `project_code`は判断文脈でありaction authorityではない。project access不能だけで判断全体を拒否せず、project policyは認証済みscope内だけ適用する。
7. Judgment receiptは判断経路の証拠であり、write/external actionのauthorizationではない。通常のplatform permission・approval・executor authorizationをそのまま使い、Judgment専用の二重guardは追加しない。
8. Hostは採用したreceiptが指定した根拠turnをcanonical contextから引き、秘密らしい値を伏せた26 code point以内の発言抜粋と判断結果を、owner向け短文1行（例: `🧠 判断参照: 直前の「ログイン後の白画面」を参照 → 実装依頼として継続 ✓`）へ決定論的に描画する。receiptと短文は同じturn journal entryへ原子的に保存し、再実行では保存済み短文を使う。modelはそのturnで最初のuser-facing assistant messageだけの先頭に改変せず出力し、後続のcommentaryやfinalでは繰り返さない。modelがこの行を独自に作成・翻訳・整形し直したturnは未検証turnとして扱う。この行は判断evidenceの表示であり、action authorizationやknowledge取得完了を示すものではない。実際のknowledge取得は`📚 Brainbase検索:`または`📚 Brainbase取得:`として別に表示する。

## Completion and failure

- selected node、required capability、ユーザー依頼が完了したら最終応答を返す。
- managed/resolvedという状態だけを理由に処理を止めない。
- active nodeまたは明示された調査・実装・操作が未完なら継続する。
- Host pre-turnが`unmanaged`ならmodel生成は始めない。modelが後からResolverを呼んで回復したことにしない。
- receiptにない判断をHostやmodelが独自に再分類しない。

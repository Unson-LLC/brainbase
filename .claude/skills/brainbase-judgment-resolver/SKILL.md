---
name: brainbase-judgment-resolver
description: Brainbase管理対象turnで、問いと文脈に必要な判断DAGだけを解決し、Ontology・判断基準・Knowledge Resolver handoffをmodel-independentなreceiptとして適用するときに使うSkill。
---

# Brainbase Judgment Resolver

## Source of truth

- Capability: `docs/brainbase-capabilities/capabilities/judgment.resolve.yml`
- Runbook: `docs/brainbase-capabilities/runbooks/judgment-resolve.md`
- Runtime manifest: `config/judgment-runtime-manifest.json`

## Per-turn contract

1. Codexではglobal `UserPromptSubmit` hookが各turnの入口契約とhook-owned turn IDを注入する。回答やactionの前に、そのturnの現在の問い、project、分類proposalを `brainbase_judgment_resolve` へ一度だけ渡す。`classification_proposal`は`intent`・`domains`・`action_kind`・`risk`・`confidence`・任意の`signals`を持つ入れ子objectであり、tool schemaが列挙するlowercase enumだけを使う。domain/signalはruntime manifestのsemantic matcherが現在の問いまたは明示した`conversation_context`で裏付ける最小集合に限定し、概念上近いだけのdomain/signalを足さない。数値confidence、独自domain/signal、`session_id`・`cwd`・`proposed_*`をtool引数へ渡さない。追従発話では、意味解決に必要な先行発話だけを`conversation_context.text`と`source_turn_ids`で明示する。
2. receiptの`active_nodes`、`active_edges`、`active_node_definitions`だけを今回の判断手順として実行する。node IDを独自promptへ読み替えず、返された`instruction`に従う。全DAGを毎回実行しない。
3. `applicable_policies`を制約として使い、`suppressed_policies`と`unresolved`を無視しない。
4. `required_capabilities`に`knowledge.resolve`があれば、`brainbase_knowledge_resolve`を別に呼び、そのreceiptを取得する。
5. receiptは判断経路の証拠であり、write/external actionのauthorizationではない。既存の承認・権限確認を続ける。

## Stop conditions

- Managed or resolved status alone is not a stop condition.
- When selected nodes and required capabilities are complete, the user's requested answer or work is complete, and no unresolved item remains, emit the completed final response immediately.
- Do not begin self-initiated repo, memory, search, shell, or additional-tool exploration afterward.
- Continue while an active node, required capability, or explicitly requested investigation, implementation, or operation remains unfinished.
- tool不達、binding拒否、receipt欠落は`unmanaged`と明示する。
- `unmanaged`ではread-onlyの説明・診断までに留め、write/external actionを実行しない。
- `needs_classification`または`needs_policy_resolution`では、示された未解決事項を解消するまでactionへ進まない。

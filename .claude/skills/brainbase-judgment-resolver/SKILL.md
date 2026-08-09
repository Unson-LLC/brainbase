---
name: brainbase-judgment-resolver
description: Brainbase管理対象turnを1つのjudgment episodeとして扱い、初期判断・0..N回のknowledge利用・Stop時の完了証拠をmodel-independentに運用するときに使うSkill。
---

# Brainbase Judgment Resolver

## Source of truth

- Capability: `docs/brainbase-capabilities/capabilities/judgment.resolve.yml`
- Runbook: `docs/brainbase-capabilities/runbooks/judgment-resolve.md`
- Runtime manifest: `config/judgment-runtime-manifest.json`

## Per-turn contract

1. Global `UserPromptSubmit` Hostが、current request、順序付きの生のuser/assistant発話、prior finalized episodes、project/runtime、適用instructionのdigestからcanonical `conversation_context`を作る。modelは文脈を要約・選別・生成しない。
2. Hostはmodel生成前にResolver bridgeを呼び、request/contextへ束縛された初期route receiptを採用して1つのjudgment episodeを開始する。開始前のtransport retryは許すが、開始後は再分類しない。modelから呼べるJudgment Resolver toolは公開しない。
3. modelは初期receiptの`active_nodes`、`active_edges`、`active_node_definitions`だけを判断手順として実行する。required capabilityと取得結果に応じてBrainbase knowledge/retrieval toolを0..N回呼べる。1 turn 1 callという制限は設けない。
4. `PostToolUse` Hostは実際に完了した各`mcp__brainbase__*` callをappend-only eventとして記録する。raw tool入出力やsecretは保存せず、tool名・成功状態・安全な短い要約・digestだけを保存する。同じ`tool_use_id`の再送は再利用し、異なる内容との衝突は明示的に失敗する。
5. `brainbase_knowledge_resolve`は検索そのものではなく参照先routeの選択である。成功したこのexact toolだけがrequired `knowledge.resolve`を満たす。表示は`📚 Brainbase参照先:`とし、検索・取得済みとは書かない。実際の検索・取得はそのtool callごとに別表示する。
6. `Stop` Hostがevent集合を検証し、completeまたはincompleteのfinal episode receiptを原子的に1件だけ確定する。required `knowledge.resolve`が欠けていれば最初のStopは継続を要求し、`stop_hook_active=true`の再Stopではincompleteとして確定して無限loopを防ぐ。
7. `needs_classification`はResolver障害ではない。clarification DAGに従い、質問へ答えるためのmodel生成を続ける。binding拒否、receipt欠落、request/context不一致だけはmodel生成前にfail closedする。
8. `project_code`は判断文脈でありaction authorityではない。project access不能だけで判断全体を拒否せず、project policyは認証済みscope内だけ適用する。
9. Initial/final receiptは判断経路と完了状態の証拠であり、write/external actionのauthorizationではない。通常のplatform permission・approval・executor authorizationを使い、Judgment専用の二重guardは追加しない。
10. Hostが作ったowner向け`🧠 判断参照:`行は最初のuser-facing assistant messageだけに出す。各Brainbase callの`📚`行は`PostToolUse`の記録に基づいて表示する。実行していない参照・検索・取得を表示してはならない。

## Completion and failure

- selected node、required capability、ユーザー依頼が完了したら最終応答を返す。
- managed/resolvedという状態だけを理由に処理を止めない。
- active nodeまたは明示された調査・実装・操作が未完なら継続する。
- Host pre-turnが`unmanaged`ならmodel生成は始めない。modelが後からResolverを呼んで回復したことにしない。
- receiptにない判断をHostやmodelが独自に再分類しない。
- incomplete finalは「Brainbaseを使った」証拠ではなく、required capabilityを満たせなかった監査証拠として扱う。

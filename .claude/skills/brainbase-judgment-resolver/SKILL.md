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
2. 現行Resolverは内部LLMを持たない。manifest-owned `semantic_matchers`、限定的なprior-context継承、安全floor、policyを決定的に適用し、初期分類とactive DAGを選ぶ。明示的な専門domain/intentへ一致せず、follow-upでもない入力はserver-owned `general/answer` fallbackとして解決する。`semantic`は分類目的を指し、LLM・embedding実装を意味しない。
3. Hostはmodel生成前にResolver bridgeを呼び、request/contextへ束縛された初期route receiptを採用して1つのjudgment episodeを開始する。開始前のtransport retryは許すが、開始後は再分類しない。modelから呼べるJudgment Resolver toolは公開しない。
4. 現行はCodex modelが選択済みDAG内のopen-ended判断loopを担う。初期receiptの`active_nodes`、`active_edges`、`active_node_definitions`だけを判断手順として実行し、取得結果からqueryを組み替えながらBrainbase knowledge/retrieval toolを0..N回呼べる。1 turn 1 callという制限は設けない。Claude Codeは同じ責務分割を適用できる将来のHost adapter候補だが、現行episode lifecycle hook integrationには含まれない。
5. `PostToolUse` Hostは実際に完了した各`mcp__brainbase__*` callをappend-only eventとして記録する。raw tool入出力やsecretは保存せず、tool名・成功状態・安全な短い要約・digestだけを保存する。同じturnのepisode開始・event確定・Stop確定はturn専用SQLiteの`BEGIN IMMEDIATE` transactionで直列化し、並列callは原子的なjournal commit順で`event_sequence`を付ける。process終了時はOSがtransaction lockを解放するため、Hostがstale lock fileを判定・削除しない。同じ`tool_use_id`の再送は再利用し、異なる内容との衝突は明示的に失敗する。
6. `brainbase_knowledge_resolve`は決定的な参照先routeの選択であり、検索そのものではない。成功したこのexact toolだけがrequired `knowledge.resolve`を満たす。表示は`📚 Brainbase参照先:`とし、検索・取得済みとは書かない。実際の検索・取得はそのtool callごとに別表示する。
7. `Stop` Hostがevent集合と最終回答を検証し、completeまたはincompleteのfinal episode receiptを原子的に1件だけ確定する。最終回答は保存済み`🧠`行と全`📚`/`⚠️`行をjournal commit順に先頭表示する。required `knowledge.resolve`が欠けるか、そのowner表示が欠落・重複・順序違いなら最初のStopは継続を要求し、`stop_hook_active=true`の再Stopではtransaction取得後にincompleteとして確定して無限loopを防ぐ。transaction取得自体がbounded timeoutになった再Stopは`{}`で無音成功させず、非zero exitとstderrで明示的に失敗する。
8. `needs_classification`はResolver障害ではない。参照先のないfollow-upや、knowledge分類に必要なproject contextがない場合はclarification DAGに従い、質問へ答えるためのmodel生成を続ける。matcher未一致の非follow-up入力は`needs_classification`ではなく上記`general/answer` fallbackになる。binding拒否、receipt欠落、request/context不一致だけはmodel生成前にfail closedする。
9. `project_code`は判断文脈でありaction authorityではない。project access不能だけで判断全体を拒否せず、project policyは認証済みscope内だけ適用する。
10. Initial/final receiptは判断経路と完了状態の証拠であり、write/external actionのauthorizationではない。通常のplatform permission・approval・executor authorizationを使い、Judgment専用の二重guardは追加しない。
11. Hostが作ったowner向け`🧠 判断参照:`行と各Brainbase callの`📚`/`⚠️`行は、全callが確定した後の最終回答先頭だけに完全な監査ブロックとして出す。途中のcommentaryには監査ブロックを出さず、実行していない参照・検索・取得を表示してはならない。

## Completion and failure

- selected node、required capability、ユーザー依頼が完了したら、Hostが保存したowner監査行を先頭に各一回表示して最終応答を返す。
- managed/resolvedという状態だけを理由に処理を止めない。
- active nodeまたは明示された調査・実装・操作が未完なら継続する。
- Host pre-turnが`unmanaged`ならmodel生成は始めない。modelが後からResolverを呼んで回復したことにしない。
- receiptにない判断をHostやmodelが独自に再分類しない。
- incomplete finalは「Brainbaseを使った」証拠ではなく、required capabilityを満たせなかった監査証拠として扱う。

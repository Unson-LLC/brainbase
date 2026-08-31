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
4. 現行はCodex modelが選択済みDAG内のopen-ended判断loopを担う。Hostが確定した初期route/classificationと`autonomy_decision`は不変で、modelは再計算・変更しない。低/中リスクでスコープ内なら`continue`、高/重大リスク・外部作用・分類不能・方針衝突なら`escalate`とする。`continue`でも、不可逆操作、権限不足、本人固有の価値判断、取得不能な必須入力、証拠のある終端blockerだけは正確な`⚠️ 確認が必要[reason_code]:`行で確認へ上げられる。複雑さ、好み、念のためだけでは止めない。required `knowledge.resolve`がある場合、Hostは許可されたexact tool `mcp__brainbase__brainbase_knowledge_resolve`と、その役割が正本の所在・次の取得経路の選択であって回答本文の取得やJudgment route再分類ではないことを初期文脈へ明示する。最初のStop修復文も同じcapability-action定義から生成する。初期receiptの`active_nodes`、`active_edges`、`active_node_definitions`だけを判断手順として実行し、取得結果からqueryを組み替えながらBrainbase knowledge/retrieval toolを0..N回呼べる。1 turn 1 callという制限は設けない。Claude Codeは同じ責務分割を適用できる将来のHost adapter候補だが、現行episode lifecycle hook integrationには含まれない。
5. `PostToolUse` Hostは実際に完了した全tool callをappend-only eventとして記録する。raw tool入出力やsecretは保存せず、tool名・成功状態・digestだけを保存する。Brainbase callだけは安全な短い要約とowner表示行も保存し、一般toolの実行証跡は最終監査行へ表示しない。同じturnのepisode開始・event確定・Stop確定はturn専用SQLiteの`BEGIN IMMEDIATE` transactionで直列化し、並列callは原子的なjournal commit順で`event_sequence`を付ける。process終了時はOSがtransaction lockを解放するため、Hostがstale lock fileを判定・削除しない。同じ`tool_use_id`の再送は再利用し、異なる内容との衝突は明示的に失敗する。
6. `brainbase_knowledge_resolve`は決定的な参照先routeの選択であり、検索そのものではない。成功したこのexact toolだけがrequired `knowledge.resolve`を満たす。表示は`📚 Brainbase参照先:`とし、検索・取得済みとは書かない。実際の検索・取得はそのtool callごとに別表示する。
7. `Stop` Hostがevent集合と最終回答を検証し、契約を満たした場合だけcomplete final episode receiptを原子的に1件確定する。runtime 2.4以降の実装・操作turnでは、回答本文へ状態を埋め込まず、最後のtool callで`brainbase_judgment_state_record`を実行して同一episodeのjournalへ状態を記録する。`pending`または`pending_safe_work=true`は差し戻す。`completed`は状態eventより前に成功した一般toolの`PostToolUse`証跡が1件以上あり、状態eventが最後の場合だけ通す。`waiting_human`は許可済みreason codeと可視`⚠️`行が一致する場合だけ通す。状態欠落・不正・古い状態はfail-closedで差し戻す。runtime 2.3は本文内HTML marker、2.2以前は自然文検出をrollout互換として残す。最終回答は保存済み`🧠`行と全`📚`/`⚠️`行をjournal commit順に先頭表示する。`continue`なのに不要な判断質問で止まった場合、最初のStopは短い`🔁`進捗`systemMessage`を表示し、回数・trigger・Resolver理由をimmutable continuationへ保存する。再生成が完了した場合だけjournal由来の`🔁 自律継続`行を最終監査へ追加し、AI本文だけの自己申告は拒否する。修復可能なStopが実際に回答を差し戻した場合は、そのjournal証跡から`🛠️ Stop修復`行を最終監査へ追加し、修復のないturnでAIが同じ行を自己申告しても拒否する。required `knowledge.resolve`が欠けるか、そのowner表示が欠落・重複・順序違いなら、最初の修復可能なStopで`decision:block`を返し、finalを作らない。それでも不完全な`stop_hook_active=true`の再Stopは`judgment_stop_repair_exhausted`で非zero終了する。本文bindingでは先頭のHost監査namespaceだけを誤表記も含めて除外し、本文開始後の同様の文字列は保持する。episode開始eventがない真のorphan PostToolUseはdigest-only markerと可視警告を残し、Stop修復状態を消費しない。真のorphan Stopは完全監査へ偽装せず、digest-only診断と警告修復を1回だけ残した後、非finalの`audit_degraded`へ有限収束する。`audit_degraded`は完了、Brainbase参照成功、prior finalized judgment、action authorizationではない。identity・diagnostic/episode integrity矛盾とtransaction timeoutは非zero exitで明示的に失敗する。
8. `needs_classification`はResolver障害ではない。参照先のないfollow-upや、knowledge分類に必要なproject contextがない場合はclarification DAGに従い、質問へ答えるためのmodel生成を続ける。matcher未一致の非follow-up入力は`needs_classification`ではなく上記`general/answer` fallbackになる。binding拒否、receipt欠落、request/context不一致だけはmodel生成前にfail closedする。
9. `project_code`は判断文脈でありaction authorityではない。project access不能だけで判断全体を拒否せず、project policyは認証済みscope内だけ適用する。
10. Initial/final receiptは判断経路と完了状態の証拠であり、write/external actionのauthorizationではない。Stopのautonomy検査は不要な質問停止を防ぐ会話継続境界に限り、通常のplatform permission・approval・executor authorizationを置き換えない。
11. Hostが作ったowner向け`🧠 判断参照:`行と各Brainbase callの`📚`/`⚠️`行は、全callが確定した後の最終回答先頭だけに完全な監査ブロックとして出す。参照必須でなく実際のBrainbase callが0件なら、`📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓`を表示する。不要質問を実際に差し戻したturnだけ、途中に短い`🔁`進捗を表示し、成功後の最終監査へjournal由来の`🔁`完了行を追加する。Stopが回答を実際に差し戻して修復が完了したturnだけ、最終監査へ`🛠️ Stop修復: 最終回答を1回差し戻し → 修復完了 ✓`を追加する。通常turnは無音とし、実行していない参照・検索・取得・差し戻し・修復を表示してはならない。

## Activation readiness

- Hookファイル、`hooks.json`、`config.toml`のtrust sectionが存在するだけではactiveの証明にならない。`npm run check:judgment-hook-readiness -- --cwd <canonical-checkout>`でCodex Hostの`hooks/list`を照会し、3つのHookが`ready_for_fresh_task`であることを確認する。
- `modified`、`untrusted`、missing、disabled、matcher不一致は`trust_required`またはconfiguration errorとして非zeroにする。repo codeやautomationはCodexの`trusted_hash`を書き換えない。ownerが`/hooks`で現在の定義を承認する。
- 承認後に作成した新規Codex taskでepisode/event/finalとtranscriptを照合できた場合だけ`proven_active`とする。既存task、過去artifact、direct entrypoint実行はlive activationの代用にならない。

## Completion and failure

- selected node、required capability、ユーザー依頼が完了したら、Hostが保存したowner監査行を先頭に各一回表示して最終応答を返す。
- `continue`の実装・操作依頼では、runtime 2.4以降は回答外のjournal状態と同一episodeの成功tool証跡を照合し、未完了なら`unfinished_safe_work`として差し戻す。途中表示は`🔁 未完了と判定しました`、完了監査は`🔁 実行継続`として不要質問の差し戻しと区別する。これで本文キーワードとHTMLコメントへの依存はなくなるが、実行結果の意味的な正しさは依然として`content_verification_status: not_evaluated`であり、テスト・readback・専門検証を別に要求する。
- managed/resolvedという状態だけを理由に処理を止めない。
- active nodeまたは明示された調査・実装・操作が未完なら継続する。
- Host pre-turnが`unmanaged`ならmodel生成は始めない。modelが後からResolverを呼んで回復したことにしない。
- receiptにない判断をHostやmodelが独自に再分類しない。
- required capabilityまたはowner表示を満たせない最初の修復可能なStopは`decision:block`で継続し、finalを作らない。不完全な正常episodeのactive再Stopは非zeroで明示終了する。episode欠落は警告修復を1回だけ要求して`audit_degraded`へ有限収束させるが、「Brainbaseを使った」証拠や完了receiptへは変換しない。

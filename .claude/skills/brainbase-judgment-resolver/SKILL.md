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
2. UserPromptSubmitは生のturn inputを短期episodeへ保存するだけで、意味分類やBrainbase利用可否を確定しない。Codex modelが自然言語を解釈し、毎turn最初にmodel-callable `brainbase_resolve_turn`へその解釈を渡す。
3. Brainbaseは保存済みturn input、model interpretation、manifest-owned policyを突合し、改変不能なTurnContractを返す。`semantic_matchers`は義務・action floor・riskを追加できる安全railだが、未一致を`general/answer`へ落としたり必要能力を減らしたりしない。
4. PostToolUseは`resolve_turn`と後続toolの証拠をturnへ結合する。Stopは成功した`resolve_turn`証拠がなければ必ず差し戻し、TurnContractのrequired capabilitiesと実行証拠が揃った場合だけ完了させる。
5. `PostToolUse` Hostは実際に完了した全tool callをappend-only eventとして記録する。raw tool入出力やsecretは保存せず、tool名・成功状態・digestだけを保存する。Brainbase callだけは安全な短い要約とowner表示行も保存し、一般toolの実行証跡は最終監査行へ表示しない。同じturnのepisode開始・event確定・Stop確定はturn専用SQLiteの`BEGIN IMMEDIATE` transactionで直列化し、並列callは原子的なjournal commit順で`event_sequence`を付ける。process終了時はOSがtransaction lockを解放するため、Hostがstale lock fileを判定・削除しない。同じ`tool_use_id`の再送は再利用し、異なる内容との衝突は明示的に失敗する。
6. `brainbase_knowledge_resolve`は決定的な参照先routeの選択であり、検索そのものではない。成功したこのexact toolだけがrequired `knowledge.resolve`を満たす。表示は`📚 Brainbase参照先:`とし、検索・取得済みとは書かない。実際の検索・取得はそのtool callごとに別表示する。
7. `Stop` Hostがevent集合と最終回答を検証し、契約を満たした場合だけcomplete final episode receiptを原子的に1件確定する。復元可能なCodex App委任Stopは上記の`post_generation_recovery` episodeを開始してから同じ検査へ進み、finalにもlifecycle markerを束縛する。runtime 2.4以降の実装・操作turnでは、回答本文へ状態を埋め込まず、最後のtool callで`brainbase_judgment_state_record`を実行して同一episodeのjournalへ状態を記録する。`pending`または`pending_safe_work=true`は差し戻す。`completed`は状態eventより前に成功した一般toolの`PostToolUse`証跡が1件以上あり、状態eventが最後の場合だけ通す。`waiting_human`は許可済みreason codeと可視`⚠️`行が一致する場合だけ通す。状態欠落・不正・古い状態はfail-closedで差し戻す。runtime 2.3は本文内HTML marker、2.2以前は自然文検出をrollout互換として残す。最終回答は保存済み`🧠`行と全`📚`/`⚠️`行をjournal commit順に先頭表示する。`continue`なのに不要な判断質問で止まった場合、最初のStopは短い`🔁`進捗`systemMessage`を表示し、回数・trigger・Resolver理由をimmutable continuationへ保存する。再生成が完了した場合だけjournal由来の`🔁 自律継続`行を最終監査へ追加し、AI本文だけの自己申告は拒否する。修復可能なStopが実際に回答を差し戻した場合は、そのjournal証跡から`🛠️ Stop修復`行を最終監査へ追加し、修復のないturnでAIが同じ行を自己申告しても拒否する。required `knowledge.resolve`が欠けるか、そのowner表示が欠落・重複・順序違いなら、最初の修復可能なStopで`decision:block`を返し、finalを作らない。それでも不完全な`stop_hook_active=true`の再Stopは`judgment_stop_repair_exhausted`で非zero終了する。本文bindingでは先頭のHost監査namespaceだけを誤表記も含めて除外し、本文開始後の同様の文字列は保持する。episode開始eventがなく、正規委任も一意に復元できない真のorphan PostToolUseはdigest-only markerと可視警告を残し、Stop修復状態を消費しない。真のorphan Stopは完全監査へ偽装せず、digest-only診断と警告修復を1回だけ残した後、非finalの`audit_degraded`へ有限収束する。`audit_degraded`は完了、Brainbase参照成功、prior finalized judgment、action authorizationではない。`UserPromptSubmit`はturn_inputをjournalの`<sessionRef>/<turnRef>.turn-input.json`へ保存し、model contextには`turn_ref: "<sessionRef>/<turnRef>"`という64桁hexペアの参照だけを渡す（turn_inputのJSONもファイルpathも渡さない）。モデルは`brainbase_resolve_turn`を`{ turn_ref, model_interpretation }`で呼び、MCP serverがjournal root（`BRAINBASE_JUDGMENT_JOURNAL_DIR`または`~/.codex/var/judgment-resolver`）配下の該当ファイルを自分で読む（Codex Desktopはhook contextを切り詰めるため、inline JSONは使わない）。ツールスキーマを凍結した既存Codexスレッド向けに、`turn_input: {"turn_ref": "..."}`・`turn_input: {"turn_input_path": <path>}`・turn_inputそのものを渡す旧形式も引き続き受理する。`brainbase_resolve_turn`成功の`PostToolUse`は確定後の判断行をsystemMessageで返し、最終回答の先頭行はその行に置き換える。`escalate`（`risk_or_external`）は人間に一度だけ確認する契約であり、同一sessionの直前finalized turnが`escalated`/`waiting_human`で終わっていれば、次のuser turnはその回答としてHostが`continue`扱いにし（episodeの`host_autonomy.basis=prior_escalation_answered`）、判断行は「前turnの確認への回答として継続」になる。Codexスレッドのtool surfaceに`brainbase_resolve_turn`が無く、transcriptにその呼び出し失敗が記録されている場合、Hostはそのsessionを`turn_resolution_unavailable`として扱う。resolve_turn待ちの`classification_missing`確認を毎turn要求せず、縮退した`⚠️ 判断参照`行（新しいCodexタスクで復旧）を先頭に表示させて通常の自律実行を続け、finalは`audit_degraded`・`degradation_reason=turn_resolution_unavailable`で確定する。identity・diagnostic/episode integrity矛盾とtransaction timeoutは非zero exitで明示的に失敗する。
8. `needs_classification`はResolver障害ではない。model interpretationが未提出、参照先のないfollow-up、knowledge分類に必要なproject context不足ならclarification DAGに従う。matcher未一致だけを理由に`general/answer`へ自動確定しない。
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
- required capabilityまたはowner表示を満たせない最初の修復可能なStopは`decision:block`で継続し、finalを作らない。不完全な正常episodeのactive再Stopは非zeroで明示終了する。episode欠落時は、現在session/current turnへ一意に束縛できる正規Codex App委任だけを`post_generation_recovery`として回復する。それ以外は警告修復を1回だけ要求して`audit_degraded`へ有限収束させるが、「Brainbaseを使った」証拠や完了receiptへは変換しない。

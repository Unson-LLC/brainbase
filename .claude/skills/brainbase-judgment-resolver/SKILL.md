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
7. Hostは`Stop`でevent集合と実際の`last_assistant_message`を検証し、契約を満たした場合だけcomplete final episode receiptを原子的に1件確定する。`PostToolUse`はeventと状態をjournalへ記録するだけで、final receiptを確定しない。復元可能なCodex App委任Stopは`post_generation_recovery` episodeを開始してから同じ検査へ進み、finalにもlifecycle markerを束縛する。runtime 2.4以降の実装・操作turnでは、最後のtool callで`brainbase_judgment_state_record`を実行して同一episodeのjournalへ状態を記録する。`pending`または`pending_safe_work=true`は差し戻す。`completed`は状態eventより前に成功した一般toolの`PostToolUse`証跡が1件以上あり、状態eventが最後の場合だけ通す。`waiting_human`は許可済みreason codeと可視`⚠️`行が一致する場合だけ通す。状態欠落・不正・古い状態はfail-closedで差し戻す。runtime 2.3は本文内HTML marker、2.2以前は自然文検出をrollout互換として残す。最終回答は保存済み`🧠`行と全`📚`/`⚠️`行からなる完全な監査ブロックで始め、journal順に各1回だけ表示する。Hostはその完全一致を検証し、成功時は`owner_audit_source: 'assistant_answer'`と回答全体の`answer_digest`を記録する。監査行の欠落・順序違い・未記録の`🔁`/`🛠️`行は`owner.audit.display`の未達とし、最初のStopが正確な監査ブロックを返して一度だけ差し戻す。監査だけを修復する場合は元の業務本文をdigestで束縛し、削除・要約・置換を拒否する。継続markerが既にある再Stopでも未達なら二度目はblockせず`audit_degraded`へ有限収束するが、`owner_audit_complete`をtrueにしない。`systemMessage`は途中通知や修復指示であり、ownerに表示された証拠には数えない。必須`brainbase_resolve_turn`、required `knowledge.resolve`、必須value proof、autonomy契約も同じStopで検査する。episode開始eventがない真のorphanは完全監査へ偽装しない。`audit_degraded`は完了、Brainbase参照成功、prior finalized judgment、action authorizationではない。`UserPromptSubmit`はturn inputをjournalへ保存し、model contextには`turn_ref`だけを渡す。モデルは`brainbase_resolve_turn`を`{ turn_ref, model_interpretation }`で呼び、MCP serverがjournalから正本入力を読む。`brainbase_resolve_turn`成功の`PostToolUse`は判断契約の確定を通知し、最終回答の先頭へ監査行を表示するよう明示する。`escalate`は`needs_classification`、`needs_policy_resolution`、または一致する`human_approval` policyだけで発生する。承認・tool unavailable・integrity failureの詳細はCapabilityとRunbookを正本とする。
8. `needs_classification`はResolver障害ではない。model interpretationが未提出、参照先のないfollow-up、knowledge分類に必要なproject context不足ならclarification DAGに従う。matcher未一致だけを理由に`general/answer`へ自動確定しない。
9. `project_code`は判断文脈でありaction authorityではない。project access不能だけで判断全体を拒否せず、project policyは認証済みscope内だけ適用する。
10. Initial/final receiptは判断経路と完了状態の証拠であり、write/external actionのauthorizationではない。Stopのautonomy検査は不要な質問停止を防ぐ会話継続境界に限り、通常のplatform permission・approval・executor authorizationを置き換えない。
11. Hostが作ったowner向け`🧠 判断参照:`行と各Brainbase callの`📚`/`⚠️`行は、最終assistant回答の先頭へ完全な監査ブロックとして一度だけ出す。`Stop`は実際の回答を検査する唯一の確定境界であり、`PostToolUse systemMessage`や保存済みjournalだけを表示証拠にしない。参照必須でなく実際のBrainbase callが0件なら、`📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓`を含める。不要質問を実際に差し戻したturnだけjournal由来の`🔁`完了行を、実際にStop修復したturnだけ`🛠️`行を含める。実行していない参照・検索・取得・差し戻し・修復の行は含めない。

差し戻し済みruntime 2.4 continuationで必須value proofより先に`completed` state PostToolUseが来た場合、そのPostToolUseは`decision:block`を弱めずに返してfinalを作らない。value proofと新しい最後のstateをjournalへ記録した後も、後続Stopが実際のassistant回答を検証した場合だけ判断レシートを確定する。

## Activation readiness

- Hookファイル、`hooks.json`、`config.toml`のtrust sectionが存在するだけではactiveの証明にならない。`npm run check:judgment-hook-readiness -- --cwd <canonical-checkout>`でCodex Hostの`hooks/list`を照会し、3つのHookが`ready_for_fresh_task`であることを確認する。
- `modified`、`untrusted`、missing、disabled、matcher不一致は`trust_required`またはconfiguration errorとして非zeroにする。repo codeやautomationはCodexの`trusted_hash`を書き換えない。ownerが`/hooks`で現在の定義を承認する。
- integrity failureは成功に丸めず、明示的な非zero exitとする。
- 承認後に作成した新規Codex taskでepisode/event/finalとtranscriptを照合できた場合だけ`proven_active`とする。既存task、過去artifact、direct entrypoint実行はlive activationの代用にならない。

## Completion and failure

- selected node、required capability、ユーザー依頼が完了したら、Hostが保存したowner監査行を先頭に各一回表示して最終応答を返す。
- `continue`の実装・操作依頼では、runtime 2.4以降は回答外のjournal状態と同一episodeの成功tool証跡を照合し、未完了なら`unfinished_safe_work`として差し戻す。途中表示は`🔁 未完了と判定しました`、完了監査は`🔁 実行継続`として不要質問の差し戻しと区別する。これで本文キーワードとHTMLコメントへの依存はなくなるが、実行結果の意味的な正しさは依然として`content_verification_status: not_evaluated`であり、テスト・readback・専門検証を別に要求する。
- managed/resolvedという状態だけを理由に処理を止めない。
- active nodeまたは明示された調査・実装・操作が未完なら継続する。
- Host pre-turnが`unmanaged`ならmodel生成は始めない。modelが後からResolverを呼んで回復したことにしない。
- receiptにない判断をHostやmodelが独自に再分類しない。
- required `knowledge.resolve`・必須turn resolution・value proof・autonomy契約・owner監査表示のいずれかを満たせない最初の修復可能なStopは`decision:block`で継続し、finalを作らない。owner監査表示はjournal由来の完全な監査ブロックが最終assistant回答の先頭にあり、各行が順序どおり1回だけ現れる場合に限って成立する。不完全な正常episodeのactive再Stop（`stop_hook_active=true`かつ継続marker既存）は非zeroで終了せず、`audit_degraded`として1回だけ有限収束する。episode欠落時は、現在session/current turnへ一意に束縛できる正規Codex App委任だけを`post_generation_recovery`として回復する。それ以外は警告修復を1回だけ要求して`audit_degraded`へ有限収束させるが、「Brainbaseを使った」証拠や完了receiptへは変換しない。

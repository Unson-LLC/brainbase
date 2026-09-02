---
story_id: story-brainbase-judgment-resolver-v1
title: 文脈別の最小判断DAGを解決するJudgment Resolver
source_requirement:
  source: Codex conversation 2026-08-07
  approved_at: 2026-08-07
architecture_docs:
  - path: docs/architecture/story-brainbase-judgment-resolver-v1.md
    status: accepted
spec_docs:
  - docs/specs/story-brainbase-judgment-resolver-v1.md
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "The repo control instructions, requirements SSOT, runtime contract, and current-head lifecycle test describe one Judgment Resolver lifecycle. Splitting them would allow the published contract and runtime behavior to drift across revisions."
pr_scope_review_facets:
  - repo-control
  - requirements-ssot
  - runtime-behavior
  - e2e-gate
pr_scope_dependency_boundaries:
  - requirements-ssot->repo-control
  - requirements-ssot->runtime-behavior
  - runtime-behavior->e2e-gate
status: active
created_at: 2026-08-07
updated_at: 2026-08-11
---

# 文脈別の最小判断DAGを解決するJudgment Resolver

## 背景

Brainbaseは事実の正本と検索経路を持ち始めているが、問いをどの意味で捉え、どの判断基準を適用し、どの順序と分岐で結論へ進むかは、依然として利用中のAIモデルとその場の会話に依存している。そのため同じ情報へアクセスできても、モデルを替えたり会話をやり直したりすると、問題設定、候補の棄却順、必要な反証、判断と強制の境界が再現されない。

毎ターン一律に巨大な判断手順を実行することも目的ではない。Brainbase管理下のターンは必ず一つの判断入口を通るが、実際に通る経路は問い、文脈、リスク、対象領域に応じた最小の部分グラフでなければならない。

ここでいう「管理下」は、Brainbaseが任意のAIホストを外側からinterceptできるという意味ではない。repoに登録されたhost bindingが回答前にResolverを呼ぶ契約を持ち、MCP adapterがturn ID、発行時刻、request digestを共有secretで署名し、serverが登録adapter/version、署名、鮮度、request一致を検証できたターンだけを指す。binding未導入、署名不正、Resolver不達、receipt未取得のターンは`unmanaged`であり、管理済みと表示してはならない。

## 変更内容

- `UserPromptSubmit`は未解決episodeとcanonical turn inputだけを作る。MCP runtimeはmodel-callable `brainbase_resolve_turn`を公開し、Codexの意味解釈をBrainbase側のTurnContractへ確定する。
- 各ターンの現在の問い、Hostが構築したcanonical `conversation_context`、Codex modelの意味解釈、認証主体、project bindingから、runtime manifestのpolicyと安全floorを用いて適用すべき判断基準と判断経路を解決する。`semantic_matchers`は義務・domain・signal・action floor・riskを追加できる安全railであり、matcher未一致は要件削除や`general/answer`への自動確定を意味しない。
- Codex modelが意味分類案を渡す。Resolver内に別のLLMやmodel providerはなく、Brainbaseは正本、制約、安全floorと突合してTurnContractを確定する。
- 単純な問いでは直接経路だけを選び、事実確認、個人判断、技術設計、累積的複雑性、高リスク行為では必要な経路だけを追加する。
- 佐藤の判断原則を、AIモデル固有のpromptではなく、owner、visibility、優先順位、強度、根拠要件、適用範囲、版を持つ再利用可能な判断基準として扱う。
- ゴールの先行確定、問題設定の再検証、原因仮説の反証、必要条件からの導出、候補の制約棄却を、該当する判断で再現する。
- 累積的問題は累積範囲を観測できる階層で扱い、追加案より削除・統合・再設計・廃止を先に比較する。
- 並列な候補生成と候補採用の制御を分離し、探索速度を不要に落とさない。
- 根拠のない数値閾値、対象以上に重いガバナンス、判断と強制の混同、内部高度化だけを成果とみなす判断を防ぐ。
- 選択された判断経路、各active nodeの実行指示、適用基準、後続capability、その入力、未確認事項、host binding状態を監査可能なreceiptとして返す。
- model生成前に1つの未解決judgment episodeを開始し、Codex modelが最初に`brainbase_resolve_turn`へ意味解釈を渡してTurnContractを確定する。実際に完了した後続のdirect `mcp__brainbase__*` callも`PostToolUse`で0..N件記録する。同一turnの並列callはHostが原子的にjournal commit順へ直列化する。`Stop`は成功した`resolve_turn`証拠、TurnContractの必須capability、最終回答先頭の保存済み`🧠`行と全`📚`/`⚠️`行を検証し、契約を満たすcomplete final receiptだけを1件確定する。正常episodeの監査不足は最初の修復可能なStopで`decision:block`となり、なお不完全なactive再Stopは`judgment_stop_repair_exhausted`で非zero終了する。episode開始event自体がないorphan Stopは完全監査へ偽装せず、警告と本文保持を1回だけ要求した後、非finalの`audit_degraded` receiptへ有限収束する。identity・integrity矛盾は従来どおり非zeroで失敗する。TurnContract上で追加参照が必須でなく、判断契約以外のBrainbase callが0件なら、その事実をowner監査行として明示する。local file readや別connectorは現行event matcherの対象外とする。
- initial/final receiptは判断と監査の証拠であり、writeや外部作用をauthorizeしない。既存の権限、承認、executor境界を置き換えない。
- project bindingは判断文脈であり、action authorityではない。project access不能時は該当project policyだけを適用対象から外し、一般判断を停止しない。
- 現行episode lifecycle integrationはCodex Host hookだけを対象とする。Claude Codeは同じ責務分割を適用できる将来のHost adapter候補だが、現行対応として扱わない。

## 影響範囲

今回の変更は、実装済みのJudgment Resolver契約をStory、Architecture、Spec、Skill、always-loaded instruction、capability、runbook、README indexへ同期し、publication testでその一致を固定する。加えて、global Hook設定とowner-only journalを使い、実Codex turnの結果依存0..N検索を検証するlive-session E2Eを追加し、Codex Host adapter runtimeとowner-visible final-answer contractを変更する。このlive evidenceは、導入済みlifecycle adapterの対象ファイルがcurrent HEADとcontent-equivalentであることを証明するが、Hook元checkout自体のSHA一致を証明するものではない。merge後のdeployed checkout SHAは本番デプロイ検証で別に確認する。Resolver API、DB schema、Brainbase UIは変更しない。現行Codex integrationと将来のClaude Code adapter候補、判断receiptとaction authorization、routeと実際のknowledge/retrieval callの境界がreview対象である。ローカルUI、persistent MCP runtime、global Hook元checkout、Lightsailを同一merge SHAへ揃えて本番反映を検証する。

## 受け入れ基準

- [ ] Codexのglobal `UserPromptSubmit` hookは全turnへhook-owned turn ID付き入口契約を注入し、登録済みhost bindingは通常回答・調査・設計・実行の前に1つのjudgment episodeを開始して、exactly oneのinitial route receiptを採用する。採用前のtransport retryはboundedに許容し、network call数を「1 turn 1回」に固定しない。現在の問いと必要な会話文脈を署名対象のpublic bodyへ含め、署名検証済みreceiptへ当該turn IDとexact request digestを返して結び付ける。
- [ ] 未登録adapter、version不一致、署名不正、request不一致、鮮度切れをserverが拒否し、caller自己申告だけで`managed`にならない。
- [ ] binding未登録、Resolver不達、receipt未取得のターンは共通host resultで`unmanaged`、receiptなし、非空warningとして可視化され、Brainbase管理済みと主張せず、write/external actionへ進まない。
- [ ] 解決結果は問いと会話文脈に必要な判断ノードだけを含み、無関係な全判断段階を一律には含まない。短い追従発話でも明示された会話文脈から同じ問題領域を継続できる。
- [ ] receiptは`active_nodes`と一対一に対応する`active_node_definitions`を返し、各定義のkind、instruction、required capability templateだけでhostが選択経路を実行できる。
- [ ] 単純、knowledge、personal judgment、engineering、organization、operations、累積的複雑性、高リスクまたは外部作用の各文脈で、仕様化された異なる部分グラフが選択される。
- [ ] 適用される判断基準には、owner、visibility、priority、strength、evidence requirement、型付きscope/effect、versionが含まれ、scopeは認証contextへexact matchし、抑止されたpolicyはwinnerと理由をreceiptへ返し、同順位・同specificity・同targetのhard conflictは通常receiptの`needs_policy_resolution`としてfail-closedになる。
- [ ] 情報源の解決は既存Knowledge Resolverへの構造化handoffを返し、Judgment Resolver自身がGraph、Personal KG、repo、Driveの正本を複製しない。
- [ ] model interpretation未提出、参照先を解決できないfollow-up、またはknowledge分類に必要な`project_code`がない入力はclarification receiptを返す。matcher未一致だけで`general/answer`へ自動確定せず、project access不能や分類不能を成功として扱わない。
- [ ] 呼び出し側は、サーバー管理の判断基準、判断経路、分類provenance、安全floorを任意に注入・上書きできない。
- [ ] personal judgment policyは認証されたownerだけへ返り、非ownerとowner不明のservice credentialへ漏れない。
- [ ] 選択された部分グラフはDAGであり、循環を含まず、request bodyの配列順を保存したexact digestでbindingし、意味的に同じ正規化判断入力と同じmanifest digestからはrequest digestに依存しない同じplan digestを得る。
- [ ] Host専用APIを再利用しつつ、MCP runtimeは現行Codex modelへ`brainbase_resolve_turn`を公開する。認証、project scope、既存機能の互換性を維持する。
- [ ] 現行Codex modelは採用済みinitial routeだけを実行し、途中結果を踏まえてBrainbase knowledge/retrieval toolを0..N回呼び、検索queryを必要なだけ組み替える。Knowledge Resolverは正本候補を決定的に選ぶだけで、実際の取得は各retrieval toolが担う。`Stop`は最終回答が保存済みowner判断行と全tool監査行でjournal commit順に始まり、同文言の反復も記録済みevent回数どおり含むことを検証する。
- [ ] Claude Codeは将来のHost adapter候補として明記し、現行episode lifecycle hook integrationの対応範囲に含めない。
- [ ] capability YAML、runbook、README index、agent entry Skill/always-loaded instructionが実装境界と一致する。
- [ ] 根拠のない固定閾値を追加せず、分類、reconciliation、適用理由を監査できる。

## Release operation

- `release_note`: Codexのjudgment lifecycle Hostは、現在のHook trustを`hooks/list`で検査し、正常episodeの監査不足active再Stopをfinalなしの明示failureにする。episode開始eventがないorphan Stopは、完全監査へ偽装せず`audit_degraded`へ有限収束し、長時間taskへ新規task作成を要求しない。Resolverの公開request schemaと「内部Resolver LLMなし」の境界は変えない。
- `rollout_plan`: merge SHAを正本としてglobal Hook checkout、local `:31013`、persistent MCP runtime、Lightsail `brainbase-ssot.service`の4面を同じSHAへ揃える。次にCodex Hostの`hooks/list`をreadiness checkerで照会し、`trust_required`ならownerが`/hooks`で承認する。承認後に作成したfresh Codex taskで実動確認する。
- `observability_evidence`: local/public `/api/version`のtarget SHAと`dirty=false`、health、MCP runtime check、`ready_for_fresh_task`、承認後に作成したfresh transcript、actual Brainbase event、`owner_audit_complete=true`、final answer digest一致を成功条件とし、その時だけ`proven_active`とする。
- `rollback_instruction`: 変更前のHook fileと4面のSHAを保存する。失敗時は`docs/brainbase-capabilities/runbooks/judgment-resolve.md#rollback`の順序で、global Hookは独立したclean checkoutのまま保ち、local UI/MCPは共有disposable runtimeを記録済みcommit SHAへpinして復元し、Lightsailを別面として復元し、最後に元の`hooks.json`を復元する。dirtyな正本source checkoutはswitch/reset/clean/stashせず、journalも削除しない。

実コマンドの正本は`docs/brainbase-capabilities/runbooks/judgment-resolve.md`と`docs/brainbase-capabilities/runbooks/deploy-lightsail-production.md`である。

## スコープ外

- 汎用のLLM自然言語分類サービス
- Judgment receiptまたは実行traceの永続保存UI
- GraphまたはPersonal KGの事実・判断基準の自動更新
- repoのhost bindingを読み込まない任意のAIホストへの強制intercept
- 既存の全Brainbase action toolへreceipt必須化を一括導入すること
- 汎用workflow engineの新設
- 選択された各業務capabilityの全面的な再実装

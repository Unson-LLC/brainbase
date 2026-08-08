# Brainbase Judgment Resolver v1 Specification

## 1. Purpose and guarantee boundary

自然言語の答えを固定せず、登録済みBrainbase host bindingの各turnについて「どの意味体系、判断基準、情報源、判断順序を今回使うか」をmodel-independentに解決する。出力は業務判断やaction許可そのものではなく、LLMまたはorchestratorが実行すべき最小active DAGを表すresolution receiptである。

v1の保証対象は、repoのalways-loaded instruction/Skillを読み、回答前にtoolを呼ぶCodex/Claude host contractである。任意の外部hostはinterceptできない。MCP adapterが署名したturn contextをserverが検証したreceiptだけを`managed`とする。binding未導入、未登録/mismatch/stale/request不一致、Resolver不達、receipt未取得は`unmanaged`であり、write/externalを停止する。receiptの`enforcement_level`は`host_contract`であり、既存action toolのauth/approvalを置換しない。

## 2. Public input

```json
{
  "request": "問いまたは依頼の要約",
  "turn_id": "host-turn-123",
  "project_code": "brainbase",
  "conversation_context": {
    "text": "VibeProの判断DAGをBrainbaseでも同じ発想で設計する",
    "source_turn_ids": ["host-turn-121", "host-turn-122"]
  },
  "classification_proposal": {
    "intent": "design",
    "domains": ["engineering"],
    "action_kind": "write",
    "risk": "high",
    "confidence": "confirmed",
    "signals": ["cumulative_effect", "parallel_exploration"]
  },
  "knowledge_context": {
    "audience": "team",
    "content_type": "canonical_fact"
  }
}
```

`request`、`turn_id`、`classification_proposal`は必須。`project_code`、`conversation_context`、`knowledge_context`は任意だが、knowledge domainでは`audience`と`content_type`が必須である。`conversation_context`を渡す場合は、空でない`text`と、重複せずcontrol characterを含まない1件以上の`source_turn_ids`を必須とする。hostは現在turnの意味解決に必要な範囲だけを渡し、暗黙の全履歴を入力したと主張しない。

列挙値:

- `intent`: `answer`, `investigate`, `diagnose`, `design`, `implement`, `review`, `operate`
- `domains`: `general`, `knowledge`, `personal_judgment`, `engineering`, `organization`, `operations`
- `action_kind`: `none`, `read`, `write`, `external`
- `risk`: `low`, `medium`, `high`, `critical`
- `confidence`: `confirmed`, `inferred`, `unknown`
- `signals`: `cumulative_effect`, `complexity_growth`, `threshold_proposal`, `parallel_exploration`, `authority_boundary`, `problem_frame_uncertain`, `external_outcome`
- `audience`: Knowledge Resolver contractの列挙値
- `content_type`: Knowledge Resolver contractの列挙値

未定義field、`domains`の空配列、重複値、不正enum、`general`と他domainの同時指定を拒否する。`signals`は任意であり、省略または空配列を許容する。`dag_ids`、`policy_ids`、`runtime_version`、`host_binding`、`classification_assurance`、`active_nodes`、`active_edges`、`active_node_definitions`は公開入力に存在せず、追加fieldとして拒否する。

## 3. Classification reconciliation

public classificationはproposalであり、確定値ではない。callerの`confidence`はserver保証水準を上げない。serverは次を所有する。

- intent minimum effect: `implement`と`operate`は最低`write`、`investigate`と`diagnose`と`review`は最低`read`。
- semantic context matcher: engineering、knowledge、personal judgment、organization、operationsと各signalのmanifest管理語彙を、`conversation_context.text`があればそれと現在requestを連結した文脈から検出する。例えば前turnの「認証設計をレビューして」に続く「それを実装して」は`engineering`を継続する。
- safe-general matcher: 挨拶、明示的な文章説明・要約、定義確認など、manifestに列挙した低作用の一般依頼だけを肯定的に検出する。専門領域matcherが不一致だったという消極的理由だけでは`general`にしない。
- current-request safety matcher: merge/delete/update/send/publish/purchaseと日本語同義語を現在requestだけから検出し、minimum action/risk/signalを追加する。会話文脈中の過去の作用語だけで現在turnのfloorを上げない。
- risk order: `low < medium < high < critical`、action order: `none < read < write < external`。
- reconciled domains/signalsはserver detectionで裏づけられた値であり、proposalはfloorを下げられない。`general`は、safe-general matcherが肯定一致し、他domain/safety matcherが未検出で、intentが`answer|review`かつaction floorが`none|read`の時だけ選べる。

proposalのaction/riskがfloorより弱い、confidenceがunknown、server検出domain/signalを欠く、非general domain/signalがproposalだけで支持される、safe-generalの肯定一致がない、knowledge必須contextまたは`project_code`が不足、またはrequestと構造分類が矛盾する場合、statusは`needs_classification`となる。knowledgeの`project_code`不足は`knowledge_project_code_missing`として記録し、不完全なKnowledge handoffを返さない。callerはtrusted provenanceを指定できず、receiptの`classification_assurance=verified|bounded|unknown`と`reconciliation_reasons`はserverだけが生成する。

## 4. Runtime manifest

manifestは`schema_version`, `runtime_version`, `host_bindings[]`, `policies[]`, `nodes[]`, `dags[]`, `selectors`, `semantic_matchers`を持つ。期待digestはmanifest内に持たない。

policyは`id`, `version`, `priority`, `strength`, `scope: {type, id}`, `visibility`, `owner_person_id`, `evidence_requirement`, `effect: {decision, target}`, `instruction`を持つ。`strength`は`hard|soft`、`scope.type`は`global|organization|project|owner`、`effect.decision`は`require|forbid|prefer`。`hard`は`require|forbid`だけ、`soft`は`prefer`だけを許す。global scopeの`id`はnull、それ以外は空でないstringとする。nodeは`id`, `kind`, `instruction`, `required_capability_template`を持つ。DAGは`id`, `kind`, `path`, `policy_ids`を持つ。

canonical JSON algorithm `brainbase-canonical-json-v1`は、object keyをUnicode code point昇順へ再帰sortし、array順を保存し、JSON primitiveをJSON.stringify表現にしてUTF-8 encodeする。manifest digestはそのbytesのSHA-256 lowercase hex。

`config/judgment-runtime-manifest-lock.json`は`schema_version: brainbase-judgment-manifest-lock-v1`と`entries: [{runtime_version, manifest_digest}]`だけを持つ。entry順を保存し、runtime versionは一意、digestは64文字lowercase hex、current manifest versionは最後のentryと一致しなければならない。runtime loaderはduplicate、schema mismatch、current entry不一致を拒否する。`validateManifestLock(next, previous)`はprevious entriesが同一順序・同一値のprefixでない変更を拒否し、repository testでappend-onlyを検証する。manifest変更時はruntime versionを上げ、lock末尾へpairを追加する。

shared golden vectorはnested object、array、Unicode keyを含む`{"z":[3,{"あ":"値","a":true}],"a":null}`を両runtimeでcanonical化し、bytesが`{"a":null,"z":[3,{"a":true,"あ":"値"}]}`、SHA-256が`720c426a8d984447034a85227cf9eb25e3fed20b27af6c41c246c2be8edac67f`になることをassertする。manifestとlockにも固定fixtureと期待digestを持たせる。

service生成時に重複ID、参照切れ、空path、selector/matcher参照切れ、cycle、runtime-version/digest pair不一致を拒否する。

## 5. Deterministic selection and policy merge

1. reconciliation失敗は`clarification.v1`だけを選ぶ。
2. `general`は`direct.v1`、その他domainは固定mappingのdomain DAGを選ぶ。
3. signalは固定mappingのconstraint DAGを選ぶ。
4. reconciled riskがhigh/critical、actionがwrite/external、または`authority_boundary`ならauthority DAGを選ぶ。
5. domainとsignalはcanonical orderへ正規化し、入力配列順に依存しない。
6. common entryから選択DAGへ分岐し、terminalをmerge、最後をreceiptへ接続する。
7. policy applicabilityは、globalは常に、organizationは`scope.id === req.access.tenantId`、projectは`scope.id`が`req.access.projectCodes`に含まれる時、ownerは`scope.id === req.access.personId`の時だけ成立する。認証contextに対応値がなければ適用しない。
8. 適用policyは`hard before soft -> priority desc -> scope specificity desc(global=0, organization=1, project=2, owner=3) -> id asc`でsortする。
9. 同じ`effect.target`への`require`と`forbid`がhard同士なら、高priority、同priorityでは高specificityを採用する。敗者は`applicable_policies`から除き、`suppressed_policies: [{policy_id, suppressed_by_policy_id, reason}]`へ`lower_priority|lower_specificity`の理由とともに移す。priorityとspecificityが同じ時だけHTTP 200の`needs_policy_resolution` receiptとしてfail-closedにする。
10. 同じtargetにhard policyがある時はsoft `prefer`を`suppressed_policies`へ`hard_over_soft`として移す。hardがなければ複数のsoft `prefer`をcanonical orderで保持する。

選択は根拠未検証の数値threshold、Story回数、変更件数を用いない。

## 6. Decision path matrix

| selector | selected DAG | required behavior | excluded example |
|---|---|---|---|
| `general` | `direct.v1` | goalを確認し直接回答 | engineering hypothesis nodes |
| `knowledge` | `knowledge.v1` | source intentを確定しKnowledge handoffを返す | Personal KG body取得 |
| `personal_judgment` | `personal-judgment.v1` | owner policyと前提反証を適用 | non-owner policy metadata |
| `engineering` | `engineering.v1` | goal→frame→observe→hypothesis→prediction→falsify→constraints→generate→reject→decide | organization incentive node |
| `organization` | `organization.v1` | goal、actor、incentive、authority、feedback loopを確認 | code-specific hypothesis node |
| `operations` | `operations.v1` | current state、owner、runbook、reversibility、evidenceを確認 | external action execution |
| `cumulative_effect` / `complexity_growth` | `cumulative-complexity.v1` | cumulative scope以上のcontroller、delete/consolidate/redesign/retire、external outcome | local fixだけの採用 |
| `threshold_proposal` | `threshold.v1` | source、measurability、false-decision costを要求 | unsupported fixed number |
| `parallel_exploration` | `parallel.v1` | generationとadoptionを分離 | exploration停止 |
| `authority_boundary` or write/external/high risk | `authority.v1` | actor、scope、reversibility、evidence、human approval、enforcement point | receiptによるaction許可 |
| `problem_frame_uncertain` | `problem-frame.v1` | problem definitionを独立に反証し、違反時はrederive | proposalへの局所patch |
| `external_outcome` | `external-outcome.v1` | internal outputとuser/downstream outcomeを分離 | testsを顧客価値扱い |

複数domain/signalは並列branchとして選択され、一つのmerge nodeへfan-inする。選ばれなかったDAGはactive graphへ含めない。active node IDはmanifestから投影された実行可能な定義を伴わなければならない。

## 7. Knowledge handoff

knowledge branchは次の`required_capabilities`要素を返す。

```json
{
  "capability": "knowledge.resolve",
  "status": "required",
  "input": {
    "intent": "lookup",
    "audience": "team",
    "content_type": "canonical_fact",
    "project_code": "brainbase"
  },
  "receipt_required": true
}
```

Judgment ResolverはKnowledge Resolverを実行済みとは主張しない。後続callerは`brainbase_knowledge_resolve`を呼び、そのreceiptを別証跡として扱う。handoff入力不足は`needs_classification`、API不達・scope denialはKnowledge capability側の失敗としてactive DAGを停止する。

## 8. Personal policy visibility

`personal_judgment`選択時は`req.access.personId`をservice contextへ渡す。ownerは`BRAINBASE_PERSONAL_KG_OWNER_PERSON_ID`、aliasは`BRAINBASE_PERSONAL_KG_OWNER_ALIAS_IDS`と照合する。owner不一致、null、`internal_api`は403 `personal_judgment_not_accessible`。owner-only policyのID、instruction、evidence requirementを非owner receiptへ含めない。

## 9. Resolution receipt

全statusは次を返す。

- `resolution_id`, `resolved_at`, `turn_id`, `request_digest`, `context_digest`
- `status`: `resolved`, `needs_classification`, `needs_policy_resolution`
- `runtime_version`, `manifest_digest`, `plan_digest`
- `host_binding`: `adapter_id`, `adapter_version`, `status`, `enforcement_level`
- `project_code`
- `classification_proposal`, `classification`, `classification_assurance`, `reconciliation_reasons`
- `selected_dag_ids`, `applicable_policies`, `suppressed_policies`, `required_capabilities`
- `active_nodes`, `active_edges`, `active_node_definitions`, `unresolved`, `rationale`

`context_digest`は`conversation_context`未指定時はnull、指定時はそのexact objectを`brainbase-canonical-json-v1`でencodeしたbytesのSHA-256とする。`active_node_definitions`は`active_nodes`と同順・同数で、各要素は`id`, `kind`, `instruction`, `required_capability_template`だけを持ち、IDが対応nodeと一致する。

`plan_digest`は`resolution_id`、`resolved_at`、`request_digest`、`plan_digest`自身を除くreceipt fieldsを`brainbase-canonical-json-v1`でencodeしたbytesのSHA-256とする。request digestは署名対象のexact public bodyを配列順まで保存し、plan digestは正規化後の判断計画を表すため、提案配列の順序だけが異なる入力ではrequest digestは変わってもplan digestは同じになる。active graphはtopological sortが全nodeを消費できなければ結果を返さない。

完全なunknown fixture:

```json
{
  "resolution_id": "resolution-fixture-unknown",
  "resolved_at": "2026-08-07T00:00:00.000Z",
  "turn_id": "host-turn-unknown",
  "request_digest": "2222222222222222222222222222222222222222222222222222222222222222",
  "context_digest": null,
  "status": "needs_classification",
  "runtime_version": "judgment-runtime-fixture-v1",
  "manifest_digest": "0000000000000000000000000000000000000000000000000000000000000000",
  "plan_digest": "8c08065816451fa05b9ee257eceee8c734041545a5af5ce1c1a46598aaea2f5f",
  "host_binding": {
    "adapter_id": "brainbase-mcp",
    "adapter_version": "1",
    "status": "managed",
    "enforcement_level": "host_contract"
  },
  "project_code": "brainbase",
  "classification_proposal": {
    "intent": "review",
    "domains": ["engineering"],
    "action_kind": "read",
    "risk": "low",
    "confidence": "confirmed",
    "signals": []
  },
  "classification": null,
  "classification_assurance": "unknown",
  "reconciliation_reasons": ["domain_supported_only_by_proposal"],
  "selected_dag_ids": ["clarification.v1"],
  "applicable_policies": [],
  "suppressed_policies": [],
  "required_capabilities": [],
  "active_nodes": ["entry", "reconcile", "clarification", "receipt"],
  "active_edges": [
    ["entry", "reconcile"],
    ["reconcile", "clarification"],
    ["clarification", "receipt"]
  ],
  "active_node_definitions": [
    {"id": "entry", "kind": "common", "instruction": "Enter once for this managed turn.", "required_capability_template": null},
    {"id": "reconcile", "kind": "common", "instruction": "Reconcile caller proposal with server-owned semantics and floors.", "required_capability_template": null},
    {"id": "clarification", "kind": "fail_closed", "instruction": "Ask only for the missing classification or context.", "required_capability_template": null},
    {"id": "receipt", "kind": "common", "instruction": "Emit a request-bound judgment resolution receipt.", "required_capability_template": null}
  ],
  "unresolved": ["classification"],
  "rationale": ["Semantic classification was not verified by a server-owned matcher."]
}
```

このfixtureにdomain/action許可nodeは含めない。

## 10. HTTP API and MCP

`POST /api/judgment/resolve`はstrict auth必須。project scope外は403。MCP adapterは`x-brainbase-judgment-adapter`, `-version`, `-issued-at`, `-request-digest`, `-signature`を送る。`adapter_id`は`^[a-z0-9][a-z0-9._-]{0,63}$`、`adapter_version`は`^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$`、`turn_id`はcontrol characterを含まない1〜128文字とする。`issued_at`はUTC millisecond RFC 3339の`YYYY-MM-DDTHH:mm:ss.sssZ`だけを許す。

署名payloadは`brainbase-canonical-json-v1`でencodeした`["brainbase-judgment-binding-v1", adapter_id, adapter_version, turn_id, issued_at, request_digest]`である。request digestはpublic bodyを配列順も含めてそのままcanonical化したbytesのSHA-256であり、正規化後の分類配列ではない。signatureは`BRAINBASE_JUDGMENT_BINDING_SECRET`によるHMAC-SHA256 lowercase hex。MCP signerとserver verifierは同じgolden fixtureでpayload bytes、request digest、signatureをassertする。

serverはmanifest登録、request digest、時刻、constant-time署名比較を検証し、認証済みaccess contextと検証済みhost bindingだけをserviceへ渡す。`BRAINBASE_JUDGMENT_BINDING_MAX_AGE_MS`の既定値は300000、`BRAINBASE_JUDGMENT_BINDING_MAX_FUTURE_SKEW_MS`は30000で、いずれも0以上の整数だけを許す。`now-issued_at > max_age`または`issued_at-now > future_skew`を拒否し、等値境界は許可する。不正形式、未来超過、期限超過はいずれも403 `judgment_host_binding_untrusted`。bodyからのhost/provenance指定を拒否する。

error:

- 400 `judgment_resolution_input_invalid`
- 403 `judgment_host_binding_untrusted`
- 403 `judgment_resolution_project_not_accessible`
- 403 `personal_judgment_not_accessible`
- 500 `judgment_manifest_invalid` / `judgment_resolution_failed`

policy conflictはtransport errorではなく、HTTP 200の完全な`needs_policy_resolution` receiptである。

MCP toolは`brainbase_judgment_resolve`。HTTP APIと同じ公開input schemaを持ち、既存authenticated helperを再利用する。4xx、5xx/network、不正receiptを区別し、本番dispatcherがtool resultを共通の`managed|unmanaged` host resultへ正規化してから返す。extension dispatcher順序とlegacy fallbackを維持する。

## 11. Host contract and capability publication

- `CLAUDE.md`と`AGENTS.md`へ、Brainbase管理対象turnは回答前にJudgment Resolverを呼ぶthin ruleを同一内容で追加する。
- `.claude/skills/brainbase-judgment-resolver/SKILL.md`はcapability YAML、MCP call、receipt active DAG、Knowledge handoff、unmanaged時停止だけを案内する。
- `docs/brainbase-capabilities/capabilities/judgment.resolve.yml`、runbook、README indexへsurface、visibility、failure semantics、receiptがaction evidenceではないことを記録する。
- host contractの共通resultは`{management_status: managed|unmanaged, reason, warning, receipt}`とし、unavailable tool、missing receipt、403 binding rejectionでは`management_status=unmanaged`、`receipt=null`、非空warningを返す。署名・再束縛済みの`needs_classification|needs_policy_resolution` receiptは`management_status=managed`を維持し、共通turn runnerが`execution_status=stopped`、非空warningで後続処理を止める。`canProceedWithAction`は`none|read`だけをread-only候補とし、列挙外action kindおよびJudgment receipt単体による`write|external`を必ずfalseにする。共通turn runnerは、Judgmentとは独立したaction authorizationが明示的に成功した場合に限り、managedな`write|external`を継続できる。

## 12. Tests

### Service

- matrixの全domain/signalでselected/excluded DAG、policy、capabilityをassertする。
- multiple domain fan-out/fan-inとcanonical orderをassertする。
- false low-risk proposalがserver floorと矛盾して`needs_classification`になる。
- 「認証APIを実装して」を`general`で提案すると`server_detected_domain_missing`で`needs_classification`になり、engineering/action-permission DAGを含めない。
- request matcherにない非general domain/signalをproposalだけで指定すると`domain_supported_only_by_proposal`または`signal_supported_only_by_proposal`で`needs_classification`になる。
- 専門語彙を間接表現したrequestがsafe-generalに肯定一致しなければ`general_not_server_supported`で`needs_classification`になる。
- callerによるDAG/policy/provenance/host binding注入を拒否する。
- personal ownerはpolicy取得、non-owner/null/service credentialは403かつmetadata非漏洩。
- knowledge handoffの完全inputと不足時fixtureをassertする。
- global/organization/project/owner scopeの適用・非適用、priority/specificity/hard-over-softのsuppressed policy shape、hard exact tie、unknown fixture、cycle、参照切れ、version/digest mismatchをassertする。
- proposal配列順を変えるとexact request digestは変わるが、plan digestは同じ。
- 現在requestが「それを実装して」のような追従発話でも、明示されたconversation contextからdomain/signalを継続し、現在requestだけからaction/risk floorを導く。
- receiptのactive node definitionsがactive node IDと一対一で、manifest instructionを返す。
- receiptのrequest digestがbody digestと一致し、同じturn IDの別requestへreceiptを転用できない。
- canonical JSON、binding payload、manifest、lockのcross-runtime golden bytes/hashとlockのduplicate/current/prefix変更拒否をassertする。

### API / MCP / host

- host署名のmissing、未登録adapter、version mismatch、invalid signature、malformed timestamp、future超過、future等値、stale超過、age等値、request mismatch、strict auth、project scope、personal owner、400/403/500 mapping。
- MCP schema、正常receipt、auth/scope/network/4xx/5xx/invalid receipt、dispatcher fallback。
- CLAUDE/AGENTS byte-identical、always-loaded rule、Skill/capability/runbook/index参照。
- unavailable tool、missing receipt、403 binding rejectionの各host fixtureでvisible unmanaged warningとwrite/external非実行をassertする。
- `needs_classification|needs_policy_resolution`をMCP出力へシリアライズしてもmanaged表示を維持し、turn runnerがstoppedにすることをassertする。
- 列挙外action kindがaction authorizationにも後続処理にも到達しないことと、production dispatcher由来receiptでwrite/externalの未認可停止・明示拒否・独立認可成功をassertする。

### Regression

- Knowledge Resolver unit/integration/MCP tests。
- Brainbase server関連tests。
- MCP全testsとTypeScript typecheck。

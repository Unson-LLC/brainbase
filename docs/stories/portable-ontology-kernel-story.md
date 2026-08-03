---
story_id: story-brainbase-portable-ontology-kernel
title: ローカルSSOTを同じ意味で検証・推論できるPortable Ontology Kernel
status: active
period: 2026Q3
spec: docs/specs/brainbase-portable-ontology-kernel.md
architecture: docs/architecture/story-brainbase-portable-ontology-kernel.md
business_metric: canonical promotion前に検出された意味違反数とunverified監査数を区別して観測する
created_at: 2026-08-03
updated_at: 2026-08-03
---

# ローカルSSOTを同じ意味で検証・推論できるPortable Ontology Kernel

## 背景

Brainbase OSSは、利用者が承認した自分・仕事・関係性・意思決定をローカルSSOTへ保存し、MCPからAI coding agentへ渡せる。一方、現在のSSOTは値を保持できても、型や関係の意味、正しい状態の条件、意思決定の置き換え方、意味体系そのものの変更履歴を共通規則として取得・検証できない。

この不足を放置すると、同じローカルSSOTをCodex、Claude Code、CodeCodeが読んでも、関係や意思決定の解釈がagentごとに変わり得る。また、データ形式としては正しくても意味的に不完全な内容がcanonical SSOTへ昇格し得る。

## 誰が

- Brainbase OSSを自分のPersonal OSとして使う利用者
- ローカルSSOTを読むCodex、Claude Code、CodeCodeなどのagent
- Brainbase OSSの型や関係を安全に拡張したいcontributor

## 何を

利用者は、ローカルSSOTにある事実を、どのagentからでも同じ意味で検証・解釈したい。型、関係、制約、推論、変更・衝突の5領域がversion付きの共通契約になり、canonical SSOTへ保存する前と、保存済みSSOTを読むときの両方で利用できる状態を目指す。

## なぜ

- 一度説明して承認した文脈を、agentごとの暗黙解釈へ戻さないため
- 形式上は読めるが意味的に不完全なcanonical dataを早期に見つけるため
- 意思決定の更新時に、現在の判断と過去の履歴を両立させるため
- OSS利用者がhosted serviceやUnson内部データなしで同じ安全性を得られるようにするため
- contributorが意味体系を変更した影響を説明し、互換性を保てるようにするため

## 実行期と観測指標

- 実行期: 2026Q3
- 観測指標: canonical promotion前に検出された意味違反数と、監査不能として返した`unverified`件数を別々に記録できること
- 完了判定: 全受け入れ条件をtargeted test、full test、build、MCP/CLI contractで再現できること

## 代表シナリオ

### 関係の検証

agentが未登録の関係、または許可されていない型同士の関係をcanonical SSOTへ追加しようとした場合、Brainbaseは黙って保存せず、どの意味規則に反するかを説明する。

### 意思決定の置き換え

利用者が新しい意思決定で過去の意思決定を明示的に置き換えた場合、agentは現在有効な判断と置き換え根拠を説明できる。明示的な置き換えがない場合、単に新しいという理由で優先せず競合として扱う。

### 意味体系の更新

型や関係の意味が更新された場合、利用者とcontributorは、どのversionがいつ有効か、既存のローカルSSOTへどのような影響があるか、過去の事実をどのversionで読んだかを追跡できる。

## 受け入れ基準

- [ ] 型・関係・制約・推論・変更ルールの5領域を、一つのversion付き契約として取得できる。
- [ ] `person`、`project`、`relationship`、`decision`などOSSのcanonical local SSOTに存在する概念の意味と利用条件を確認できる。
- [ ] canonical SSOTへ保存する前に意味検証でき、違反には規則IDと説明が付く。
- [ ] 保存済みローカルSSOTを監査でき、欠損・読取失敗・不完全な監査を違反0件と混同しない。
- [ ] 明示的な置き換え根拠がある意思決定だけを現在有効として導出し、根拠がなければ競合を返す。
- [ ] 推論結果からOntology version、根拠、判定時点、説明を追跡できる。
- [ ] Ontologyの変更version、適用日、互換性、移行、rollbackを取得でき、過去のSSOTを当時の意味で解釈できる。
- [ ] 既存の`get_context`、`list_entities`、`search`とオンボーディング体験を壊さない。
- [ ] hosted backend、bb.unson.jp、Infisical、Unson内部Graph、内部Decision/RACI、内部署名鍵を必要としない。
- [ ] 初期導入で既存のローカルSSOTを自動修正・削除しない。

## 意味境界

- このStoryは`brainbase-mcp-only.md`のv1ローンチ時点の「5 tools固定」を、既存5 toolsの互換性を維持したadditive capabilityへ更新する。旧Story本文は当時の受け入れ基準として保持し、現在の公開tool surfaceは本Story・Spec・READMEを正とする。
- Ontologyは利用者の事実そのものではなく、その事実の意味と利用規則である。
- 利用者が承認した個人・仕事・関係性・意思決定は、引き続きローカルPersonal OSが正本である。
- raw sourceとcandidateは、利用者が承認してcanonical SSOTへ昇格するまで事実として扱わない。
- OSS標準Ontologyは公開・再利用可能な意味契約だけを持ち、個人固有の値やUnson内部語彙を含めない。
- agentは新しい型や関係を提案できるが、利用者の承認なしにcanonical factまたはactive ruleへ昇格させない。

## Engineering Judgment Spine

### Current reality

既存OSSはcanonical local SSOTの形式検証とread-only MCPを持つが、型・関係・意思決定を横断する意味検証、明示supersession推論、Ontology version影響確認は持たない。旧MCP 5 toolsと既存record schemaは公開契約として稼働している。

### Invariants

- canonical factは引き続き利用者承認済みのローカルPersonal OSだけに置く。
- 既存MCP tool、既存Decision record、既存onboarding flowの互換性を壊さない。
- malformedまたは読取不能なsourceを「違反0件」として扱わない。

### Boundaries

Ontology Kernelは公開語彙・純粋な検証・推論を担い、hosted Graph、社内Decision/RACI、secret、個人データを参照しない。CLI/MCPはkernelのadapterであり、独自の意味規則を持たない。

### Failure modes

- schema failure: malformed canonical fileは`unverified`としてfail loudし、writeを開始しない。
- provider failure: 外部providerを必要としないため、ローカルfile以外の障害をkernelへ持ち込まない。
- evidence lifecycle regression: testまたはreviewが現在HEADに結びつかない場合、PR完了証拠として再利用しない。
- semantic conflict: 明示supersessionのない同topic Decisionは勝手に順位付けせずconflictとして返す。

### Done evidence

10件の受け入れ条件をtargeted unit、MCP/CLI integration、MCP stdio E2E、full suite、typecheck、package buildで検証し、現在HEADにstrict bindingする。公開contract変更はREADME・manual・既存MCP-only Specへ反映し、旧Storyとのsupersession境界は本Storyに記録して、1つのreviewableなOntology capability変更として扱う。

### Public contract judgment

変更はadditiveである。既存5 toolsと既存record inputは維持し、新toolとoptional Decision fieldsだけを追加する。破壊的な自動migrationや暗黙のnetwork dependencyは追加しない。

### Scope reviewability judgment

kernel、adapter、pre-write guard、tests、公開manualは同じ意味契約を構成し、分割するとcontractと検証が別PRになって一時的不整合を作るため一つのPRに束ねる。READMEとpackage scriptsもこの公開contractと再現可能なGateに直接必要である。

## スコープ外

- hosted Graph APIや社内運用runtimeの移植
- Unson内部のDecision、RACI、production receipt、鍵、監査snapshotの公開
- OWL、RDF、SHACLなど特定標準への全面移行
- 一般用途の完全な推論エンジン
- 既存ローカルSSOTの自動修復・削除
- raw sourceやcandidateの自動昇格

---
story_id: story-brainbase-ontology-kernel
title: Brainbaseの意味体系を検証・推論・変更管理できるOntology Kernelとして確立する
source_requirement:
  source: Codex conversation 2026-08-02
  approved_at: 2026-08-02
architecture_docs:
  - path: docs/architecture/ADR-021-brainbase-ontology-kernel.md
    status: accepted
related_tasks:
  - task_source: VibePro
    task_ids:
      - ONT-KERNEL-001
status: active
created_at: 2026-08-02
updated_at: 2026-08-02
---

# Brainbaseの意味体系を検証・推論・変更管理できるOntology Kernelとして確立する

## 背景

Brainbaseには、Graphのentity/edge、Core/Extensionの型レジストリ、Glossary、Decision、RACI、Philosophy Contextがすでに存在する。しかし、それぞれの意味と利用規則を一つに結ぶ機械可読な契約がない。

そのため、同じGraphを参照しても、人やagentごとに「`app`と`product`の違い」「`owns`を誰から誰へ張れるか」「旧Decisionをいつ判断材料から外すか」の解釈が変わり得る。現在は個別のコード、ドキュメント、Skill、運用判断がこの不足を補っており、Graph SSOTが保持する事実と、その事実をどう解釈するかが一体の正本になっていない。

## 現状

| 領域 | すでにあるもの | 不足しているもの |
|---|---|---|
| 型 | Core/Extensionの型名と取得契約 | 型ごとの意味、同一性の境界、類似型との使い分け |
| 関係 | Graph edgeと`rel_type` | 正式な関係語彙、接続可能な型、向き、基数、逆関係 |
| 制約 | 個別API・service・運用上の検証 | Graph全体で共有される意味制約と違反時の説明 |
| 推論 | 人やagentによる文脈判断 | 根拠と規則を追跡できる再現可能な導出 |
| 変更管理 | Git履歴、Decision、entity/edgeの履歴 | Ontology全体の版、適用日、互換性、移行、競合解決 |

関係語彙は現在も複数箇所で利用されているが、Graphへの書き込みを一律に拘束する正式な語彙集にはなっていない。このまま語彙と型が増えると、正しいデータが増えるより先に、意味の重複と衝突が増える。

## 変更内容

### 誰が

- Brainbase Graphを読み書きするagentとシステム
- 組織の事実、役割、意思決定を管理する人
- Ontologyの変更を承認・監査する責任者

### 何を

Graphの事実を同じ意味で保存・解釈できる、versionedな「Ontology Kernel」を確立する。Ontology Kernelは次の5領域を一つの意味契約として扱う。

1. **関係語彙**: `owns`、`belongs_to`、`governs`、`supersedes`、`derived_from`、`accountable_for`などについて、意味、向き、接続可能な型、基数、逆関係を定義する。
2. **型ごとの意味**: `app`、`product`、`brand`、`project`などについて、何を同一entityとみなすか、いつその型を使うか、類似型とどう区別するかを定義する。
3. **制約**: 「appにはowner orgが必要」「active Decisionにはdeciderと適用対象が必要」など、正しいGraphであるための条件を検証可能にする。
4. **推論規則**: 明示された事実から導ける判断を、規則、根拠、説明とともに再現可能にする。
5. **変更・衝突ルール**: 名称変更、組織統合、人物重複、定義競合が起きたときの版、適用日、優先順位、履歴保持を定義する。

### なぜ

- agentごとの暗黙知を減らし、同じGraphから同じ判断を再現できるようにする。
- 不正な関係や不完全なDecisionを、利用後ではなく正本へ入る前に検出する。
- 「現在の正しい判断」と「当時そう判断した履歴」を両立させる。
- 型や関係を追加・変更したとき、既存データ、API、agentへの影響を説明して安全に移行できるようにする。

## 意味境界

- Ontology KernelはGraphに保存する事実そのものではなく、事実の意味、許される関係、検証、導出、変更解釈を定める契約である。
- 人、組織、project、Decision、RACIなどの組織的事実は引き続きGraph SSOTに置く。
- 実行手順はSkills/Commands、実行中の状態はAutomation Run、個人ローカル文脈はPersonal KG/Mesh、事業コンテンツは各project repoまたはDriveに置き、Ontologyへ複製しない。
- LLMは新しい型、関係、推論候補を提案できるが、承認されたOntology ruleやGraph factとして暗黙に昇格させない。
- 明示されていない関係や優先順位を、都合のよい推測で補完しない。根拠が足りない場合は競合または未確認として残す。

## 代表シナリオ

### 名称変更

組織やbrandの名称が変わっても、別entityを無条件に新設しない。同一性が維持される場合はcanonical entity、旧名称、適用日、根拠を追跡でき、過去時点の名称も解釈できる。

### 組織統合・人物重複

統合先をcanonicalとして参照できる一方、旧IDと過去の監査証跡は失わない。統合前後の関係がいつ有効だったかを区別できる。

### Decisionの置き換え

新Decisionが旧Decisionを明示的に`supersedes`し、適用日を迎えた場合、現在判断では新Decisionを優先する。明示的な置き換え関係がない場合は、単に新しいという理由だけで旧Decisionを無効化せず、競合として提示する。

### 未登録の関係

agentが未登録の`rel_type`や許可されていない型同士のedgeを書こうとした場合、canonical Graphへ黙って保存せず、どの規則に違反したかを説明する。

## 受け入れ基準

- [ ] Core型と正式採用されたExtension型について、意味、同一性の境界、利用条件、代表例、反例、責任者が機械可読な定義として取得できる。
- [ ] 正式な関係語彙について、意味、始点型、終点型、向き、基数、逆関係または対称性、ライフサイクル、根拠が取得できる。
- [ ] 未登録の関係、または許可されていない型同士の関係は、canonical Graphへの保存前に拒否または隔離され、規則IDと違反理由が返る。
- [ ] 必須属性、必須関係、基数、参照整合性を共通規則で検証できる。少なくともowner orgのないappと、deciderまたは適用対象のないactive Decisionを不正として検出できる。
- [ ] 検証は書き込み前のdry-runと既存Graphの監査の両方で実行でき、違反件数を欠損や接続失敗と混同しない。
- [ ] 推論結果には、規則ID、Ontology version、根拠entity/edge、導出時刻、説明が付与され、明示事実と導出事実を区別できる。
- [ ] `supersedes`と適用日に基づき現在有効なDecisionを再現可能に判定できる。置き換え関係がないDecision同士は、自動で優先順位を作らず競合として返す。
- [ ] Ontologyの各releaseについて、version、前version、適用日、変更分類、互換性、影響範囲、移行方針、rollback方針を取得できる。
- [ ] 過去のentity、edge、Decisionは、その時点で有効だったOntology versionで解釈でき、名称変更、統合、重複解消によって履歴やprovenanceが破壊されない。
- [ ] 型、関係、制約、推論規則の変更前に、影響を受けるGraph件数、代表例、API、agent、移行要否を示すimpact reportを確認できる。
- [ ] Ontology変更の提案者、決裁者、適用者がRACIに結びつき、承認前の変更がcanonical versionとして公開されない。
- [ ] canonical versionの公開は認証済みapplier、Decision内で承認されたversion・digest・source commit、scopeのAccountable RACIへ署名付きで結びつく。merge commitを許容しつつ、source commitの直接の子であるpublication commitが許可生成物だけを変更した履歴をCIで検証し、squash/rebaseによる証跡消失、証跡改ざん、生成viewのdriftを拒否できる。
- [ ] 現行のCore/Extension型の取得契約と、Extensionを既定表示から除外する互換性を維持する。
- [ ] 名称変更、組織統合、人物重複、Decision置き換え、不正な関係のfixtureで、検証・推論・履歴解釈を再現できる。
- [ ] activeなcurrentが存在する場合はcurrent Ontology versionを取得できる。初期`1.0.0`がproposedだけの間は、version指定で候補定義・検証結果・推論根拠をreadbackでき、current取得は`ONTOLOGY_CURRENT_UNAVAILABLE`として未公開を明示する。
- [ ] current不在時は、既存writeをproposed規則で「検証済み」と扱わず従来互換で継続し、guard結果を`inactive_no_current`として記録する。新設atomic commit・DB audit・version未指定の検証/推論/impactは503でfail closedにする。
- [ ] 実Decision、対象scopeのAccountable RACI、署名鍵を揃えて`1.0.0`をactive化する作業を必須の後続Taskとして残し、それまではcanonical保存前guardの有効化を完了扱いしない。

## Architectureで決めること

- Ontology定義のcanonical sourceと、Graph・repo・生成viewの境界
- 型と関係の識別子、拡張手順、廃止手順
- 制約を適用する書き込み境界と、既存データ違反の隔離方法
- 推論を問い合わせ時に計算するか、導出事実として保持するかの境界
- version、effective date、互換性、migration、rollbackの契約
- 競合時の優先順位と、人間の承認が必要になる条件

## スコープ外

- OWL、RDF、SHACLなど特定の標準や実装方式をこのStoryだけで決定すること
- 一般用途の完全な推論エンジンを作ること
- 既存Graphデータを一括で自動修正または物理削除すること
- Skills、Commands、project文書、Automation Run、Personal KGの内容をGraphへ複製すること
- 根拠のない関係、Decisionの優先順位、entity統合をAIが自動確定すること
- 一般用途の完全なOntology推論基盤を一度のreleaseで実装すること。最初のreleaseでは5領域それぞれの最小契約とaccess-scopeを限定したDB-backed auditを実装し、scopeなしのGraph全件監査や自動移行は後続Taskに分割する。

---

**ガードレール**: このStoryは到達状態と意味境界を定義する。保存形式、ライブラリ、テーブル、クラス構成はADR・Spec・Taskで決定する。

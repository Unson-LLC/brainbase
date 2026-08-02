---
spec_id: SPEC-BRAINBASE-ONTOLOGY-KERNEL
story_id: story-brainbase-ontology-kernel
architecture: docs/architecture/ADR-021-brainbase-ontology-kernel.md
status: accepted
version: 1.0.0
date: 2026-08-02
---

# Brainbase Ontology Kernel Spec

## 目的

Graph factの意味、検証、推論、変更解釈をversionedな決定的契約として提供する。v1は5領域すべての最小実行可能contractを実装し、既存Graphの自動修正は行わない。

## 要件

### ONT-001 Manifest readback

- immutable releaseは`ontology_version`、`schema_version`、`previous_version`、`effective_at`、status、compatibility、migration、rollbackを持ち、indexからcurrent、version、as-ofで解決できる。
- 型、関係、制約、推論規則、変更・競合規則をIDで取得できる。
- manifestは起動時にschema整合性を検証し、不正ならfail loudする。

### ONT-002 型と関係

- `app`、`product`、`brand`、`project`を含む登録型はdescription、identity、usage、examples、counter_examples、ownerを持つ。
- `owns`、`belongs_to`、`governs`、`supersedes`、`derived_from`、`accountable_for`と既存write pathのrelationを登録する。
- relationはfrom/to型、direction、cardinality、inverseまたはsymmetric、lifecycle、provenanceを持つ。
- 未登録型、未登録relation、許可外endpointはrule ID付きviolationになる。

### ONT-003 制約と監査

- `CON-APP-OWNER-001`: appは`owns`または`owned_by`でorg ownerを1つ以上持つ。
- `CON-DECISION-ACTIVE-001`: active Decisionはdecider personとscope project/org/app/productを持つ。
- entity、edge、snapshotのdry-runは永続化しない。
- snapshotが欠落・不完全なら`unverified`を返し、違反0件にしない。
- 必須relationを持つ新規entityはatomic commitでentityとedgeを同一transaction内に検証し、違反時は全体をrollbackする。
- DB-backed auditはaccess scope、pagination cursor完走、取得件数、失敗をcompletenessとして返し、caller snapshot dry-runと区別する。

### ONT-004 Decision推論

- `INF-DECISION-SUPERSESSION-001`: activeかつeffectiveな後継Decisionが明示的に旧Decisionを`supersedes`するとき、現在有効なDecisionを後継へ解決する。
- 明示的な`supersedes`がない複数active Decisionは`conflict`となる。
- 結果はrule ID、Ontology version、evidence、as-of、explanation、explicit/inferred区分を含む。

### ONT-005 変更、履歴、impact

- change classifierはbreaking/additive/patchをSemVer規則へ写像する。
- renameはcanonical IDを維持し、merge/dedupは旧IDとprovenanceを残す。
- 同時有効な競合定義を暗黙に統合しない。
- 過去factは記録version、なければas-of時刻に対応するimmutable releaseで解釈し、解決不能なら`unverified`とする。
- impact APIは変更対象の型・関係・ruleに一致するsnapshot件数、代表ID、影響API/agent、migration要否を返す。snapshotがない場合は`unverified`とする。

### ONT-006 API

- `GET /api/info/ontology` current manifest
- `GET /api/info/ontology/releases/:version` immutable release
- `GET /api/info/ontology?as_of=<timestamp>` effective release
- `GET /api/info/ontology/types/:id` 型定義
- `GET /api/info/ontology/relations/:id` relation定義
- `POST /api/info/ontology/validate` entity/edge/snapshot dry-run
- `POST /api/info/ontology/audit` access-scope内のDB-backed audit
- `POST /api/info/ontology/graph/commit` entityと必須edgeのatomic commit
- `POST /api/info/ontology/infer/decisions` Decision解決
- `POST /api/info/ontology/impact` 変更impact
- 全endpointは既存Info SSOT access contextを必須とする。

### ONT-007 互換性

- MCPのCore/Extension型とExtension既定非表示契約を維持する。
- 既存専用write pathのrelationはv1 manifestへ登録する。
- 汎用write APIの新規不正入力を拒否するが、既存Graphを自動変更しない。
- 既存の分離writeは登録型・relation・endpointをguardし、必須relation強制はatomic commitへ移行する。既存ownerなしentity作成契約はv1で即時破壊しない。
- manifestはpublic ID、storage type、visibility、aliasを明示し、ADR-007とMCP projectionの差をcontract testで固定する。

#### Legacy write surface matrix

| 経路 | entity / storage type | relation | v1の扱い | pre-fixを落とすfixture |
|---|---|---|---|---|
| `POST /graph/entities`、`POST /graph/edges` | manifest登録型 | `depends_on`を含む登録relation | 型・relation・endpoint guard。ownerなしapp単体は互換維持 | unknown type/relationは400、ownerなしappとapp間`depends_on`は201 |
| `POST /decisions` | `decision` | `belongs_to_project`、`owned_by`、`member_of` | 専用transactionを維持し、出力語彙をmanifest contract testで拘束 | 作成成功と3 relationの登録一致 |
| `POST /raci` | public `raci` / storage `raci_assignment` | `belongs_to_project`、`assigned_to`、`member_of` | projectionと専用transactionを維持 | public/storage aliasと3 relationの登録一致 |
| `POST /glossary` | `glossary_term` | `belongs_to_project` | 専用path維持 | type/relationのmanifest登録一致 |
| `POST /kpi` | `kpi` | `belongs_to_project` | `internal`型として専用path維持 | type/relationのmanifest登録一致 |
| `POST /initiative` | `initiative` | `belongs_to_project`、`owned_by`、`member_of` | `internal`型として専用path維持 | typeと3 relationのmanifest登録一致 |
| `POST /ai/query` | `ai_query` | `belongs_to_project`、`requested_by`、`member_of` | `internal`型として専用path維持 | typeと3 relationのmanifest登録一致 |
| `POST /ai/decision-log` | `ai_decision` | `belongs_to_project`、`made_by`、`references`、`member_of` | `internal`型として専用path維持 | typeと4 relationのmanifest登録一致 |
| `POST /events` | Graph entityなし | なし | Ontology guard非該当。event tableの既存契約を維持 | Graph entity/edgeが増えない既存service test |
| `scripts/info-ssot-migrate-codex.js` | legacy migration inventory | 上記compatibility relation | v1 runtime guardの対象外。manifest inventory verifierを必須化し、未知値をfailする | script内type/relation literalが全てmanifest分類済み |
| その他のdirect migration/upsert script | migration固有型 | migration固有relation | runtime API非該当。自動実行せず後続guard移行、inventory auditでは`deferred`を明示 | inventory reportにscript、値、deferred理由が出る |

専用pathはv1でkernelを直接呼ばないが、manifest contract testが上表の出力語彙を拘束する。silent bypassではなく、未登録値はtest/verify gateのfindingにする。

### ONT-008 Release governance

- releaseは`proposed`、`approved`、`active`、`retired`の状態を持つ。
- proposer、decider、applierのGraph entity ID、RACI scope、根拠Decision IDを持つ。
- 対象scopeのAccountable承認と適用証跡がないreleaseはcurrent indexへ公開できない。
- current indexは`ontology:publish`だけが生成し、対象HEAD、release SHA-256、Graph RACI、根拠Decision、applierを検証する。Graph/authorityを確認できない場合は公開を失敗させる。
- `ontology:verify`はbase refと比較し、publisher証跡のないcurrent変更、既公開versionの変更・削除・version再利用を拒否する。

## テスト計画

1. manifest contract: version情報と5領域の必須field、MCP型projectionとの一致。
2. validation contract: 正しい型・relationを許可し、未登録・endpoint違反を拒否する。
3. constraint contract: ownerなしapp、decider/scopeなしactive Decision、snapshot欠落を検出する。
4. inference contract: 明示supersedesとeffective dateで解決し、無関係なactive Decisionはconflictにする。
5. evolution contract: SemVer分類、rename/merge履歴、snapshotあり/なしのimpactを説明する。
6. API/service integration: readback、dry-run、atomic rollback、分離write互換、structured error、access contextを検証する。
7. audit contract: scope、pagination完走、partial/DB failureの`unverified`を検証する。
8. release/history contract: current/version/as-of解決、未知version、RACI publication gateを検証する。
9. compatibility matrix: 上表の全route/scriptについて、ownerなしapp、`depends_on`、専用write、public/storage alias、登録語彙または明示deferredをfixture化する。
10. publication integrity: 手動index変更、authority未確認、release digest差し替え、過去release削除、version再利用を失敗させる。

## Clause ID正本

VibePro accepted Specが付与する`C-*`、`INV-*`、`S-*`をclause ID正本とし、`ONT-*`はrequirement IDとして使う。tracked JSONとaccepted Specのclause IDは同一に保つ。

## 完了境界

v1の完了は、上記contract test、対象service/route test、typecheck、VibePro Gateが通過した状態とする。scopeなしの実データ全件監査と全専用write pathのguard移行は結果を偽らず後続Taskとして残す。

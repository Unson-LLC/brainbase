---
adr_id: ADR-023
title: Brainbase owns canonical company authority and signs only resolved execution context
status: accepted
date: 2026-08-19
related_stories:
  - story-canonical-company-authority-context
  - story-personal-organization-boundary
  - story-brainbase-multitenant-platform
related_docs:
  - docs/architecture/ADR-008-acl-vocabulary.md
  - docs/architecture/ADR-010-memory-promotion-kernel-boundary.md
  - docs/architecture/ADR-021-brainbase-ontology-kernel.md
  - docs/decisions/2026-08-18_intent-to-outcome-north-star.md
  - docs/management/milestones/M0-company-authority-and-personal-boundary.md
supersedes: []
superseded_by: []
---

# ADR-023: Brainbaseが会社権限を正本解決する

## Context

Brainbaseとmana-runtimeのマルチテナント基盤は、canonical tenant、workspace connection、connection revision、credential、Usage、Operation Receiptを分離し、tenant越境をfail closedにする土台を持つ。

一方、現在のtenant context経路では、外部runtimeが組み立てた`actor`と`authorization`をBrainbaseが受け取り、tenant・connection・contractを確認した後に署名済みcontextへ含める経路が残る。この状態では、contextが改ざんされていないことは証明できても、次は証明できない。

- 外部subjectがGraph上のどのcanonical personか
- そのpersonが現在どのorganizationへ所属しているか
- 対象project・resourceへどの役割で関与しているか
- RACI上のResponsible、Accountable、Approverが誰か
- actionが`auto / approval / human_action / deny`のどれか
- Personal KGのownerが誰か
- delegation、policy、RACIのどのrevisionで許可されたか

これはtenant境界の不備ではなく、**会社権限の意味を誰が正本化するか**という責務のずれである。強い署名機構が、runtimeの自己申告を強く固定する構造にしてはならない。

同時に、Personal KGには単一利用者互換の暗黙owner、所有者未指定時のfallback、本人承認だけで組織Knowledge Eventへ進む経路が残る。これらは、組織版を個人版の能力上の上位互換としながら個人データ境界を守る方針と衝突する。

## Decision

### 1. Brainbaseを会社権限の唯一の正本解決者にする

Brainbaseは、tenantだけでなく、実行時に必要な会社権限をGraph、membership、project、RACI、policy、delegation、resource ownershipから解決する。

mana-runtime、CLI、MCP、Slack、Codex、Claude Code、background jobは、canonical person、organization、RACI、authority decisionを自己申告してはならない。

外部runtimeが送ってよいのは、観測された外部identityと要求だけである。

```ts
interface ObservedExecutionRequestV1 {
  provider_identity: {
    provider: "slack" | "codex" | "claude_code" | "service";
    authenticated_subject_id: string;
    app_id?: string;
    workspace_id?: string;
    enterprise_id?: string;
  };
  requested_action: {
    capability_id: string; // requested operation capability, not the protocol marker
    resource_ref: string;
    project_hint?: string;
    desired_effect: "read" | "write" | "external_side_effect";
  };
  delivery?: {
    channel_id?: string;
    thread_ts?: string;
    event_id?: string;
  };
  correlation_id: string;
}
```

`project_hint`は検索候補を狭めるためのhintであり、認可根拠にはしない。

### 2. BrainbaseがCanonical Execution Contextを発行する

Brainbaseは正本解決後、既存のtenant contextを包含する`CanonicalExecutionContextV1`を発行する。

```ts
interface CanonicalExecutionContextV1 {
  schema_version: "1.0";
  tenant_context: TenantContextEnvelopeV1;

  actor: {
    external_subject_id: string;
    canonical_person_id: string;
    membership_id: string;
    membership_revision: string;
  };

  scope: {
    organization_id: string;
    project_id: string;
    resource_ref: string;
    owner_person_id: string | null;
    placement_id: string;
  };

  authority: {
    decision: "auto" | "approval" | "human_action" | "deny";
    capability_id: string; // equals requested_action.capability_id
    responsible_person_id: string | null;
    accountable_person_id: string | null;
    approver_person_id: string | null;
    delegated_by_person_id: string | null;
    policy_revision: string;
    raci_revision: string;
    resource_revision: string;
    allowed_effects: Array<"read" | "write" | "external_side_effect">;
    stop_conditions: string[];
  };

  evidence: {
    identity_resolution_receipt_id: string;
    authority_resolution_receipt_id: string;
  };

  issued_at: string;
  expires_at: string;
  integrity: SignedIntegrity;
}
```

既存の`TenantContextEnvelopeV1.actor`と`authorization`は、移行後はBrainbaseが解決した値から生成する。runtimeから受け取った値をそのまま署名しない。

### 3. authority resolutionは決定論的に行う

Brainbaseは次の順で解決する。

```text
外部subject
  → canonical person
  → active membership
  → organization / project / resource ownership
  → role / RACI / delegation
  → policy / capability / stop condition
  → auto / approval / human_action / deny
  → signed Canonical Execution Context
```

次は業務処理・モデル実行・tool実行より前に拒否する。

- identity未解決または複数一致
- inactive／失効membership
- organization、project、resourceの不一致
- RACIまたはpolicy revisionの未取得・古い値
- owner未解決
- capabilityまたはeffect不一致
- authority decisionが`deny`
- context署名、TTL、audience、deployment、revisionの不一致

失敗をdefault person、default organization、default project、default placementへ寄せない。

### 4. MANAは権限のconsumerであり、権限の作者ではない

MANAは`requested_action`を構築し、Brainbaseから返ったcontextを各境界で再検証する。

MANAが行ってよいことは次である。

- provider identityと要求を収集する
- Brainbaseへ解決要求を送る
- 署名済みcontextの範囲で実行する
- `approval`なら指定approverへ判断packetを送る
- `human_action`なら指定personへ行動を依頼する
- `deny`なら実行しない
- 実行結果、Usage、Receipt、readbackをBrainbaseへ返す

MANAはorganization、project、owner、RACI、approver、policyを補完・推測・上書きしない。

### 5. workspace connection hintを非権威cacheへ降格する

workspace ID、app ID、enterprise ID、installation IDからcanonical tenant／connectionを解決する責務はBrainbase control planeに置く。

runtime側のhintは次に限定する。

- routingを速める非権威cache
- revisionと失効時刻を持つ
- Brainbase authoritative readbackと一致しなければ破棄
- hint単独ではLLM、Graph、Task、credentialへ到達しない

### 6. Personal KGのownerを認証済みpersonからのみ決める

Personal KGのownerは、認証済みcanonical personまたは明示的なservice delegationから導出する。

禁止するもの:

- `sato_keigo`その他のdefault owner
- owner未指定時の暗黙fallback
- CLI引数、request body、環境変数だけによる別人指定
- organization adminによるPersonal KG本文の当然閲覧
- service proxyがdelegation receiptなしにownerを選ぶこと

互換aliasは、明示的な`external_alias → canonical_person_id`の移行mappingとしてだけ保持し、fallbackには使わない。

### 7. PersonalからOrganizationへの昇格を二段階にする

Personal KGの個人利用承認と、組織共有同意と、組織側採用を分離する。

```text
personal_candidate
  → owner_approved_for_personal_use
  → owner_consented_for_org_review
  → pending_org_review
  → org_accepted | org_rejected
```

`owner_approved_for_personal_use`だけでは組織Knowledge EventまたはGraphへ書かない。

各decisionは、直前stateのrevisionを期待値として受け取り、成功時にrevisionを1つ進める。owner consentとorganization reviewは、それぞれのactor、decision revision、receiptを保持する。stale revisionまたは同じrevisionの再配送は状態を進めず、Graph writeを含む下流effectより前に拒否する。

組織へ昇格できるのは次だけである。

- 正規化した事実
- 正規化した判断
- 明示的な関係
- applicability scope
- sensitivityとrole_min
- 根拠pointerとhash
- owner consent receipt
- organization review receipt

Personal KG本文、私的メモ、価値観の原文、raw transcriptをGraphへコピーしない。GraphからPersonal本文を復元できないことを否定テストする。

### 8. 既存tenant protocolとの移行境界

既存`mana-brainbase-tenant-context` v1はtenant安全境界として維持する。会社authority contract v1では、要求したoperationの`requested_action.capability_id`と、tenant contextの`authorization.capability_ids`に含める`company_authority_v1` protocol markerを別の値・責務として扱う。解決後の`authority.capability_id`は要求したoperation capabilityと一致させ、`company_authority_v1`は会社authority wireを解釈できることを示すmarkerとしてだけ要求する。

同じrequestのSlack `workspace_id`、`app_id`、`enterprise_id`、deliveryの`channel_id`、`thread_ts`、`event_id`は、埋込みTenantContextのworkspace connection／Slack値へ束縛する。不一致はfail closedとする。consumerはouter company-authority JWSだけでなく、trusted keyを明示してnested TenantContext JWSも同じcaller evaluation time、`mana-runtime` audience、期待deploymentで検証する。timestampはshared verifierと同じUTC `Z`形式に限定し、error envelopeの`error.correlation_id`はwire rootの`correlation_id`と一致させる。署名済みcontextであっても`authority.decision=deny`は成功contextとして受け付けず、`COMPANY_AUTHORITY_DENIED` errorとして扱う。

`company_authority_v1`がない間に許可できるのは次だけである。

- health
- protocol negotiation
- tenant／connection provisioning
- connection revision診断
- credential本文を扱わないreadiness診断
- tenant境界の否定テスト

組織Graph、Canonical Task、Personal KG、組織知識、外部side effectは許可しない。

## Milestone order

実装順を次で固定する。

1. M0: Brainbase-owned company authority
2. M1: Personal identity、no-fallback、二段階昇格
3. M2: 梅田さん組織版E2E
4. M3: TechKnight shared-cloud本番E2E
5. M4: MANA経営実行ループ
6. M5: 個人版OSS／組織版の公開CLI・MCP上位互換完了

M0とM1を完了する前に、CLI入口数や組織版23/23を製品完成指標にしない。インフラprovisioningとtenant分離テストは並行可能だが、会社データを扱うcanaryはM0を通過してから行う。

## Consequences

### Positive

- tenant-safeに加えてcompany-authority-safeになる。
- Brainbaseが会社の脳、MANAが実行系という責務がコード上でも一致する。
- RACI、policy、delegation変更が署名revisionとしてruntimeへ伝播する。
- Personal KGと組織Graphの境界を、管理者権限ではなく所有権と同意で守れる。
- Umeda／TechKnight／OSSで同じauthority contractを再利用できる。

### Cost

- tenant context producer、Graph resolver、membership、RACI、policyの接続が必要になる。
- MANAのingressとHTTP clientからactor／authorization組立を除去する必要がある。
- 進行中の組織版CLIスタックはM0へrebaseし、acceptance criteriaとnegative fixtureを更新する必要がある。
- 本番E2Eの完了時期は後ろへずれるが、後から公開面を壊すより総手戻りは小さい。

## Verification

M0の完了には、最低限、次を同一correlation IDで証明する。

1. Slack／Codex／Claude Codeの外部subjectがcanonical personへ一意に解決される。
2. Brainbaseがmembership、organization、project、resource、RACI、policyをreadbackする。
3. MANAがcanonical actor／authorizationを自己生成しない。
4. stale RACI、stale policy、unknown person、ambiguous person、scope外resourceをモデル実行前に拒否する。
5. Tenant A／Bの越境拒否と、佐藤／梅田のPersonal KG相互非漏洩を同時に通す。
6. ownerなし、owner詐称、organization不一致をすべてfail closedにする。
7. owner consentだけではGraphへ書かれず、別organization reviewerの採用後だけ正規化済みknowledgeが入る。
8. GraphからPersonal本文を復元できない。
9. authority resolution、実行、外部readback、Usage、Operation Receiptを一つのrunで追える。
10. `company_authority_v1`欠落時、会社データoperationが拒否される。

## Non-goals

- このADRだけでMANAのNext Best Action選択ロジックを定義しない。
- このADRだけでGraph ontology全体を再設計しない。
- organization adminへPersonal KG本文の閲覧権を与えない。
- runtimeへBrainbaseの署名秘密鍵を配布しない。
- CLI互換数を、組織版の価値または安全性の代替指標にしない。

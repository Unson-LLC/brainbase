---
story_id: story-tenant-production-provisioning-control-plane
title: テナント本番プロビジョニング制御面
status: active
created_at: 2026-08-19
updated_at: 2026-08-19
horizon: quarter
view: product
source:
  type: implementation-request
  repository: Unson-LLC/brainbase-project
  path: docs/management/stories/active/story-brainbase-multitenant-platform.md
architecture_reason: "本番テナントの生成、接続、契約、権限を一つの再実行可能な制御面へ束ね、正本DB・Graph・秘密管理の責務を分けるため。"
architecture_docs:
  - path: docs/architecture/story-tenant-production-provisioning-control-plane.md
    status: final
spec_docs:
  - path: docs/specs/story-tenant-production-provisioning-control-plane.md
    status: final
  - path: docs/specs/story-tenant-production-provisioning-control-plane.vibepro.json
    status: final
related:
  - story-brainbase-multitenant-platform
  - https://github.com/Unson-LLC/vibepro/issues/466
---

# テナント本番プロビジョニング制御面

## User Story

Brainbaseの運用担当として、顧客テナント `unson-business` を本番へ登録するとき、同じ宣言を何度実行しても重複や越境を起こさず、検証可能な状態で安全に有効化したい。そうすれば、mana-runtimeやCloudflareから利用するテナント境界・接続・契約・サービス権限を、手作業の推測や秘密値の転記に頼らず再現できる。

## Business Context

既存のマルチテナント基盤は、現在値と履歴の境界、テナント識別子、workspace接続の論理的一意性、接続revisionの参照整合性、プロビジョニング操作の再実行記録が一つの本番手順として固定されていない。これらを曖昧なまま有効化すると、revision更新時の外部キー破綻、再インストール時の接続重複、同じ入力の二重書込み、別tenantへのfallbackが起こり得る。

サービス自身を既存Graphの `person` として登録することも、人物認識の正本を壊すため許可しない。サービスactorとcapabilityは、Brainbaseが所有する制御面のregistryとして管理し、必要な場合だけcanonical Graphの既存projectへ検証済みの参照を持つ。

## Delivery Boundary

このStoryは、Brainbaseが所有する次の本番プロビジョニング境界を扱う。

1. テナント識別子とrevision履歴の正本
2. workspace接続とrevisionの整合性・論理的一意性
3. 宣言的プロビジョニング操作のidempotency ledger
4. service actor／capability registryとcanonical project検証
5. dry-run、明示的なapply承認、失敗時rollback、readbackを持つCLI／サービス境界

Graph ontologyの新しい人物種別追加、実際の秘密値の発行・保管、既存本番DBへの適用、Cloudflareへのデプロイはこの実装の受入れ証跡に含めるが、この変更自身の副作用としては行わない。

## Acceptance Criteria

- [x] AC-001: テナントに人間が読める `tenant_key` と不変のcanonical tenant IDを持たせ、同一keyの重複を拒否できる。
- [x] AC-002: テナントrevisionを履歴として保持し、tenant-owned recordは現在値だけでなく書込み時revisionへ参照整合する。revision更新で既存recordの外部キーを壊さない。
- [x] AC-003: 同じtenant・provider・workspace・appの有効接続は一つだけで、再インストールは既存connectionのrevision更新として表現できる。
- [x] AC-004: `workspace_connection_revisions`を不変snapshotの正本とし、`workspace_connections`のcurrent pointerは既存snapshotだけを指す。credential・usage・receipt等のrevision参照は履歴へ向け、snapshot追加前にcurrent pointerを進めず、孤立snapshotや存在しないcurrent revisionを保存できない。
- [x] AC-005: 同じidempotency keyと同じ宣言の再実行は、既存の成功結果を返して書込みを増やさない。keyと宣言の不一致はconflictとして拒否する。
- [x] AC-006: provisionerはschema確認、tenant、tenant revision、workspace connection、contract、service registry、canonical project検証を一つの明示的な段階として実行し、途中失敗時に有効化状態を残さない。contract revisionは契約本体payloadとruntime bindingを宣言から完全に検証・保存・readbackし、既存revisionとの不一致をconflictとして拒否する。
- [x] AC-007: service actorとcapabilityはBrainbaseのregistryで一意に管理し、既存Graphへ `person` として書き込まない。権限付与はactor、capability、tenant、project境界を検証してから行う。
- [x] AC-008: manifest、通常ログ、receipt、Graphにはtoken、secret、private key、OAuth本文を一切出さず、opaque credential referenceとpublic key metadataだけを扱う。
- [x] AC-009: CLIはデフォルトでread-onlyまたはdry-runであり、DB書込みには明示的なapply承認と実行actorを要求する。migration actorは `BRAINBASE_MIGRATION_ACTOR` から取得してDB ledgerの `applied_by` に記録し、本番適用は `--approve-apply` とrollout receiptで承認を固定する。出力は秘密値を含まないJSONで再読込できる。
- [x] AC-010: schema差分、provisioning結果、Graph検証結果、contract revision readbackを同一operation IDで追跡でき、未確認・障害・部分適用を成功や0件へ丸めない。
- [x] AC-011: provisionerは短いtransactionでoperation claimとattemptを永続化してcommit・lock解放した後だけ、`createPostgresGraphProjectResolver` によるread-onlyのcanonical projects lookupをbounded timeout付きで呼ぶ。適用はfresh transactionで同じclaimをfencing確認してから行い、失敗後の再試行で発行した新claimに対して旧実行が完了を書き込めない。
- [x] AC-012: Slack OAuth callbackはintent、request digest、exchange claimを短いtransactionで永続化してから外部token exchangeを行う。登録はfresh transactionで同じclaimとtenant／workspace／app bindingを再検証し、connectionの不変snapshot追加、current pointer更新、opaque credential参照、intent消費、ledger完了を原子的に確定する。完了済みcallbackは保存結果を返し、同時callback、replay、workspace／app衝突、旧claimの完了はfail closedにする。

## Scenarios

- `TPP-S-001`: `unson-business` の同じmanifestを2回適用すると、2回目は既存operationの結果を返し、tenant・connection・registryを重複作成しない。
- `TPP-S-002`: 同じidempotency keyでtenant_key、workspace、contractのいずれかを変えるとconflictになり、DBやGraphへ副作用を出さない。
- `TPP-S-003`: tenant revisionを進めても過去revisionで保存したtenant-owned recordを読み戻せる。
- `TPP-S-004`: workspaceを再インストールするとconnection IDを推測で作り直さず、論理的に同じ接続の新revisionへ進む。
- `TPP-S-005`: Graphのproject codeが未登録・複数候補・別projectの場合、service registryや有効化を行わずfail closedにする。
- `TPP-S-006`: credential refが未登録・別tenant・別connection metadata・revokedの場合はfail closedにする。初回接続の未登録opaque refも、既存所有者が0件であることに加え、canonical credential boundaryがrefの存在とtenant／provider／workspace／app bindingをread-onlyで証明できた場合だけ `first_install` として続行する。boundary未設定・unavailable・no data・別tenantは拒否し、秘密値は探索せず、ログにはrefと失敗分類だけを残す。
- `TPP-S-007`: schema blockerが未適用、schema hashが不一致、DBが到達不能の場合、通常provisioningを開始せず、既存テナントを変更しない。
- `TPP-S-008`: claim永続化後にGraphまたはcredential resolverがtimeout／unavailableになると業務行を保存せず、同じkey・fingerprintだけを新claimで再試行でき、旧実行の遅延完了はfencingで拒否される。
- `TPP-S-009`: 同じSlack OAuth callbackが同時到着しても外部token exchangeは一回だけ行い、完了後のreplayは保存済み結果を返す。失敗後の再試行は新claimで行い、旧claimや別workspace／appによる確定は拒否する。
- `TPP-S-010`: 宣言されたcontract revisionは、契約本体payload（契約ID、status、有効期間、plan、allowance、閾値、超過方針、価格revision群）とruntime binding（capabilities、audience、deployment、profile）を分離して保存・readbackする。同じtenant／revisionの既存値と一項目でも異なる場合は有効化せずconflictにする。

## Evidence and Completion

- AC-001〜012のチェックは、Architecture、Spec、schema contract、CLIテスト、repository transactionテスト、秘密値非露出テストを同じGit HEADで検証したコード受入れの結果を示す。VibeProのstrict-head検証証跡でHEAD、テスト結果、作業木不変を固定する。
- dry-runとapply（テスト用DBのみ）の結果で、操作ledger、tenant revision、connection revision、registry、canonical project検証、readbackを照合できる。
- 本番DB適用、秘密値発行、Graphの人物ontology変更、Cloudflareデプロイ、Slack E2Eは別の配備受入れであり、現時点では未実施と明示する。これらをArchitecture／Spec lifecycleの `final` やコード受入れ完了へ読み替えない。

## Out of Scope

- 既存Graph ontologyへ `service_actor` や `capability` を `person` として追加すること
- provider token、OAuth secret、署名秘密鍵をCLI・DB・manifest・ログへ保存すること
- 本番DBへのmigration apply、Cloudflare／mana-runtimeのデプロイ、Slack E2Eの切替
- 顧客固有の価格・契約内容の決定

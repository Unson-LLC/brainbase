---
story_id: story-canonical-company-authority-context
title: "Brainbaseが会社権限を正本解決しMANAへ署名済みcontextを渡す"
status: active
source:
  type: product-direction
  id: company-authority-first-2026-08-19
architecture_reason: "tenant分離だけでなく、canonical person、membership、organization、project、RACI、policy、Personal ownerをBrainbaseが正本解決し、runtimeの自己申告へ署名しない境界を固定する。"
architecture_docs:
  - docs/architecture/ADR-023-brainbase-owned-company-authority.md
  - docs/architecture/ADR-008-acl-vocabulary.md
  - docs/architecture/ADR-010-memory-promotion-kernel-boundary.md
spec_docs: []
related_tasks:
  - docs/management/milestones/M0-company-authority-and-personal-boundary.md
---

# Brainbaseが会社権限を正本解決しMANAへ署名済みcontextを渡す

## Background

現在のtenant contextは、tenant、workspace connection、revision、credential、Usage、Receiptの境界を強化している。一方、外部runtimeが組み立てたactorとauthorizationをBrainbaseが署名する経路では、会社のGraph上で正しい人物・所属・RACI・policyかを証明できない。

また、Personal KGの暗黙ownerと一段階の組織昇格は、複数人組織版と矛盾する。

本Storyは、Brainbaseをcanonical company authorityの唯一の解決者とし、MANAを署名済み権限のconsumerへ限定する。

## User outcome

組織メンバーは、MANAやCLIへ自分の権限を細かく指定しなくても、Brainbase上の本人・所属・役割・責任に沿った範囲だけで仕事を進められる。

管理者は、誰が、どのRACI・policy revisionで、何を自動実行・承認・拒否されたかを監査できる。

Personal KGの本文は本人だけが使い、組織へ共有する場合も本人同意と別の組織採用を経る。

## Acceptance criteria

### AC-001: observed identityとcanonical identityを分離する

Slack user ID、Codex profile、Claude Code profile、service subjectをcanonical person IDとして直接採用しない。Brainbaseのidentity mappingとGraphから一意に解決する。

### AC-002: membershipを正本解決する

canonical personのactive membership、organization、membership revisionを同一authority resolutionで取得する。inactive、unknown、ambiguousを業務処理前に拒否する。

### AC-003: organization、project、resourceを正本解決する

workspace ID、organization名、project code、request bodyのownerを認可根拠にしない。tenant ownership、project membership、resource ownershipを正本から確認する。

### AC-004: RACIとpolicyを正本解決する

requested actionを`auto / approval / human_action / deny`へ分類し、Responsible、Accountable、Approver、delegation、policy revision、RACI revision、stop conditionを返す。

### AC-005: runtime自己申告へ署名しない

MANAまたは他runtimeから渡されたcanonical actor、organization、project、owner、RACI、approver、authority decisionをそのまま署名済みcontextへ含めない。

### AC-006: CanonicalExecutionContextV1を署名する

既存TenantContext、canonical actor、scope、authority、resolution receipt、revision、TTL、audience、deploymentを一つの署名済みcontextとして発行する。

### AC-007: 全entry pointで同じcontextを強制する

admin API、MCP、background job、migration、audit、Slack、Codex、Claude Code、MANA Queue、Container、provider writeが同じcontextを検証する。

### AC-008: no-fallbackを保証する

person、owner、organization、project、resource、RACI、policy、connectionが未解決・複数一致・古い場合、佐藤さん、雲孫、default tenant、default project、default placement、運営者credentialへfallbackしない。

### AC-009: Personal KG ownerを本人から導出する

Personal KG ownerは認証済みcanonical personまたは明示delegation receiptからのみ導出し、`sato_keigo`その他のdefault ownerを使わない。

### AC-010: cross-personを非開示で拒否する

佐藤さんから梅田さん、梅田さんから佐藤さんのPersonal KGを検索・取得・更新できず、存在自体を推測できない。

### AC-011: Personal reviewとorganization reviewを分離する

本人の個人利用承認、組織共有同意、組織reviewerの採用を別state・別actor・別revision・別receiptで保持する。

### AC-012: Personal本文をGraphへコピーしない

Graphへは正規化した事実・判断・関係・scope・evidence pointer・hashだけを昇格し、Personal本文、raw transcript、私的メモを保存しない。Graphから本文を復元できない。

### AC-013: 2 tenant × 2 personのnegative E2Eを通す

Tenant A／B、佐藤／梅田を使い、正常系、tenant越境、person越境、stale revision、scope外resource、誤承認者、再配送をfresh E2Eで証明する。

### AC-014: Intent→Outcome証拠を閉じる

identity resolution、authority resolution、実行、外部readback、UsageEvent、OperationReceiptを同一correlation IDへ関連付け、未取得を`not_collected`として残す。

### AC-015: company authority欠落時の許可範囲を限定する

`company_authority_v1`がない場合はhealth、protocol negotiation、provisioning、connection診断、tenant否定テストだけを許可し、会社データのread／write／external side effectを拒否する。

## Out of scope

- Next Best Actionの価値計算式
- organization adminによるPersonal KG本文閲覧
- runtimeへの署名秘密鍵配布
- CLI入口数だけによる組織版完成判定

## Dependencies

- Brainbase multitenant platform
- workspace connection control plane
- Graph person／membership／project／RACI data
- mana-runtime consumer Story

## Release gate

本Storyが完了するまで、次を完了扱いにしない。

- 組織版CLI／MCP 23/23
- 梅田さん本番Personal KG付与
- TechKnight会社データread/write canary
- RACIに基づくMANA自律実行
- Personal→Organization昇格の本番開放

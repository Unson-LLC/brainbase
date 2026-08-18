---
story_id: story-brainbase-multitenant-platform
title: BrainbaseをCloud／OSS共通のマルチテナント基盤にする
status: active
created_at: 2026-08-16
updated_at: 2026-08-18
horizon: quarter
view: product
source:
  type: business-design
  repository: Unson-LLC/brainbase-project
  path: docs/business/brainbase-mana-multitenant-v1/05-story-boundaries.md
architecture_reason: "ADR必須。tenant正本、認証・認可、credential、課金、Cloud／OSS互換契約を同時に変更し、既存のproject・organization・owner境界へ影響するため。"
architecture_docs:
  - path: docs/architecture/story-brainbase-multitenant-platform.md
    status: accepted
spec_docs:
  - path: docs/specs/story-brainbase-multitenant-platform.vibepro.json
    status: final
  - path: docs/specs/brainbase-multitenant-platform-spec.md
    status: final
related:
  - https://github.com/Unson-LLC/vibepro/issues/466
  - Unson-LLC/mana-runtime:story-mana-multitenant-runtime
  - Unson-LLC/mana-runtime:story-slack-mana-brainbase-multitenant-e2e
---

# BrainbaseをCloud／OSS共通のマルチテナント基盤にする

## User Story

Brainbaseを利用する顧客管理者として、自組織の利用者、プロジェクト、知識、接続、契約、利用量が他組織と混ざらない状態でBrainbaseを導入したい。そうすれば、Brainbase Cloudまたは互換OSSを選択しても、八雲まな等の外部ランタイムを同じ安全な接続契約で利用できる。

## Business Context

現行のworkspace、organization、project、ownerは個別の境界として存在するが、契約主体、外部接続、credential、利用量を一貫して所有するcanonical tenant contractがない。Slack workspace IDやproject codeをtenant IDの代用にすると、複数workspace、再インストール、OSS接続、契約変更、課金帰属を安全に表現できない。

VibePro Issue #466はStoryが記載すべき横断Architecture契約を定めるが、Brainbase固有のtenant正本、API、認証・認可、データ移行、Receiptの実装を代替しない。

## Delivery Boundary

このStoryはBrainbaseが所有する次の4領域を完了させる。

1. Tenant正本
2. Workspace Connection
3. 契約・利用量・課金Receipt
4. Cloud／OSS共通接続契約

Slackイベントの受信、Cloudflare Worker／Queue／Durable Object／Containerへのtenant context伝播、Slack返信はmana-runtimeの責務とする。

## Success Metrics

- tenant未解決、不一致、失効、越境アクセスが100% fail closedになる。
- tenant境界を持たない新規の管理・データ・Receipt書込みを0件にする。
- Cloudと互換OSSに対する共通接続contract testを同じfixtureで通す。
- 実行Receiptからtenant別の外部原価と契約上の利用量を照合できる。
- 未計測、取得不能、部分取得を0件または成功として記録しない。

## Acceptance Criteria

**Tenant正本**

- [ ] `AC-001`: canonical `tenant_id`の所有者、生成、ライフサイクル、削除・停止規則が定義される。
- [ ] `AC-002`: organization、membership、project、Graph data、connection、contract、usage、Receiptがtenantへ帰属する。
- [ ] `AC-003`: workspace ID、project code、organization名をtenant IDとして暗黙利用しない。
- [ ] `AC-004`: tenant未解決、複数解決、payload不一致、無効tenantは認証後かつ業務処理前に拒否する。
- [ ] `AC-005`: 管理API、MCP、background job、migration、監査ログが同じtenant境界を強制する。tenant runtimeが無効・未設定・到達不能な場合も管理／監査経路を通過させない。公開副作用を行うjobはproducerが明示したcanonical tenant／resource bindingを永続化し、binding欠落時は暗黙補完せず、claimやprovider呼出しより前に拒否する。
- [ ] `AC-006`: 既存単一組織データの移行は、dry-run、件数照合、rollback、未帰属隔離を持つ。

**Workspace Connection**

- [ ] `AC-101`: 外部workspaceとtenantの関係を`workspace_connection`として正本化する。
- [ ] `AC-102`: 1 tenantの複数workspace、1 workspaceの再インストール履歴、接続失効を表現できる。
- [ ] `AC-103`: installation ID、workspace ID、app ID、scope、status、revisionを監査できる。
- [ ] `AC-104`: token、secret、OAuth credential本文をGraph、通常DB列、通常ログ、Receiptへ保存しない。
- [ ] `AC-105`: 未登録、失効、別tenant、別app、scope不足を区別してfail closedにする。

**契約・利用量・課金Receipt**

- [ ] `AC-201`: tenant別のplan、含有AI利用枠、ツール枠、Container枠、サポート枠、超過方針を保持する。
- [ ] `AC-202`: 実行相関IDからAI、tool、Container、retry、外部APIの消費をtenantへ帰属させる。
- [ ] `AC-203`: 50%、80%、100%等の警告、hard stop、超過許可をplanとして表現できる。
- [ ] `AC-204`: 失敗した実行の消費原価も記録し、未計測を0円に丸めない。
- [ ] `AC-205`: canonical OperationReceipt wireを変更せず、同じ`receipt_id`に紐づくBrainbase価格台帳から為替、仕入単価、販売価格、適用開始日、改定履歴を追跡できる。

**Cloud／OSS共通接続契約**

- [ ] `AC-301`: Cloudと互換OSSが共通の認証、認可、tenant context、Receipt、エラー形式を提供する。
- [ ] `AC-302`: protocol version negotiation、互換期間、必須機能、任意機能、非対応応答を定義する。
- [ ] `AC-303`: Cloud固有の課金・運用機能をOSS必須contractへ混ぜない。
- [ ] `AC-304`: 顧客環境障害、Brainbase Cloud障害、mana-runtime障害を機械判定可能な失敗分類で区別する。
- [ ] `AC-305`: 別tenant、別deployment、別credentialへのfallbackを禁止する。

## Scenarios

- `BBMT-S-001`: Tenant Aの管理者はTenant Aの利用者、project、connection、contractだけを取得・変更できる。
- `BBMT-S-002`: Tenant AのcredentialでTenant BのIDを指定しても、存在を漏らさず拒否される。
- `BBMT-S-003`: 同じSlack workspace表示名が複数tenantに存在しても、workspace connection IDから一意に解決される。
- `BBMT-S-004`: connection失効後のイベントは、古いcacheやdefault tenantへfallbackせず拒否される。
- `BBMT-S-005`: CloudとOSSのcontract fixtureが同じ正常系・否定系を返す。
- `BBMT-S-006`: usage sourceが取得不能な場合、請求Receiptは`unavailable`として残り0円確定しない。

## Implementation Slices

1. tenant model、ownership、RLS／repository境界、既存データ移行
2. workspace connection API、revision、失効、credential参照
3. service-to-service authとtenant context envelope
4. contract、usage ledger、billing Receipt、quota decision
5. Cloud／OSS connector contractと互換fixture
6. 管理・監査表示と運用runbook

各sliceは独立PRに分割できるが、Story完了は全Acceptance Criteriaとmana-runtime統合E2Eが揃うまで宣言しない。

## Evidence and Completion

- Architecture、Spec、migration planがVibePro Storyと一致する。
- unit、integration、RLS／越境否定、migration、contract testが同一HEADで成功する。
- CloudとOSSの対象versionおよびdeploymentをreadbackする。
- 実SlackイベントからBrainbase Receiptまで同一相関IDで確認する。
- tenant別利用量と外部請求を照合し、未確認を明示する。

## Out of Scope

- Slack Marketplaceへの公開審査そのもの
- mana-runtime内部のQueue、DO、Container分離実装
- 顧客固有の価格・契約条件の確定

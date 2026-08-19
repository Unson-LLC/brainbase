# M0: Company Authority and Personal Boundary

- **状態**: active
- **開始日**: 2026-08-19
- **対象**: Brainbase、mana-runtime、個人版OSS、組織版、TechKnight shared-cloud
- **設計正本**: [`ADR-023`](../../architecture/ADR-023-brainbase-owned-company-authority.md)
- **完了判定**: 実コード、CI、staging、本番readback、利用者成果を分けて記録する

## 1. なぜM0が必要か

現在のマルチテナント基盤は、tenant、workspace connection、credential、Usage、Receiptの分離を進めている。しかし、会社の実務を安全に動かすには、tenantが正しいだけでは足りない。

実行前に、次をBrainbaseが正本解決する必要がある。

- 外部subjectに対応するcanonical person
- active membershipとorganization
- projectとresource ownership
- RACI、delegation、policy
- Personal KG owner
- `auto / approval / human_action / deny`

この解決がないまま公開CLI、MCP、オンボーディング、TechKnightの業務canaryを増やすと、不完全な権限モデルを公開面へ固定し、後から全入口を壊すことになる。

M0は、機能追加の一つではない。**組織版、マルチテナント、Personal KG、MANA経営実行ループが共有する前提契約**である。

## 2. Revised milestone map

| 順序 | Milestone | 利用者成果 | 次へ進む条件 |
|---|---|---|---|
| M0 | Company Authority | Brainbaseが人物・所属・RACI・policyを解決し、MANAは署名済み権限だけで動く | 2 tenant × 2 personのnegative E2E |
| M1 | Personal Identity & Promotion | owner fallbackがなく、個人知識が本人同意と組織採用を経て共有される | Personal相互非漏洩と二段階昇格 |
| M2 | Umeda Organization E2E | 梅田さんが本人JWTでPersonal KGと雲孫バックオフィス業務を安全に使う | useful評価付き実務Ship |
| M3 | TechKnight Shared Cloud | 2つ以上の実tenantが混線せず、tenant別の実務Shipを閉じる | Safety GateとValue Gate |
| M4 | Management Execution Loop | MANAが停滞を検知し、権限内実行と人間判断をShipまで追跡する | 同じ契約を梅田業務とTechKnightで再利用 |
| M5 | OSS／Organization Superset | 組織版が個人版の全安全契約を維持し、公開CLI・MCPを包含する | 組織版CIで個人版contract全通過 |

M0、M1の設計と実装を先に固定する。M2、M3向けの環境準備は並行できるが、会社データを扱うread/write canaryはM0を通過するまで開放しない。

## 3. M0 work packages

### M0-A. Canonical identity resolution

**目的**: 外部subjectをGraph上のcanonical personへ一意に解決する。

作業:

- Slack user、Codex profile、Claude Code profile、service identityのmapping正本を定義
- merged／inactive personを候補から除外
- active membershipとorganizationを同一transactionでreadback
- person／membership revisionを署名contextへ含める
- unknown、ambiguous、inactiveを非開示かつ機械判定可能に拒否

Gate:

- 同名人物、旧alias、merged person、別organizationのnegative fixtureが通る
- external subjectだけから別personを指定できない
- resolution失敗時にdefault personへ寄らない

### M0-B. Canonical organization、project、resource scope

**目的**: organization、project、resourceをhintではなく正本から解決する。

作業:

- organization membershipとproject membershipを正本化
- project code、organization名、workspace IDをauthorityとして使わない
- resource ownershipとtenant ownershipを同時に確認
- owner_person_idが必要なresourceではowner未解決を拒否

Gate:

- scope外projectとcross-organization resourceを処理前に拒否
- project hint不一致時に正本へ従い、暗黙補正しない
- resource revisionをcontextへ固定

### M0-C. RACI／policy authority resolver

**目的**: actionを`auto / approval / human_action / deny`へ決定論的に分類する。

作業:

- Graph RACI、delegation、placement policy、capability、stop conditionを統合
- Responsible、Accountable、Approverをcanonical person IDで返す
- policy revision、RACI revision、delegation evidenceを記録
- authority resolution receiptを発行

Gate:

- モデルの自信度で権限を決めない
- stale revision、承認者不在、複数Accountable、policy不明を拒否
- `approval`と`human_action`を区別できる

### M0-D. Signed Canonical Execution Context

**目的**: tenant安全性と会社権限を一つの署名済みcontextへ統合する。

作業:

- `CanonicalExecutionContextV1` schemaとfixtureを追加
- 既存TenantContext v1との互換期間を定義
- `company_authority_v1` required capabilityを追加
- issuer、audience、TTL、deployment、identity／RACI／policy revisionを検証
- contextのcanonical JSON、signature、source-lock、consumer conformanceを固定

Gate:

- mana-runtimeとBrainbaseが同じpositive／negative fixtureを実行
- actor／authorizationのruntime自己申告を拒否
- context欠落・改ざん・古いrevisionで業務operationへ到達しない

### M0-E. MANA consumer cutover

**目的**: MANAをauthority authorからauthority consumerへ変更する。

作業:

- ingressからcanonical actor／authorizationの組立を除去
- provider identityとrequested actionだけをBrainbaseへ送る
- Worker、Queue、DO、Container、MCP、Brainbase proxy、Slack deliveryでcontextを再検証
- `authority.decision`に従ってauto／approval／human_action／denyを実行
- local workspace hintを非権威cacheへ降格

Gate:

- MANA側でorganization、project、owner、approver、RACIを補完しない
- Brainbase unavailable時にdefault placement／credentialへfallbackしない
- UsageとReceiptへauthority resolution receiptを関連付ける

### M0-F. Cross-repo negative E2E

**目的**: tenant境界と会社権限境界を同時に証明する。

最低マトリクス:

```text
Tenant A / Tenant B
佐藤さん / 梅田さん
Slack / CodexまたはClaude Code
read / write / approval / deny
```

必須ケース:

1. Tenant Aの正常実行
2. Tenant A→B、B→Aの越境拒否
3. 佐藤→梅田、梅田→佐藤のPersonal KG相互非漏洩
4. unknown／ambiguous person拒否
5. inactive membership拒否
6. scope外project／resource拒否
7. stale RACI／policy／connection revision拒否
8. Queue再配送時の副作用1回
9. approval指定者以外の承認拒否
10. external readback、Usage、Operation Receipt、authority receiptの相関

Gate:

- unit／integration／in-memory fixtureだけを完了証拠にしない
- 実PostgreSQL、実identity、実runtimeのreadbackを取得
- `not_collected`を成功または0件へ丸めない

## 4. M1 work packages

### M1-A. Personal owner no-fallback

- `sato_keigo`その他のdefault ownerを削除
- ownerは認証済みcanonical personまたはdelegation receiptからのみ導出
- service proxyのowner選択をdelegationで拘束
- 全Personal KG操作をaccess付きtransactionへ統一

### M1-B. Personal review

- 本文編集とrevision監査
- approve／reject actorを認証情報から強制導出
- 機微区分、redaction、保存拒否
- 次のAI会話で本人承認済み候補を再利用

### M1-C. Two-stage organization promotion

- owner personal approval
- owner consent for organization review
- pending organization review
- organization reviewer accept／reject
- 正規化済みknowledgeとevidence pointerだけをGraphへ書く

Gate:

- owner承認だけではGraph write 0件
- 組織reviewerはPersonal本文を閲覧しない
- GraphからPersonal本文を復元できない

## 5. Work allowed before M0 completion

次は並行して進めてよい。

- tenant schema、workspace connection、credential broker、Usage／Receiptのインフラ検証
- health、protocol negotiation、provisioning、connection revision診断
- contract／fixture／runbookの整備
- 個人版OSSと組織版の公開面棚卸し
- ローカル出力だけで外部identity・会社データ・Graphへ触れない静的CLIの試作

## 6. Work blocked by M0

次はM0完了前に`completed`または`organization-compatible`と扱わない。

- 組織版公開CLI／MCPの23/23完成宣言
- company dataを読む・書くruntime command
- Personal KGの複数人本番付与
- Personal→Organization自動昇格
- TechKnightの会社データread/write canary
- MANAの自律的な外部side effect
- RACIに基づく自動承認・エスカレーション

進行中のOSS／組織版CLI stackは保存するが、M0へrebaseし、各PRへ次を追加するまで`develop`へ統合しない。

- canonical person／membership／organization／projectの解決証拠
- no-fallback negative fixture
- `company_authority_v1`の適用可否
- cross-person／cross-tenant negative evidence
- 本番未確認を`not_collected`として残す表示

## 7. Release gates

| Gate | 条件 | 状態 |
|---|---|---|
| G0 Contract | ADR、schema、fixture、source-lockが両repoで一致 | pending |
| G1 Identity | external subject→canonical person→membershipが正本解決 | pending |
| G2 Authority | RACI／policyからdecisionと人を解決 | pending |
| G3 Personal | no-fallbackと二段階昇格 | pending |
| G4 Staging | 2 tenant × 2 person negative E2E | pending |
| G5 Umeda | 本人JWT、学習、レビュー、実務Ship、useful評価 | pending |
| G6 TechKnight | 2実tenantのSafety／Value Gate | pending |
| G7 Execution | 停滞検知から証拠付きShipまで | pending |
| G8 Superset | 組織版CIで個人版contract全通過 | pending |

## 8. Completion definition

M0は、文書作成、schema追加、CI成功だけでは完了しない。

次がすべて必要である。

- Brainbaseが会社権限を正本解決する
- MANAが権限情報を自己生成しない
- 署名済みcontextが全runtime境界を通る
- 2 tenant × 2 personの成功・拒否がfresh E2Eで証明される
- actor、scope、authority、実行、readback、Usage、Receiptが同一correlation IDで追える
- Personal KG owner fallbackが0件
- owner承認だけでのGraph writeが0件
- 境界事故が0件

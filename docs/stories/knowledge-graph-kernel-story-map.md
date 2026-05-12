# Knowledge Graph Kernel Story Map（Codex review revised）

## 改訂履歴
- 2026-05-10 v1: 初版（14 stories + 1 epic）
- 2026-05-10 v2: **Codex high-reasoning review 反映**。実行順序を「graph kernel化 + NocoDB代替 同時進行」から「ACL → STR-006 First Slice → SNS read-only → Graph view 限定」へ変更。拡張 type の Graph entity 化を保守的に。

## 位置づけ

このストーリー群は brainbase の **kernel をナレッジグラフに置き直す** 長期構想。  
既存の `frame-2026-ai-first-company-os` / `annual.brainbase.ai-first-operating-loop` 配下、特に `quarter.brainbase.ai-readable-ssot` を強化する流れ。

**STR-006（mana Secretary Memory Promotion）** が個人脳〜promotion〜scoped retrieval の中核を既に設計済（Raw Ledger / Dreaming / Memory Candidate / Promotion Gate / Graph SSOT writer / Scoped Retrieval）。我々の構想はそれを 70% 流用、不足分を補完する。

## Codex review が指摘した急所（v2 で反映）

| 警告 | v1 設計 | v2 改訂 |
|---|---|---|
| ACL 二重化リスク | org_ids + visibility を別軸で足す | org/project/team/owner を分離 + RLS contract test 先行 |
| 拡張 type 追加が早い | observation/insight を Graph 一級 type 化 | Memory Candidate Store に置く / Graph entity 化は judgment gate 経由 |
| 認知昇格は traversal 単独不可 | edge で表現 | `promotion_candidates` / `promotion_audit_events` 別テーブル |
| Mesh と central Graph 重複 | Mesh が cross-node graph traversal も担う | central Graph 直読み / Mesh は local context 専用 |
| NocoDB deprecation 早すぎ | Phase 9 で deprecation | 後ろに大きく押し下げ、typed projection 整備後 |
| SNS curator LLM 丸投げ | LLM が draft 提案 | scoring 明示 + LLM は候補生成のみ |

## 設計の核（v2 確定版）

1. **4層脳モデル**: 個人 / チーム / 組織 / シナプス（Mesh）
2. **A1 storage**: raw activity は per-PC（移動不能）、normalized memory は central Graph SSOT に scope 付き。central は Lightsail PostgreSQL（bb.unson.jp）に同居、論理的に visibility で分離
3. **認知昇格は workflow state**: Graph entity ではなく candidate store + audit log
4. **新 type 追加は judgment gate 経由**（保守的）
5. **4組織並立**: org/project/team/owner を ACL で分離、RLS contract test 先行
6. **cross-org synapse は exception**: 佐藤さん judgment-only、自動 fire しない
7. **Type taxonomy（二分）**:
   - **catalog types**（既存14中心、stable identity）: person / org / customer / partner / contact / project / app / brand / frame / decision / philosophy / glossary_term / story / raci_assignment → **team / org layer に住む傾向**
   - **cognitive types**（認知昇格パス、volatile）: observation / insight / claim / preference / hypothesis / experiment / result / source / event → **個人で生まれ candidate-store に住む、promote 時のみ Graph SSOT へ（既存 catalog type にマップ、足りない時のみ judgment gate で新 type 追加）**
8. **type catalog 1本化**: 個人 / チーム / 組織で同じ type pool。layer は visibility / owner / scope で決まる
9. **promotion パターン default は "a"**：別 instance + derived_from edge（同一 instance の visibility 上書きではなく、新規 instance を作って provenance edge で繋ぐ）

## Story 一覧（v3 時点：23 active + 5 archived + 1 epic）

### 改訂履歴
- v1: 14 stories（初版）
- v2: Codex review 反映、4 archive、新規 stories で 14 → 19
- v2.5: Mesh story 3 追加（19 → 22）
- v2.7: _codex deprecation 3 + SNS first-class 4 + Settings 3 追加（22 → 32）
- v3: 1 archive 追加（graph-table-view-readonly → existing-types に置換）、type taxonomy 明示


### Wave 1: 概念基盤と契約（**最優先**）

#### A. brain-model-codification
```yaml
priority: 1
prerequisites: []
size: S
target: 4層脳モデル + 認知昇格パス + 記憶タイプ + シナプス論 + **type taxonomy** を philosophy/concept として graph に codify。CLAUDE.md / docs から参照リンク。
criteria:
  - ADR-XXX-brain-model.md（4層脳モデル / subjective vs inter-subjective / cognitive elevation）
  - ADR-XXX-type-taxonomy.md（catalog types vs cognitive types の二分、layer 帰属の傾向、promotion パターン a/b/c）
  - philosophy entries x4: "brain-model-4-layer" / "cognitive-elevation-path" / "memory-types-taxonomy" / "synapse-by-judgment"
  - concept entries x6: observation / insight / claim / concept / source / event の定義
output: ADR x2, philosophy entries x4, concept entries x6
```

#### B. acl-vocabulary-adr (= 既存 org-axis-acl の reframe)
```yaml
priority: 1
prerequisites: [A]
size: S
target: org / project / team / person / visibility / sensitivity / role の語彙と関係を ADR で固定。既存 projectCodes / role_min との写像を明示。type taxonomy（catalog vs cognitive）との接続も明示。
criteria:
  - ADR-XXX-acl-vocabulary.md
  - visibility scope: owner / team / org / public の4段
  - sensitivity level: internal / restricted / confidential / top-secret
  - role_min との写像（CEO=3, GM=2, Member=1 / clearance level）
  - org_ids（複数可、joint project対応）
  - **catalog type と cognitive type で ACL 適用粒度が違うこと**を明示（cognitive types は candidate-store、catalog types は Graph SSOT）
output: ADR-XXX-acl-vocabulary.md
```

#### NEW: acl-contract-test
```yaml
priority: 2
prerequisites: [B]
size: M
target: 実装前に access contract test 整備。STR-006 deny-by-default matrix（5 文脈）+ 4組織並立 cross-org case のテスト fixture。
criteria:
  - access-contexts.fixture.json に 4組織 cross-org cases 追加
  - 佐藤=4org member の retrieval test
  - 単一org member の retrieval test
  - role 失効 / project 外 / channel 外の deny test
  - test framework 上で fail-fast
output: tests/access-contracts/, contract documentation
```

### Wave 2: STR-006 First Slice（最初の動く形）

#### NEW: candidate-store-mvp
```yaml
priority: 3
prerequisites: [B, acl-contract-test]
size: L
target: Memory Candidate Store + Promotion Gate Service。STR-006 First Slice 1〜5 を満たす。**cognitive types（observation/insight/claim/preference/hypothesis）はここに住む**、Graph SSOT には catalog type にマップして promote 時のみ書く。
criteria:
  - Memory Candidate を別テーブルで管理（Graph と分離）
  - **cognitive type field を candidate row に持つ**（observation / insight / claim / preference / hypothesis / experiment / result）
  - promotion_status 状態遷移（candidate → pending_approval → approved/rejected/expired → promoted）
  - promote 時の subject_type は既存 catalog type（person/project/decision/customer/philosophy/glossary_term 等）にマップ
  - audit log（actor / decision_owner / reason / decided_at / evidence_ids）
  - Brainbase Activity Adapter（session/terminal → Raw Ledger）
  - Dreaming async job（candidate draft 生成のみ）
  - PII / secret スキャナを通す（terminal output / DM / 顧客情報誤候補化を防ぐ）
  - promotion パターン default は a（別 instance + derived_from edge、元 candidate は残す）
references:
  - docs/stories/STR-006-mana-secretary-memory-promotion.md
  - docs/architecture/mana-secretary-memory-promotion-architecture.md
  - docs/architecture/ADR-010-memory-promotion-kernel-boundary.md
```

M5 decision: candidate-store を brainbase / mana / zeims / SNS feedback 共通の Memory Promotion Kernel とする。ただし M5-A は brainbase-owned schema migration と Pg-backed repository contract に限定し、mana / zeims は後続 adapter story で Raw Ledger-compatible envelope を接続する。

#### NEW: private-preference-promotion
```yaml
priority: 4
prerequisites: [candidate-store-mvp]
size: S
target: STR-006 First Slice 6 を完成させる。private preference 1 件を auto-promote → person-scoped memory として graph に書く（既存 person type へ attach）。
criteria:
  - "佐藤さんの好み（例: codex委譲が好き）" を auto-promote
  - person scope の memory が retrieval で引ける
  - 自分以外には漏れない（contract test pass）
  - rollback 動線（promote した memory を redact / expire）
```

#### NEW: project-memory-promotion
```yaml
priority: 5
prerequisites: [candidate-store-mvp]
size: M
target: STR-006 First Slice 7 を完成。project-visible memory 1 件を explicit approval で promote。
criteria:
  - project owner / PM / RACI accountable が approve UI で承認
  - 既存 graph type（project / decision）にマップ
  - project member に visible
  - non-member には invisible
```

### Wave 3: 最初の出口（SNS read-only curator）

#### NEW: personal-kg-sns-seed-mvp
```yaml
priority: 5.8
prerequisites: [candidate-store-mvp, private-preference-promotion]
size: M
target: 個人KG（owner-visible Graph SSOT entries + personal-scope candidate-store cognitive memory）から SNS ネタ候補を作る最小 read model。新しい Graph schema は増やさず、candidate-store personal scope を読んで SNS curator の source entity に変換する。
criteria:
  - candidate-store の ACL を通した owner-visible memory だけを source entity 化
  - redacted / rejected / expired / agency_level=none / sns-curator 由来 candidate を除外
  - source_candidate_id / source_event_ids / evidence_ids で provenance を保持
  - SnsReadonlyCurator に渡すと Persona Brain 付き draft candidate を生成できる
non_goal:
  - production Graph write
  - X posting / scheduling
  - _codex/sns/drafts/ への durable write
```

#### NEW: sns-readonly-curator（_codex非依存に更新）
```yaml
priority: 6
prerequisites: [candidate-store-mvp, private-preference-promotion]
size: M
target: graph traversal の結果を graph 内の draft entity（candidate-store 経由）として書き出すだけの read-only curator。_codex には書かない。投稿実行は対象外。
criteria:
  - graph 上の最近 promote された insight / decision / claim を traversal
  - scoring（novelty, decision性, 失敗回復, 証拠量, 読者適合, 炎上リスク, 再利用性）を明示計算
  - LLM は採点者ではなく候補生成器（scoring 後 prompt で draft 化）
  - 出力先: graph 内の draft entity（visibility=owner、promote後にclaim化）
  - candidate-store の promotion gate を経由
non_goal:
  - 投稿実行
  - 投稿結果の自動 graph 化
  - _codex/sns/drafts/ への書き込み（旧経路、廃止対象）
  - 既存 factory_line.py / sns_post.py の置き換え（並走期は別 adapter で繋ぐ）
```

### Wave 3.3: Settings 統合基盤（multi-account multi-service の足場）

> **Codex review 反映**：既存 settings-plugin-api.js は **UI registry として温存**、credential / OAuth / permission は **server-side 新 service** に分離。  
> 既存 settings-core.js は HTML / CRUD / API client / Integration 知識を抱え込みすぎ、現状の plugin contract は外部 service account 拡張に耐えない。

#### NEW: settings-phase0-guards
```yaml
priority: 4
prerequisites: [acl-contract-test]
size: S
target: account 機構を上に乗せる前に既存 settings の弱点を塞ぐ（Codex指摘）。
criteria:
  - CoreApiClient を既存 HttpClient（CSRF自動付与）に統合
  - config route に requireAuth + role check 明示
  - plugin displayName を innerHTML 直挿しから escape へ
  - ConfigParser cache invalidation を ConfigService write 後に発火
  - settings-core.js から integration 固有 logic を切り出す sketch
```

#### NEW: account-foundation
```yaml
priority: 5
prerequisites: [settings-phase0-guards, candidate-store-mvp]
size: L
target: integration_accounts / integration_account_defaults schema + Infisical credential ref + audit event の中核基盤。
criteria:
  - integration_accounts テーブル（id, service, scope_type, owner_person_id, org_id, project_id, display_name, external_account_id, credential_ref jsonb, status, capabilities[], rate_limit_profile_id, metadata, audit fields）
  - integration_account_defaults テーブル（subject_type, subject_id, service, purpose, account_id, priority）
  - active account は service global 1 個ではなく context default（Codex 指摘）
  - Infisical credential_ref は metadata のみ保存、secret 値は DB / config.yml / localStorage 禁止
  - audit event：ACCOUNT_CONNECTED / REAUTHORIZED / REVOKED / DEFAULT_CHANGED / USED_FOR_POST
  - AccountController → AccountService → ProviderAdapter / CredentialVault / PolicyService / AuditService
```

#### NEW: settings-plugin-contract-v2
```yaml
priority: 5.5
prerequisites: [account-foundation]
size: M
target: 既存 settings-plugin-api.js を UI registry として温存しつつ、service provider manifest を別建て。
criteria:
  - ProviderDefinition contract（service / authMethods / capabilities / publicMetadataSchema / credentialKeySpec / startOAuth / handleCallback / refreshCredential / revokeCredential / healthCheck / getRateLimitStatus）
  - 既存 SettingsPluginRegistry は UI 拡張用に残す
  - Integrations 配下に Accounts サブビュー
  - 既存 Slack/GitHub/NocoDB config editor は legacy mapping として共存
  - displayName escape / requiredLevel は UI 表示用、権限判定は server 側 RACI
```

### Wave 3.5: SNS first-class integration（brainbase に正式組込）

> **方針**：SNS を brainbase の **一級機能**として実装。multi-account + settings UI + 他メンバー利用可能。
> 旧 `workspace/sns/*.py` 等の Python script 群は段階廃止。

#### NEW: sns-account-management（account-foundation 上に X provider adapter を実装）
```yaml
priority: 6.5
prerequisites: [account-foundation, settings-plugin-contract-v2]
size: M
target: X (Twitter) を最初の provider adapter として実装。account-foundation の上に乗せる。
criteria:
  - X ProviderAdapter 実装（OAuth2 PKCE）
  - connect / callback / reauthorize / revoke / health check / rate limit status
  - OAuth state は actor / scope / org / project / return URL / nonce を署名 + one-time
  - Settings UI に「Accounts」サブビュー追加（X account 追加/削除/再認可）
  - 1 user / 1 org が **複数 X account**を持てる（corp / personal / project）
  - account picker UI（投稿時の選択）
  - integration_account_defaults で context default 設定
  - 投稿権限は server 側 RACI で判定（UI requiredLevel は表示用のみ）
non_goal:
  - LinkedIn / Instagram 等他SNS（X のみで MVP）
  - OSS 用 default OAuth app の同梱（個別組織で X Developer Portal 登録前提）
```

#### NEW: sns-posting-cockpit-mvp
```yaml
priority: 6.65
prerequisites: [personal-kg-sns-seed-mvp, sns-persona-brain-gate]
size: L
target: /ohayo が生成した review pack を durable な SNS Posting Ledger に保存し、brainbase UI からカレンダー・レビュー・予約・投稿済み管理を一目で扱えるようにする。Graph とは別 DB/schema の運用台帳として持ち、学習だけを promotion 経由で Graph に戻す。
criteria:
  - /ohayo の review pack を date + slot idempotency で ledger に保存
  - カレンダー/週ビューで投稿予定と status badge が見える
  - post detail で本文、引用元、Persona Brain、Graph Check、Quality Gate、編集履歴を確認できる
  - review_needed / approved / scheduled / posted / skipped / learning_ready の状態遷移
  - posted URL と metrics snapshot を保存
  - brainbase navigation から SNS Cockpit に直接アクセスできる
  - PostgreSQL は既存 Lightsail を利用するが Graph SSOT tables とは分離する
non_goal:
  - X API による完全自動投稿
  - Graph への raw metrics 直書き
  - multi-account agency cockpit
story_doc: docs/stories/sns-posting-cockpit-mvp-story.md
```

#### NEW: sns-posting-engine
```yaml
priority: 6.7
prerequisites: [sns-posting-cockpit-mvp, sns-account-management, sns-readonly-curator]
size: L
target: 投稿実行・scheduling・画像生成を brainbase server 内部に実装。
internalize:
  - 旧 sns_post.py → server/services/sns/posting-service.js
  - 旧 scheduled_post_runner.py → server/services/sns/scheduler-service.js
  - 旧 nano_banana.py → server/services/sns/image-generation-service.js（or 外部 API ラッパとして残す選択）
  - 旧 x_client.py / x_oauth2.py → server/services/sns/x-client.js
criteria:
  - draft entity → approve → post 動線が brainbase UI で完結
  - 投稿時 account を選択（その user の available accounts から）
  - schedule 指定可能（時刻設定）
  - 画像生成は curator が候補生成、ユーザーが採用判断
  - 投稿ログは SNS Posting Ledger に残し、Graph へは learning promotion 経由で反映する
  - dry-run mode（テスト投稿）
  - rate limit 対応（X API 上限）
non_goal:
  - 旧 script の即廃止（並走期間あり）
```

#### NEW: sns-feedback-loop
```yaml
priority: 6.9
prerequisites: [sns-posting-cockpit-mvp, sns-posting-engine]
size: M
target: 投稿後の反応（impressions / likes / replies / engagement）を SNS Posting Ledger に蓄積し、learning candidate として candidate-store 経由で curator scoring に反映。
criteria:
  - 投稿後 N 時間ごとに X API で metrics 取得
  - SNS Posting Ledger に metrics snapshot を accumulate（source=tweet、metric_kind、value、measured_at）
  - reply / mention を separate event として ingest（candidate-store 経由で observation に）
  - curator scoring の novelty / engagement weight に反映（次回 draft 推薦改善）
  - impression 異常値（炎上候補）を mana proactive 通知
```

### Wave 4: Graph table view（既存 14 type 限定）

#### NEW: graph-table-view-existing-types (旧 graph-table-view-readonly を再定義)
```yaml
priority: 7
prerequisites: [B, candidate-store-mvp]
size: M
target: brainbase UI で既存 14 type の entity を table view として read-only 閲覧。新規 type は対象外。
criteria:
  - type 選択 → entity 一覧 table 表示
  - filter / sort / search / column 選択
  - edge をリンク列として展開
  - モバイル一級
non_goal:
  - 編集機能
  - 新規 type
  - NocoDB の formula / lookup 等
```

### Wave 5: 新 type 追加判定（保守的）

#### NEW: new-type-judgment-gate
```yaml
priority: 後半
prerequisites: [candidate-store-mvp, project-memory-promotion]
size: S
target: 既存 14 catalog type で表現できない具体的 requirement を蓄積し、判定会議で個別承認した type のみ Graph SSOT に追加する gate を運用化。**cognitive types は candidate-store にとどめる原則を維持**、Graph 化は最後の手段。
criteria:
  - failed-mapping log（candidate が既存 catalog type にマップできなかった事例を記録）
  - 月次 review でログ確認
  - 追加判定基準:
    - 3件以上の独立 use case
    - 既存 catalog type で表現不能（payload 拡張で吸収不可）
    - scope / lifetime / visibility 規則が明確
    - cognitive types を Graph 化する場合は **特に厳しい基準**（多くは candidate-store のままで十分）
  - 承認された type のみ schema migration（既存 type 互換性を破壊しない）
  - 承認されない case は candidate-store に留め、運用で耐える
output: monthly-judgment-log / schema migration spec / ADR record
```

### Wave 5.5: Mesh 統合（ACL 固まり後、独立 critical path）

#### NEW: mesh-cross-node-context-boundary
```yaml
priority: 後半
prerequisites: [acl-contract-test, candidate-store-mvp]
size: S
target: Codex 指摘の「Mesh と central Graph の責務重複」を契約化。
criteria:
  - 「central Graph の意味記憶は brainbase 本体 API から直接読む」を ADR 化
  - 「Mesh QueryHandler は そのnode にしかない local context（in-flight session、未promote candidate、worktree 状態、terminal output 等）専用」と明示
  - QueryHandler の responseに graph data を含めない（参照のみ、ID 返す）
  - 既存 mesh-agent-query-architecture.md を更新
output: ADR-XXX-mesh-context-boundary.md, mesh-agent-query-architecture v2
```

#### NEW: mesh-candidate-store-bridge
```yaml
priority: 後半
prerequisites: [candidate-store-mvp, mesh-cross-node-context-boundary]
size: M
target: STR-006 の Memory Candidate Store と Mesh の接続契約。他 node が持つ未 promote candidate を Mesh 経由で問い合わせる動線、または approve 通知を Mesh で配信。
criteria:
  - 他 node の Memory Candidate に対する query type を envelope に定義
  - response は redacted summary のみ（生 candidate body は流さない）
  - 承認通知の broadcast（同じ org/team scope への push）
  - mana が cross-node の candidate を見る use case で動作確認
output: mesh query type extension, contract fixtures
```

#### NEW: mesh-phase3-hardening
```yaml
priority: 後半
prerequisites: [mesh-cross-node-context-boundary]
size: M
target: 既存 docs/mesh-readme.md 列挙の Phase 3 残作業を全部消化。
criteria:
  - POST /api/mesh/query 同期 + 30秒タイムアウト化
  - routes/mesh.js を asyncHandler + AppError 統一
  - MCP Tool エラーレスポンス（isError:true）対応
  - LocalContextCollector を NodeProfile.projects[] 全プロジェクト対応
  - MESH_AGENT_RUNTIME env 結合
  - revoke / peer_revoked プロトコル + mesh revoke CLI
  - server/mesh/errors.js（MeshErrorCodes）
  - envelope ts/nonce 検証（リプレイ攻撃対策）
  - envelope サイズ上限（1MB / 64KB / 512KB）
  - Relay 同時接続数制限 + 重複nodeId拒否
  - Relay deny-list SQLite 永続化
  - ログフォーマット統一 [Mesh][${nodeId.slice(0,8)}]
  - Phase 3 追加テスト全部
output: server/mesh/* update, relay/server.js update, test/mesh/* 追加
```

### Wave 5.7: _codex レガシー化（個人ナレッジを graph に集約）

#### NEW: codex-content-migration
```yaml
priority: 5.7
prerequisites: [candidate-store-mvp, project-memory-promotion]
size: L
target: _codex 配下の既存 markdown を candidate-store 経由で graph に移行。
migration_map:
  - _codex/common/meta/people/*.md     → person entity (graph, org scope)
  - _codex/common/meta/customers/*.md  → customer entity (graph, org scope)
  - _codex/sns/sns_strategy_os.md      → philosophy entry (org scope)
  - _codex/sns/x_account_profile.md    → concept entry
  - _codex/sns/x/00_line_charter.md    → philosophy / decision entries
  - _codex/sns/drafts/*.md             → draft entity → 承認後 claim/content entity
  - _codex/sns/rules.md                → philosophy entries
  - _codex/sns/style_guide.md          → philosophy entry
criteria:
  - migration script が _codex 各 markdown を candidate に変換
  - PII / secret scanner を通す
  - owner / scope / sensitivity が markdown frontmatter / 内容から推定 → reviewer 承認
  - migration log（どの markdown → どの entity に行ったか）
  - rollback 可能（migration を元に戻せる）
non_goal:
  - _codex を即削除
```

#### NEW: codex-deprecation
```yaml
priority: 後半
prerequisites: [codex-content-migration, content-ssot-skill-update, sns-readonly-curator]
size: M
target: _codex を read-only mirror 化 → archive 化 → 廃止。
phases:
  - Phase A: write を新規禁止（hook で block）
  - Phase B: 既存 reference を graph API 呼び出しに置き換え
  - Phase C: _codex を read-only archive branch に移動
  - Phase D: 全 reference 解消確認後、廃止
criteria:
  - _codex を参照する全 script / skill / hook を洗い出し
  - graph API に切り替え
  - 旧 path への access を deprecated warning
  - 半期程度の cooldown 後に削除
```

#### NEW: content-ssot-skill-update
```yaml
priority: 5.7
prerequisites: [codex-content-migration]
size: M
target: _codex を SSOT 前提にしている skill 群を graph 前提に書き直し。
skills_to_update:
  - brainbase-content-ssot（_codex を SSOT と定義 → graph 前提に rewrite）
  - people-meta（_codex/common/meta/people/ 参照 → person entity API）
  - customers-meta（同上）
  - sns-account-factory（_codex/sns/x/00_line_charter.md 等参照 → concept/philosophy entry）
  - sns-workflow（既存 script paths は当面維持、graph adapter 追加）
criteria:
  - 各 skill SKILL.md を更新
  - graph API 呼び出し手順を記述
  - 旧 _codex 参照を archive section に移す
  - codex-validation skill との整合
```

### Wave 6: 後回し（条件付き、Codex 推奨で大きく押し下げ）

#### team-graph-layer（既存）
```yaml
priority: 後半
prerequisites: [project-memory-promotion]
status: 既存 STR-006 で project / role visibility を持つので部分対応。team-level 専用 type / scope の追加は new-type-judgment-gate 経由で判定。
```

#### mesh-member-distribution（既存）
```yaml
priority: 後半
prerequisites: [mesh-phase3-hardening, acl-contract-test]
status: hardening 完了後に雲孫メンバー配布。Codex 推奨で別 critical path。
```

#### graph-ssot-integration（既存）
```yaml
priority: 後半
prerequisites: [acl-contract-test, candidate-store-mvp]
status: bb.unson.jp の current schema inventory を先に固定してから migration。
```

#### graph-table-view-edit（既存）
```yaml
priority: 後半
prerequisites: [graph-table-view-existing-types]
status: typed projection / computed field / link / select option validation が揃ってから。
```

#### graph-views-multi（既存）
```yaml
priority: 後半
prerequisites: [graph-table-view-edit]
```

#### nocodb-deprecation（既存）
```yaml
priority: 最後
prerequisites: [graph-views-multi, mesh-member-distribution]
status: 影響範囲広い（既存 commands / Skills / mana / config.yml）。typed projection / link / lookup / rollup / formula / select option compat API が揃ってから。当面 NocoDB は read-only mirror として残す。
```

#### NEW: sns-legacy-scripts-deprecation
```yaml
priority: 最後
prerequisites: [sns-posting-engine, sns-feedback-loop, codex-deprecation]
size: M
target: workspace/sns/*.py / common/ops/scripts/sns* の旧 script 群を段階廃止。
in_scope:
  - workspace/sns/x/ops/scripts/factory_line.py
  - workspace/sns/x/ops/scripts/x_article_line.py
  - workspace/sns/x/ops/scripts/slack_review_queue.py
  - workspace/sns/x/ops/scripts/phase2_5_review_*.py
  - common/ops/scripts/sns_post.py
  - common/ops/scripts/scheduled_post_runner.py
  - common/ops/scripts/nano_banana.py
  - common/ops/scripts/x_client.py / x_oauth2.py / x_article_post.py
  - sns-workflow / sns-account-factory / sns-smart skill 群
criteria:
  - 全機能が brainbase 内部 (server/services/sns/*) に internalize 済
  - 旧 script を deprecated mark、warning log
  - cooldown 期間 1-2 ヶ月
  - 全 reference 解消後に削除（script + skill）
```

## Archived stories（v1 で立てたが v2 で置換）

| 旧 ID | 置換先 |
|---|---|
| `str.brainbase.graph-schema-extension` | `new-type-judgment-gate` + `candidate-store-mvp` |
| `str.brainbase.personal-graph-mvp` | STR-006 First Slice（candidate-store-mvp + private-preference-promotion） |
| `str.brainbase.graph-ingest-pipeline` | STR-006 Raw Ledger + Dreaming（candidate-store-mvp 内） |
| `str.brainbase.cognitive-elevation-curator` | STR-006 Promotion Gate（candidate-store-mvp）+ sns-readonly-curator |
| `str.brainbase.graph-table-view-readonly` | `graph-table-view-existing-types`（既存 14 type 限定） |

## 改訂後の依存関係（critical path + 2つの別 critical path）

```
A. brain-model-codification (Wave 1)
            ↓
B. acl-vocabulary-adr (Wave 1)
            ↓
acl-contract-test (Wave 1) ← critical path here
            ↓
candidate-store-mvp (Wave 2)
            ↓
   ┌────────┼────────┬──────────────────┐───────────────────┐
   ▼        ▼        ▼                  ▼                   ▼
private  project   sns-readonly  ★_codex deprec.        ★Mesh
-preference -memory  -curator    別critical path★      別critical path★
                   (Wave 3)
                                 codex-content-migration  mesh-cross-node-
            │                          ↓                  context-boundary
            ▼                    content-ssot-skill-       (Wave 5.5)
graph-table-view-existing-types  update                       ↓
       (Wave 4)                       ↓                  mesh-candidate-
            ↓                    codex-deprecation        store-bridge
new-type-judgment-gate              (Wave 6)                  ↓
       (Wave 5)                                          mesh-phase3-
            ↓                                            hardening
       後回し group (Wave 6)                                  ↓
       team-graph / ssot-integration / table-edit /     mesh-member-
       views-multi / nocodb-deprecation                 distribution (Wave 6)
```

**3 つの独立 critical path**：
1. メイン：ACL → candidate-store → SNS read-only → **SNS first-class integration** → table view → judgment gate
2. _codex deprecation：candidate-store 後に並列で migration → skill update → deprecation
3. Mesh：acl-contract-test 後に並列で context-boundary → bridge → hardening → 配布

**SNS first-class 統合 sub-path**：
```
sns-readonly-curator (Wave 3)
       ↓
sns-account-management (Wave 3.5) ← multi-account + OAuth + settings UI
       ↓
sns-posting-engine (Wave 3.5) ← brainbase 内製投稿 + scheduler + 画像生成
       ↓
sns-feedback-loop (Wave 3.5) ← 投稿結果 → graph event → curator scoring
       ↓
（最後）sns-legacy-scripts-deprecation (Wave 6) ← 旧 Python script 群廃止
```

**Mesh は別 critical path**：ACL 固まり後（acl-contract-test 完了後）に並列で進める。Codex の「Mesh と central Graph の責務重複」「Mesh 配布は別 critical path」推奨に従う。

## Type taxonomy 参照表（個人 / チーム / 組織 layer の支配的 type）

| Type | 個人 | チーム | 組織 | 主たる layer | 分類 |
|---|---|---|---|---|---|
| observation | ◎ | △ | ✗ | 個人 | cognitive（candidate-store） |
| insight | ◎ | ○ | △ | 個人 → 集合知 | cognitive（candidate-store） |
| preference | ◎ | ✗ | ✗ | 個人のみ | cognitive（candidate-store） |
| hypothesis | ◎ | ○ | △ | 個人 | cognitive（candidate-store） |
| claim | ○ | ◎ | ○ | チーム | cognitive（candidate-store） |
| concept | ○ | ◎ | ◎ | チーム / 組織 | cognitive（候補は candidate、promoteで glossary_term / philosophy へマップ） |
| source | ◎ | ◎ | ○ | 全層 | cognitive |
| event | ◎ | ◎ | ◎ | 全層 | cognitive |
| experiment / result | ◎ | ◎ | △ | 個人 / チーム | cognitive |
| decision | △ | ◎ | ◎ | チーム / 組織 | **catalog**（Graph SSOT） |
| philosophy | △ | ○ | ◎ | 組織 | **catalog** |
| glossary_term | △ | ◎ | ◎ | チーム / 組織 | **catalog** |
| raci_assignment | ✗ | ◎ | ◎ | チーム / 組織 | **catalog** |
| person | ✗ | ○ | ◎ | 組織 | **catalog**（個人 graph は person=自分 例外） |
| org | ✗ | ✗ | ◎ | 組織 | **catalog** |
| customer | ✗ | ◎ | ◎ | 組織 | **catalog** |
| partner | ✗ | ◎ | ◎ | 組織 | **catalog** |
| contact | ✗ | ◎ | ◎ | 組織 | **catalog** |
| project | △ | ◎ | ◎ | チーム / 組織 | **catalog**（個人 graph は project=個人 例外） |
| app | ✗ | ◎ | ◎ | 組織 | **catalog** |
| brand | ✗ | △ | ◎ | 組織 | **catalog** |
| frame | ✗ | ○ | ◎ | 組織 | **catalog** |
| story | ○ | ◎ | ○ | チーム | **catalog** |

**catalog types**（既存14中心）= Graph SSOT に住む / stable identity / team・org が中心  
**cognitive types**（拡張候補）= candidate-store に住む / volatile / 個人で生まれて promote で catalog にマップ

## Settings 必須 ADR / Spec 候補（Codex 提示）

- **ADR**: Settings SSOT 境界（config.yml / Graph-Postgres / Infisical / localStorage の責務分担）
- **ADR**: Account active/default model（global active を禁止し、context default にする）
- **ADR**: OAuth callback host（bb.unson.jp 共通 callback と local dev callback の使い分け）
- **ADR**: Infisical path taxonomy と rotation / revoke policy
- **Spec**: Settings Provider Plugin Contract v2
- **Spec**: RACI account permission model
- **Spec**: Account audit event schema
- **Spec**: OSS credential policy
- **Spec**: Existing config.yml migration / coexistence

## Settings 落とし穴 TOP 5（Codex 提示、設計に反映済）

1. credential を localStorage / config.yml / logs に置くこと
2. `active account` を service 単位の global 1 個にすること（context default 必須）
3. UI の `requiredLevel` を権限として扱うこと（server 側 RACI 必須）
4. OAuth callback URL と state 設計を軽く見ること（state は署名 + one-time）
5. rate limit / revoke / reauth を後回しにすること

## TOP 5 開いたままの決定事項（Codex 提示）

1. **`org_ids` と現行 `projectCodes` の正規化**: org / project / team / owner をどう分離・写像するか
2. **observation/insight/claim/concept を Graph entity にする条件**: candidate store との境界、judgment gate の基準
3. **A1 多デバイス capture 契約**: 中央に置く最小情報、raw 保持場所、redaction 方針
4. **NocoDB 代替の最小互換要件**: link / lookup / rollup / formula / select option をどこまで必要とするか
5. **SNS curator の Gate**: 面白さスコア、秘密リスク、reject 学習、投稿結果 feedback の schema

これらは acl-vocabulary-adr / candidate-store-mvp / new-type-judgment-gate / nocodb-deprecation / sns-readonly-curator の各 story が議論するスコープ。

## 出さない選択（v2 確定）

- **NocoDB コードを取り込む**：AGPL 伝染回避
- **個人 observation を強制 ingest**：プライバシー違反
- **拡張 type を schema に先入れ**：戻せない
- **graph entity に workflow state を持たせる**：promotion 状態は別テーブル
- **Mesh と central Graph で同じ memory を二重経路 retrieval**
- **SNS curator が大量誤推薦で review queue を詰まらせる**：scoring と rollback を契約

## 関連 documents

- `docs/stories/STR-006-mana-secretary-memory-promotion.md`（個人脳の中核）
- `docs/architecture/mana-secretary-memory-promotion-architecture.md`
- `docs/frames/mesh-ai-driven-management.md`
- `docs/architecture/mesh-agent-query-architecture.md`
- `docs/stories/ai-first-brainbase-story-map.md`（親）
- `CLAUDE.md` 0.7 Graph SSOT first

## 次にやること

1. **Wave 1 の A から手をつける**: ADR-XXX-brain-model.md と ADR-XXX-acl-vocabulary.md を書く
2. **acl-contract-test の fixture を先に書く**（実装前のガード）
3. **candidate-store-mvp を STR-006 First Slice として diagnose**: `vibepro story diagnose --id str.brainbase.candidate-store-mvp --run-graphify`

---

**最終更新**: 2026-05-10 v2 (Codex high-reasoning review 反映)
**作成者**: 佐藤圭吾 / Claude Code 共同
**ステータス**: draft（Wave 1 の ADR 書き出しで active 化）

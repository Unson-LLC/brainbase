---
adr_id: ADR-008
title: ACL Vocabulary（owner / visibility / sensitivity / org / project / team / role / clearance）
status: accepted
date: 2026-05-11
related_stories:
  - str.brainbase.acl-vocabulary-adr  # = str.brainbase.org-axis-acl
  - str.brainbase.acl-contract-test
  - str.brainbase.candidate-store-mvp
  - str.brainbase.account-foundation
related_docs:
  - docs/architecture/ADR-006-brain-model-4-layer.md
  - docs/architecture/ADR-007-type-taxonomy.md
  - docs/stories/STR-006-mana-secretary-memory-promotion.md
  - docs/architecture/mana-secretary-memory-promotion-architecture.md
  - CLAUDE.md (0.7 Graph SSOT first)
supersedes: []
superseded_by: []
---

# ADR-008: ACL Vocabulary

## 文脈

ADR-006（4層脳モデル）と ADR-007（type taxonomy）が決まった上で、entity の **アクセス制御の語彙と関係**を固定する必要がある。

既存システムには複数の access 軸が並走している：
- JWT `projectCodes`（15 project codes）
- JWT `role`（CEO / GM / Member、level 1〜4）
- JWT `clearance`（internal / restricted / confidential / top-secret）
- 既存 Graph entity の payload に person/project/owner などが分散
- Mesh `ROLE_RANK`（CEO=3 / GM=2 / Member=1）
- config.yml の `me.aliases` 等

Codex review は「org_ids / visibility / team / owner を別軸で足すと二重 ACL になり漏洩 or 過遮断」と警告。STR-006 は subject_type / scope / sensitivity / role_min / channel_membership / project_membership 等を memory record contract に持つ。

整合した **1 つの語彙集**を ADR で固定し、以後の実装（candidate-store / Graph SSOT / Mesh / Settings / SNS account）が同じ axis で語る。

## 決定

### 1. ACL は **5 軸の独立 dimension** を持つ

| 軸 | 意味 | 値域 |
|---|---|---|
| **owner_person_id** | 個人所有者（最強の write 権 / 不要に他人に開けない） | person id, nullable |
| **org_ids** | どの組織に属する entity か（複数可、joint project対応） | array of org id |
| **project_ids** | どの project に属する entity か（複数可） | array of project id |
| **team_id** | org 配下の sub-team 帰属（option） | team id, nullable |
| **visibility** | 誰が見える範囲か（layer 決定） | owner / team / org / public |
| **sensitivity** | データ機微性（AI agency や暗号化境界に影響） | internal / restricted / confidential / top-secret |
| **role_min** | 読み書きに必要な最低 role | member / gm / ceo |
| **agency_level** | AI が自由に使える度合い（Codex指摘でvisibilityと独立軸） | none / read-only / synthesize / write-back |

**これらは独立軸**。例えば「org 公開だが sensitivity=top-secret で agency_level=none」というentity は成立する（全員見えるが AI synthesis では使わない）。

### 2. 個人 / チーム / 組織 layer は **visibility による分離**

```
visibility=owner    → 個人 KG layer（自分のみ）
visibility=team     → チーム KG layer（team_id member）
visibility=org      → 組織 KG layer（org_ids member）
visibility=public   → 公共 layer（OSS / Web 公開）
```

これは ADR-006 の 4 層脳モデルと **1対1対応**。layer は実装上は visibility による論理分離（A1 storage、同じ central DB に住む）。

### 3. JWT との写像

| JWT field | ACL 用途 |
|---|---|
| `sub` | actor person id（読み書き actor の identity） |
| `slackUserId` | identity alias |
| `slackWorkspaceId` | primary org context（default org filter） |
| `level` | role rank の数値（4=ceo, 3=gm-ish, 2=...） |
| `role` | role label（ceo / gm / member） |
| `employmentType` | executive / employee / contractor |
| `tenantId` | tenant 識別子（multi-tenant 時） |
| `projectCodes` | アクセス可能 project list（org / project filter の primary source） |
| `clearance` | sensitivity 上限（top-secret まで持つなら confidential 以下は全部読める） |

**佐藤さん**: `projectCodes` = 15 project（4 org 横断）/ `role` = ceo / `clearance` = top-secret 含む全レベル → 4 org 全部にアクセス可能なメンバー

**他メンバー**: `projectCodes` が 1 org 配下 / `role` = member / `clearance` = internal 中心 → 単一 org member

### 4. visibility と RLS の関係

```sql
-- 概念モデル（実装は info-ssot-rls.sql を拡張）
WHERE
  (entity.visibility = 'public')
  OR (entity.visibility = 'org' AND entity.org_ids && jwt.project_orgs)
  OR (entity.visibility = 'team' AND entity.team_id IN jwt.team_ids)
  OR (entity.visibility = 'owner' AND entity.owner_person_id = jwt.person_id)
AND
  (entity.sensitivity <= jwt.max_clearance)
AND
  (entity.role_min <= jwt.role_rank)
```

これを RLS policy で強制（acl-contract-test で証明）。

### 5. catalog types と cognitive types の ACL 適用粒度

| Type 分類 | 物理 storage | RLS 適用 |
|---|---|---|
| catalog（既存14） | Graph SSOT（PostgreSQL） | central DB の RLS policy |
| cognitive（拡張） | candidate-store（別テーブル） | candidate-store 専用 RLS policy（より厳しい default） |

candidate-store は **promotion 前の workflow state** なので、より strict な access（owner 専用 default、approve 時のみ visibility 拡大）。

### 6. 4組織並立の表現

```
org entity:
  unson      (parent)
  salestailor (independent)
  techknight  (independent)
  baao        (subsidiary-ish, infra: Unson 同居)
```

- entity の `org_ids` は **複数可**（joint project の場合）
- 例: BAAO + Unson 共同案件 → `org_ids: [baao, unson]`
- メンバーの「アクセス可能 org list」と entity の `org_ids` の **積集合が空でない**ならアクセス可
- 佐藤さんは全 4 org のメンバー、他の人は通常 1 org

### 7. agency_level 軸の独立性（Codex 指摘で明示）

> sensitivity と visibility は別軸。同様に AI agency も別軸。

| Entity 例 | visibility | sensitivity | agency_level | 意味 |
|---|---|---|---|---|
| 公開 philosophy | public | internal | synthesize | 全員見える、AI 自由に使ってOK |
| 雲孫 customer 詳細 | org | confidential | read-only | 全員見える、AI 引用は明示のみ |
| 契約金額 | team | top-secret | none | 法務 team のみ、AI 触らない |
| 個人 observation | owner | internal | synthesize | 自分のみ、自分の AI は自由に使ってOK |
| 退職決定 | org | top-secret | none | 全員見える、AI synthesis 不可 |

### 8. promotion と ACL 変化

cognitive entity の promote 時、ACL は **default で厳しく** 設定される：
- promote 前: candidate-store に visibility=owner
- promote 後: Graph SSOT に新 catalog entity、visibility=team or org（approve 時に明示指定）
- sensitivity は **元 candidate と同じか上**（下がる場合は redaction が必須）
- agency_level は **promote 時に再判定**（一般化された catalog entity は AI agency 高めて OK な場合が多い）

## 結果

- info-ssot-schema.sql / info-ssot-rls.sql の拡張対象が明確化
- acl-contract-test の fixture が書ける（5 軸の独立性をテストで証明）
- candidate-store-mvp の RLS policy 設計が固定
- account-foundation の `integration_accounts` 行に owner / org / project / scope_type を入れる根拠
- Mesh ROLE_RANK と JWT role の写像が明示（ROLE_RANK は level の subset）

## 非選択肢

- visibility と sensitivity の **同一軸化** → 過遮断 or 漏洩（Codex指摘）
- org_ids 単数（cross-org 不能） → joint project が表現できない
- role_min を UI の `requiredLevel` だけで担保 → server 側 RACI 必須
- localStorage / config.yml に credential 関連 ACL 情報を載せる → 漏洩経路

## 開いている問い（後続）

- `team_id` を formal entity として graph に作るか、付随属性で済ますか → 後の team-graph-layer story で判断
- `agency_level` の細粒度（read-only / synthesize / write-back）を実装でどう evaluation するか → curator 実装で詰める
- `org_ids` 必須化 migration で帰属不明 entity の扱い（Codex指摘の盲点）→ acl-contract-test で deny-by-default を契約化

## 関連

- ADR-006: 4層脳モデル
- ADR-007: Type Taxonomy
- STR-006 Memory Record Contract（5軸の元)
- CLAUDE.md 0.7 Graph SSOT first
- 既存 `server/sql/info-ssot-rls.sql`（拡張対象）

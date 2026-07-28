---
spec_id: SPEC-canonical-task-postgres-ssot
title: Canonical Task PostgreSQL SSOT Spec
status: active
date: 2026-07-28
story_id: story-canonical-task-postgres-ssot
related_architecture:
  - docs/architecture/story-canonical-task-postgres-ssot.md
diagrams:
  - kind: er
    path: docs/specs/story-canonical-task-postgres-ssot-spec.md
    purpose: Graph authority、Canonical Task PostgreSQL正本、operation、projectionの永続関係を示す。
  - kind: threat_model
    path: docs/specs/story-canonical-task-postgres-ssot-spec.md
    purpose: Slack入力、API、Graph authority、migration operator、PostgreSQL、projection間のtrust boundaryを示す。
implementation_files:
  - server/services/companion/canonical-task-postgres-repository.js
  - server/bootstrap/core-services.js
  - server/sql/canonical-task-store-schema.sql
  - scripts/migrate-canonical-task-postgres-store.js
test_files:
  - tests/server/services/canonical-task-postgres-repository.test.js
  - tests/server/scripts/migrate-canonical-task-postgres-store.test.js
---

# Canonical Task PostgreSQL SSOT Spec

## Invariants

- 明示的な本番切替後、Task本文の唯一の正本はBrainbase PostgreSQLの`canonical_tasks`である。
- 切替前はNocoDBを正本として維持し、本PRのmergeだけでauthorityを変更しない。
- Graph SSOTはperson、organization、project、decisionの権威を維持する。
- NocoDBとSlack Canvasは再生成可能な投影であり、Canvas直接編集を正本へ逆輸入しない。
- 公開HTTP契約、owner境界、People検証、single-writer、readiness、監査を維持する。
- store障害を空一覧や成功へ縮退しない。

## Repository Contract

- `CanonicalTaskPostgresRepository` は `list/get/findByIdempotencyKey/create/update/delete` を提供する。
- listはstatus、priority、assignee、due範囲、cursor、limitをSQLで適用する。
- createの冪等キー、legacy NocoDB IDはDB一意制約で保護する。
- updateはTask fields、version、operation markersを同じUPDATEで保存する。
- opaque IDは署名付きで、別store・不正ID・不存在を404として扱う。

## Backend Selection

- `CANONICAL_TASK_BACKEND` は `nocodb` または `postgres` だけを受理する。
- 未指定は既存の`nocodb`を維持し、PRのdeployだけで正本を切り替えない。
- 不正値や選択storeの接続失敗で別storeへ暗黙fallbackしない。

## Migration

- schema migrationは冪等で、`--apply`と`--check`を分離する。
- NocoDB移行はdry-run/check/applyを分離し、Task本文・secretを標準出力しない。
- legacy IDまたは冪等キー競合時はapplyを中止する。
- sourceとlegacy ID・冪等キー・payload fingerprint・version・operation markerが全て同じ既存行だけを
  移行済みとして扱い、applyを安全に再実行できる。
- sourceに存在しないtarget-only行は切替前のauthority逸脱として競合にし、applyを中止する。
- 本番applyとbackend切替は別の運用承認・readiness証跡を必要とする。

## Diagrams

### ER (`kind: er`)

```mermaid
flowchart LR
  P["Graph Person authority"] -->|owner / assignee validation| API["Canonical Task API"]
  PRJ["Graph Project authority"] -->|project validation| API
  API --> CT["PostgreSQL canonical_tasks"]
  CT --> OP["canonical_task_operations"]
  CT -->|projection| NC["NocoDB mirror"]
  CT -->|projection| CV["Slack Canvas"]
```

### Threat Model (`kind: threat_model`)

```mermaid
flowchart LR
  U["Authorized mana-runtime caller"] -->|signed principal| API["Canonical Task API"]
  X["Untrusted Slack or Canvas input"] -->|must not write directly| API
  API -->|People and project validation| G["Graph authority"]
  API -->|single writer and readiness| DB["PostgreSQL SSOT"]
  M["Migration operator"] -->|dry-run / check / approved apply| DB
  DB -->|redacted counts only| L["Operational logs"]
  DB -->|one-way projection| C["Slack Canvas"]
```

## Verification

- PostgreSQL repository unit tests。
- schema/migration unit tests。
- bootstrap backend selection regression。
- 既存Canonical Task service/route tests。
- `git diff --check`とVibePro Gate。

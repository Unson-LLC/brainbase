---
story_id: story-outcome-case-v1
title: OutcomeCase v1 組織成果の閉鎖判断
status: active
production_evidence: not_collected
done: false
---

# OutcomeCase v1 組織成果の閉鎖判断

## 利用者成果

組織は、成果を「HTTP 200・テスト成功・保存・デプロイ」で完了と取り違えず、技術証拠、既存 RunReceipt、外部読戻し、制約確認を分離して、閉鎖可否を再現可能に判断できる。

## 受け入れ条件

- [x] AC-001: OutcomeCase は case_id、project_code、capability_id、利用者可観測成果、保護制約、非目標、Info SSOT RACI で解決した authority と provenance、domain pack、追記専用の評価履歴、閉鎖状態、外部状態、各参照、参照解決状態、不解決失敗境界、revision、時刻を保持する。各評価履歴には当時の外部状態・不解決境界・結果 revision/status を保存し、DB trigger が旧履歴の不変・1件だけの追記を強制する。
- [x] AC-002: create/read/evaluate の最小 API だけを `workflowAuthGuard` 配下で提供し、既存 RunReceipt v1 の schema・ingest・query 契約を変更しない。全 repository CRUD は actor から作る `InfoSSOTService.withAccessContext` の scoped client で実行し、OutcomeCase schema と FORCE RLS は既存の idempotent Info SSOT 適用経路へ登録する。
- [x] AC-003: `closed` は technical evidence が confirmed、初回以降に保持した**全** RunReceipt 参照が既存照会で confirmed、external readback が confirm、constraints が satisfied、project/capability と closure authority が authoritative read-only resolver で confirmed、かつ認証済み actor が解決済み authority の閉鎖許可者である場合に限る。request は authority を自己申告できない。
- [x] AC-004: HTTP 応答、テスト、保存、デプロイはそれだけで close 判定へ変換されない。証拠未収集・参照不明・外部読戻し no_data・resolver 未解決は close しない。internal/admin/ceo を含め、空の project scope は read/create/evaluate を許可しない。
- [x] AC-005: Graph に未知の entity type を書き込まない。OutcomeCase は既存 project/capability への参照を持つ制御面 record とし、本 Story では本番 Graph 書込み・外部送信・deploy を実施しない。resolver は read-only で、capability registry が未適用なら明示的に unresolved とする。

## 非目標

KnowledgeEvent の自動昇格、汎用 workflow engine、RunReceipt v1 の変更、Graph ontology の active release 更新、本番 migration、外部送信、deploy。

## 実装済みローカル証拠

- `tests/server/services/outcome-case-service.test.js`: 追記履歴、保持 receipt 全件診断、評価ごとの状態/revision、自己申告 authority 拒否、actor/project scope、resolver 障害の close 禁止。
- `tests/server/routes/outcome-cases.test.js`: 実 `registerApiRoutes` + `workflowAuthGuard` の未認証拒否と create/read/evaluate 配線。
- `tests/server/services/outcome-case-reference-resolver.test.js`: scope 付き read-only project/capability/RACI resolver と access-context/query 障害時の unresolved。
- `tests/server/scripts/info-ssot-apply.test.js`: OutcomeCase schema/RLS/readback/negative smoke を含む idempotent apply bundle の二回実行。
- `tests/server/services/outcome-case-postgres-rls.integration.test.js` と `scripts/verify-outcome-case-postgres-rls-integration.sh`: ephemeral PostgreSQL の NOSUPERUSER/NOBYPASSRLS role で、実 API/repository の scoped create/read/evaluate、cross-project 不可視、履歴短縮・書換え拒否を確認する。

本番 migration、production DB の readback、外部受領は未実施であり、ここでのチェック完了はその証拠ではない。

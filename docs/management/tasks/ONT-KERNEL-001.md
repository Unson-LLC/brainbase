---
task_id: ONT-KERNEL-001
story_id: story-brainbase-ontology-kernel
status: in_progress
priority: high
created_at: 2026-08-02
---

# Ontology Kernel v1を実装する

## 成果

5領域の最小contractをmanifest、決定的kernel、Info SSOT API、保存前guardとして実装する。既存Graphを自動変更せず、未監査を成功扱いしない。

## 対象

- `config/ontology/brainbase-ontology.v1.json`
- `server/services/ontology-kernel.js`
- `server/services/info-ssot-service.js`
- `server/controllers/info-ssot-controller.js`
- `server/routes/info-ssot.js`
- `mcp/brainbase/src/indexer/ontology.ts`
- 対応するunit/service/route contract tests

## 手順

1. manifestとkernelのcontract testを失敗させる。
2. 型・関係・制約の検証を実装する。
3. Decision推論と変更impact/history contractを実装する。
4. Info SSOT read/dry-run APIと汎用write guardへ接続する。
5. MCP型projection互換性、対象test、typecheck、VibePro Gateを検証する。

## 非対象・後続

- 既存Graph全件の自動修正または削除
- すべての専用write pathの同時移行
- 汎用OWL/RDF/SHACL engine

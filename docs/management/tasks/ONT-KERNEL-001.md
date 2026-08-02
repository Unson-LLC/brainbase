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
- `config/ontology/index.json`と`config/ontology/releases/1.0.0.json`
- `server/services/ontology-kernel.js`
- `server/services/info-ssot-service.js`
- `server/controllers/info-ssot-controller.js`
- `server/routes/info-ssot.js`
- `scripts/ontology-release-publish.js`と`scripts/ontology-release-verify.js`
- `package.json`の`ontology:publish` / `ontology:verify` command
- `.github/workflows/vibepro-graph-ssot.yml`の必須verify step（PRではbase/head SHAを渡す）
- `server/services/learning-service.js`のGraph promotion type inventory guard
- `server/**/*.{js,mjs}` / `scripts/**/*.{js,mjs,py}`のGraph writer inventory verifierと既知writer allowlist
- `mcp/brainbase/src/indexer/ontology.ts`
- 対応するunit/service/route contract tests

## 手順

1. manifestとkernelのcontract testを失敗させる。
2. 型・関係・制約の検証を実装する。
3. atomic entity+edge commit、bounded DB-backed audit、Decision推論、変更impact/history contractを実装する。
4. current/version/as-of readback、HEAD、release file全bytesのSHA-256をindexへ保持するdigest契約、Graph RACI/Decisionを検証する唯一のpublisher、base比較verify gate、汎用write guardへ接続する。
5. `package.json`へpublish/verify commandを登録し、`.github/workflows/vibepro-graph-ssot.yml`でPRのbase/head SHAを渡して`ontology:verify`を必須実行する。
6. ownerなしapp、`depends_on`、Decision/RACI/Glossary/KPI/Initiative/AI Query/AI Decision Log、learning memory-candidate promotionの全mapped typeと未知型拒否、既知7 migration/upsert scripts、partial audit、public/storage aliasの回帰matrixを実装する。server/scriptsのGraph table mutationとupsert helperをscanし、matrixとの双方向不一致をfailさせる。
7. MCP型projection互換性、対象test、typecheck、VibePro Gateを検証する。

## 非対象・後続

- scopeなしの既存Graph全件監査、自動修正または削除
- すべての専用write pathの同時移行
- 汎用OWL/RDF/SHACL engine

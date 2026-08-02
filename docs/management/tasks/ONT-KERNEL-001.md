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
- `config/ontology/publications/<version>.receipt.json`（publisher output。初期`1.0.0` proposed releaseには作成しない）
- `server/services/ontology-kernel.js`
- `server/services/info-ssot-service.js`
- `server/controllers/info-ssot-controller.js`
- `server/routes/info-ssot.js`
- `POST /api/info/ontology/publications/authorize`（既存auth middlewareでprincipalを`personId`へ結合し、source commitへbindしたEd25519 receiptを発行）
- `scripts/ontology-release-publish.js`と`scripts/ontology-release-verify.js`
- `package.json`の`ontology:publish` / `ontology:verify` command
- `.github/workflows/vibepro-graph-ssot.yml`の完全履歴checkoutと必須verify step（PRではbase/head SHAを渡す）
- `server/services/learning-service.js`のGraph promotion type inventory guard
- `server/**/*.{js,mjs}` / `scripts/**/*.{js,mjs,py}`のGraph writer inventory verifierと既知writer allowlist
- `mcp/brainbase/src/indexer/ontology.ts`
- 対応するunit/service/route contract tests

## 手順

1. manifestとkernelのcontract testを失敗させる。
2. 型・関係・制約の検証を実装する。
3. atomic entity+edge commit、bounded DB-backed audit、Decision推論、変更impact/history contractを実装する。
4. current/version/as-of readback、release file全bytesのSHA-256をindexへ保持するdigest契約、認証actor/applier・Graph RACIとDecision payloadに承認されたversion/digest/source commitを検証してEd25519 authority receiptを発行するendpoint、receipt・index・compatibility viewを生成する唯一のpublisher、base比較verify gate、汎用write guardへ接続する。authority endpointのrequest/responseと400/401/403/404/409/503をroute/service testで固定する。
5. `package.json`へpublish/verify commandを登録し、`.github/workflows/vibepro-graph-ssot.yml`の`actions/checkout`を`fetch-depth: 0`にした上でPRのbase/head SHAを渡して`ontology:verify`を必須実行する。PR時はpublisher生成物だけをsource commit直後の1 commitへ閉じ、merge後は保存されたsource/publication direct-child pairと許可pathを検証する。Ontology current変更PRはmerge strategyに限定し、base/source commit object欠落、生成物以外の混入、squash/rebaseによるpair消失、自己参照HEAD設計をfailさせるfixtureを先に作る。
6. ownerなしapp、`depends_on`、Decision/RACI/Glossary/KPI/Initiative、AI Query/AI Decision Logの成功responseと生成edge、Companion peopleのperson/project/`member_of`生成、learning memory-candidate promotionの全mapped typeと未知型拒否、既知7 migration/upsert scripts、partial audit、public/storage aliasの回帰matrixを実装する。current不在時にGraphへ書く既存runtime pathは、既存response fieldを維持して`guard_status: inactive_no_current`を必須追加し、pre-fix responseを落とすroute/controller assertionを置く。server/scriptsのGraph table mutation、upsert helper、Graph HTTP POST/common wrapperをscanし、Companion writerと`upsert-app-environments.mjs`を含むmatrixとの双方向不一致をfailさせる。
7. MCP型projection互換性、対象test、typecheck、VibePro Gateを検証する。

current不在時は、明示versionとcaller提供snapshotのreadback・validate・infer・impactだけがproposed候補を利用する。current取得は404、新設atomic commit・DB audit・暗黙versionのvalidate/infer/impactは503でfail closedとし、明示versionでもcanonical DB snapshotを補完しない。Graphへ書く既存runtime pathは成功responseへ`guard_status: inactive_no_current`を必須追加して互換継続し、内部監査だけで代替しない。proposed規則をcanonical guardとして暗黙適用しない。

初期`1.0.0`はimmutable releaseとindex entryだけを`proposed`として追加し、receipt/current/compatibility viewは生成しない。実在する承認Decision、Accountable RACI、署名鍵が揃うまでpublishは実行しない。

## 非対象・後続

- scopeなしの既存Graph全件監査、自動修正または削除
- すべての専用write pathの同時移行
- 実Decision、Accountable RACI、署名鍵を揃えた`1.0.0`のactive化とcanonical guard有効化（必須後続Task）
- 汎用OWL/RDF/SHACL engine

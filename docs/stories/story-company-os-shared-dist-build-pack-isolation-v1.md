---
story_id: story-company-os-shared-dist-build-pack-isolation-v1
title: 共有distのbuildとpack競合疑いを調査して隔離する
status: in_progress
created_at: 2026-09-23
implementation_started: true
owner_repository: brainbase
depends_on: []
external_dependencies: []
---

# 共有distのbuildとpack競合疑いを調査して隔離する

## 利用者成果

buildとpackage検証を同時に実行しても共有 `dist` の中間状態を読み込まず、再現条件と隔離方法を判断できる。

## 根拠と不確実性

- `tests/npm-consumer-smoke.integration.test.ts:37` のroot build、`tests/npm-release-validation.integration.test.ts:46` から `scripts/npm-release.mjs:245` の `npm pack`、`tests/repo-hygiene.test.ts:43` の `npm pack` dry-runが、従来は同じroot `dist`をpack入力としていた。prepare付きpackはroot `dist`へ書き込むため、build workerとの共有書込み境界になっていた。
- 8並列のroot `tsc -p tsconfig.json`で `dist/canonical-graph.d.ts` の長さ0を観測し、共有出力の中間状態を直接確認した。一方、旧CI 35837694006の `foundation-store.js` read EOFとpack同時実行での再現は未確認であり、同一原因とは断定しない。

## 受入条件

- [x] build／pack／consumer smokeの共有出力先とprepare経路を列挙し、8並列 `tsc` とverbose lifecycle traceで同時実行時の書込・読込境界を記録した。
- [x] 共有 `dist` の中間状態は再現できたが、旧CIのread EOF自体とpack同時実行での再現は未確認として残した。
- [x] pack入力を一時ディレクトリへ構成し、pack処理がroot `dist`へ書き込まない隔離を実装した。repo hygiene、release validation、consumer smoke、MCP-only E2Eで検証した。

## 検証と完了

## 実装・検証状況

- 新Spec: `.vibepro/spec/story-company-os-shared-dist-build-pack-isolation-v1/draft.json`
- 実装: `scripts/npm-release.mjs` にpack入力の一時構成を追加し、repo hygieneは生成物 `dist` をpack dry-runから除外した。`package.json` の `prepare: npm run build` 契約は変更していない。
- `tests/e2e/brainbase-mcp-only-acceptance.spec.ts` も直接のroot `npm pack --dry-run`を使わず、生成物 `dist`を除外する共通の `packFilesInIsolation` 経路を参照する。E2Eのpack検証が `prepare` を起動してroot `dist`へ書き込む競合をなくした。
- CIのNode 22.23.2 / npm 10.9.8で、`--ignore-scripts`付きのlocal `pack-input`でも`prepare`が実行されることが判明したため、一時manifestからpack lifecycle hookを除去し、source packageのprepare契約は保持した。
- 検証済み: npm 10.9.8でE2E・consumer smoke・release validationを同時実行し3 files / 3 tests pass。既存のaffected 4 files / 57 tests pass、`npx vitest run tests/repo-hygiene.test.ts --reporter=verbose`（7 tests pass）、`npx vitest run tests/npm-release-validation.integration.test.ts --reporter=verbose`（1 test pass）、consumer smoke（1 test pass）、`git diff --check`も確認済み。
- 未確認: 旧CIのread EOFがこの競合だけで再現すること。通常のconsumer smoke既定60秒は共有ホスト負荷でtimeoutしたため、timeoutを変更せずにCIで再確認する。
- PR、CI、mergeは未完了である。

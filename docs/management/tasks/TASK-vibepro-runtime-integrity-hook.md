---
task_id: TASK-vibepro-runtime-integrity-hook
story_id: story-brainbase-vibepro-runtime-integrity-hook
status: completed
priority: high
created_at: 2026-08-11
---

# Brainbase push hookをcanonical VibePro runtimeへ統一する

## 実装

1. exact npm identityを検証する共通validatorを追加する。
2. shell pre-pushとClaude Code push hookをvalidatorへ接続する。
3. fail-openと旧source checkout固定参照を除去する。
4. trusted identity、behind+dirty、digest mismatch、hook wiringをテストする。
5. canonical npm runtimeでverifyとPR preparationの証跡を生成する。

## 完了条件

- 対象unit testとtypecheckがpassする。
- 両hookが同じexact version/source commit/digestを報告する。
- `pr-prepare.json` とverification evidenceにruntime identityが記録される。

## Graphify Impact Review

- command: `vibepro graph . --run-graphify`
- artifact: `.vibepro/graphify/graph.json`（6841 nodes / 14795 links）
- 対象の `.claude/scripts/hooks/lib/vibepro-runtime-contract.mjs` と `.claude/scripts/hooks/pre-tool-use/git-push-gate.ts` はdot-pathのため、import済みgraphでは0 node / 0 link。
- 直接影響は共通runtime validatorと両hookの呼び出し境界として確認し、`tests/unit/vibepro-runtime-hook-contract.test.js`（5/5 pass）、`npm run typecheck`（pass）、実pre-push smokeで検証した。

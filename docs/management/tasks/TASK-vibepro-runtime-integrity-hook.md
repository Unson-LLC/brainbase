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

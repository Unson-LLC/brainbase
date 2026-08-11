---
task_id: TASK-brainbase-judgment-audit-fail-closed
story_id: story-brainbase-judgment-audit-fail-closed
status: in_progress
priority: critical
created_at: 2026-08-11
---

# Judgment監査のeffective trustとfail-closed境界を修正する

## 実装

1. Codex `hooks/list`を使うreadiness checkerとfake app-server unit testを追加する。
2. orphan Stopは明示failureのまま維持し、修復可能な監査不足はactive再Stopでも`decision:block`を返してfinalを作らない。
3. optional zero-call表示と行末空白の表示同値をHost unit/process integration testで固定する。
4. live E2Eをeffective trustとfresh task evidenceへ束縛する。
5. Skill、Capability、Runbook、Architecture、Spec、Story、AGENTS/CLAUDEを同じ状態モデルへ同期する。
6. exact npm `vibepro@0.2.0-beta.5`でverify、review、PR preparationを実行する。

## 完了条件

- targeted unit/integration/publication testがpassする。
- current `trustStatus: modified`環境でcheckerが非zeroの`trust_required`を返す。
- ownerが`/hooks`で再承認した後、checkerが`ready_for_fresh_task`を返す。
- active再Stopの監査不足がexit 0の`decision:block`となり、complete finalなしでtask完了しない。
- optional zero-call turnが`📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓`を表示してcompleteになる。
- 承認後に作成した新規Desktop taskのlive E2Eだけが`proven_active`を証明する。
- VibePro Gateを通し、未達のowner操作を成功扱いせずPR evidenceへ残す。

## Graphify impact

pre-architecture Graphifyは既存Resolver server/runtimeの大規模変更を要求しなかった。変更はCodex lifecycle adapter、readiness CLI、対象test、published contractへ限定する。

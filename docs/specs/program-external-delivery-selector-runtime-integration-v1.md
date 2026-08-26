# Program external delivery selector runtime integration v1 Spec

## 正本

- predecessor Story: `docs/management/stories/active/story-program-external-delivery-reconciliation-v1.md`
- predecessor Architecture: `docs/architecture/story-program-external-delivery-reconciliation-v1.md`
- predecessor Spec: `docs/specs/program-external-delivery-reconciliation-v1.md`
- predecessor selector contract: `scripts/program/reconcile-external-delivery.mjs`
- planning test: `tests/contracts/program-external-delivery-selector-runtime-integration-planning.test.js`

## 計画状態

- story: `story-program-external-delivery-selector-runtime-integration-v1`
- predecessor: `story-program-external-delivery-reconciliation-v1`
- lifecycle: `planning_only`
- status: `planned`
- blocked: `true`
- production evidence: `not_collected`
- done: `false`

## 不変条件

1. actual external delivery readbackを同一runで完了し、source、readback時刻、repository-qualified identity、immutable provenanceを束縛する前にselectorを呼び出さない。
2. selectorはactual readbackの結果だけを入力にし、stale snapshot、title一致だけの候補、黙った候補除外を使わない。
3. selectorはProgram status評価より前に実行する。処理順は`actual_readback -> selector -> before_program_status_evaluation`で固定する。
4. readback、identity、provenance、selectorの失敗はfail-closedでreconciliation Gateを`needs_review`とし、status評価を続行しない。
5. selector成功、external merge、release、docs、open PRはProgram statusを自動promotionしない。`verified`、`production_proven`、`done`には別のexit evidenceが必要である。
6. predecessor v1のcontract-only責務へruntime integrationを追加しない。本Specはplanning-onlyであり、runtime実装、外部mutation、deploy、production readbackを含まない。
7. 本Specのplanning evidenceは静的なJSON/順序/失敗境界の確認だけで、production evidenceは`not_collected`、doneはfalseのままにする。

## selector契約

```json
{
  "sequence": [
    "actual_external_delivery_readback",
    "selector",
    "before_program_status_evaluation"
  ],
  "failure_surface": "fail_closed_reconciliation_gate_needs_review",
  "automatic_promotion": false,
  "production_evidence": "not_collected"
}
```

## blocked境界

後続実装を開始するには、runtime owner、readback adapterと同一runの入力契約、selector caller、failure receipt、独立review/Gateの担当を別Taskで確定する必要がある。これらは未確定なので本Storyは`blocked`であり、predecessorのcontract-ready証跡やテスト結果をruntime/production evidenceへ流用しない。

# Program external delivery selector runtime integration v1 Architecture

## 位置付け

`story-program-external-delivery-reconciliation-v1`の契約を、将来のruntime integrationへ接続するためのplanning-only architectureである。predecessorのcontract-ready surfaceや`scripts/program/reconcile-external-delivery.mjs`を、このStoryの実装証拠へ昇格させない。本Storyのstatusは`planned`、境界は`blocked`、production evidenceは`not_collected`とする。

## 処理順序の契約

```text
actual external delivery readback (same run, source + read_at)
  -> repository-qualified identity + immutable provenance
  -> selector (same readback result)
  -> before Program status evaluation
  -> reconciliation Gate / status decision
```

selectorはactual readbackの完了を前提にし、readbackで得たidentity、source、read_at、immutable provenanceを同じrunの入力として受け取る。selectorを先に実行したり、前回runのsnapshotやtitle一致だけの候補を補填したりしない。selectorの成功結果もProgram statusのpromotion根拠ではない。

## 失敗と状態境界

- readback unavailable、identity mismatch、provenance欠損、selector exception、selector結果不整合は、すべてfail-closedでreconciliation Gateを`needs_review`にする。
- fail-closed時は候補を黙って除外せず、失敗理由と同一runのreadback境界を残す。Program status評価を続行して自動promotionしない。
- external delivery state、selector結果、Program status、production evidenceは別の状態として保存する。merge、release、docs、open PR、selector成功だけでは`verified`、`production_proven`、`done`へ進めない。
- no automatic promotionを維持し、Program statusの更新は別のexit evidenceとGateで確定する。

## ownershipと依存

- predecessor owner: `scripts/program/reconcile-external-delivery.mjs`を使うreconciliation契約Story。これは現行v1の契約境界であり、本Storyのruntime ownerではない。
- successor runtime owner: 未割当。具体的なmodule、caller、readback adapter、rollback/retry契約は後続の実装Taskで決める。
- blocked_by: predecessorがcontract-onlyであること、runtime owner・実装Task・独立review/Gateが未確定であること。
- planning-onlyでは新しいruntime入口、外部write、deploy、production readbackを作成しない。

## 証拠境界

この文書、後続Spec/Task、JSON parse、静的な順序・失敗境界のfocused testだけがplanning evidenceである。production evidenceは`not_collected`のままであり、test passを本番成功やstatus promotionの証拠へ変換しない。

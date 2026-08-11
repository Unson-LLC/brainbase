# Production Ontology Shadow Audit — 2026-08-03

## 結論

候補 Ontology `1.0.0`（digest `a1c56260...`）を本番 Graph の全件スナップショットへ読み取り専用で適用した。違反は 6,156 件から 61 件へ減少し、削減率は 99.009% だった。語彙、型境界、基数の互換性違反は 0 件になった。

ただし Graph はまだ適合状態ではないため、`current` への昇格は **No-Go** とする。

## Evidence boundary

- 対象: production `graph_entities` 7,403 件、`graph_edges` 6,680 件
- 監査時刻: 2026-08-03 02:22:00 JST
- DB transaction: `BEGIN READ ONLY` / `ROLLBACK`
- 検証結果: `verification=verified`, `valid=false`
- snapshot digest: `4db7964d1402e50ab7d69f54c7ceb166c87d4d2826d8a8c08e9033dc37f8820a`
- observed inventory digest: `7be143d9f98ff1a7f288d48452c9e29d3e996c4aa5ff251e2b63ac7a2dfccf58`
- baseline source: Git commit `92d94a90d5d1d072c2869842495a7e69787e70a9` の `config/ontology/releases/1.0.0.json`
- サービス設定、Graph データ、Ontology `current` は変更していない

## 再監査

同じread-only収集・検証経路は、passwordを含む`INFO_SSOT_DATABASE_URL`をruntimeから注入した環境で次のコマンドにより再実行する。

```bash
node scripts/ontology-shadow-audit.js --version 1.0.0 \
  --baseline-ref 92d94a90d5d1d072c2869842495a7e69787e70a9
```

runnerは`BEGIN READ ONLY`後に全entity/edgeを収集し、成功した完全snapshotだけを`verified`として出力する。同じsnapshotにbaseline releaseと候補releaseを適用し、snapshot digest、entity型件数、relation両endpoint型件数、そのinventory digest、両違反内訳、削減率を一つのJSONへ出力する。途中失敗は例外終了し、`finally`で`ROLLBACK`するため、0件または部分成功として保存しない。

## 残存違反

| rule | count | 判断 |
|---|---:|---|
| `edge-reference-integrity` | 31 | 欠損endpointの正本確認が必要。推測削除しない |
| `CON-APP-OWNER-001` | 26 | org ownerの事実確認が必要。legacy `project -> app owns_app` から捏造しない |
| `CON-DECISION-DECIDER-001` | 3 | 判断者の正本確認が必要 |
| `CON-DECISION-SCOPE-001` | 1 | 適用projectの正本確認が必要 |

## Activation gates still open

- 上記61件のcanonical事実修復
- Ontology governance approval（RACI）
- production signing key / key ID
- 署名済みpublication receiptとrollback演習

集計の機械可読正本は同ディレクトリの `production-shadow-audit-2026-08-03.json` とする。

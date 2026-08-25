# Phase 0 実装タスク

| ID | 内容 | 状態 |
|---|---|---|
| P0-AUTHORITY | A0署名contextをPersonal KG昇格経路へ接続 | 完了 |
| P0-NEGATIVE-RUNTIME | 期限切れ・不正署名・再送を副作用0で拒否 | 完了 |
| P0-MIGRATION | authority使用台帳とRLSを後方互換で追加 | 完了 |
| P0-GRAPH-BOUNDARY | Graphへの一度だけの反映と公開readback | 完了 |
| P0-PRODUCTION-SMOKE | synthetic fixture issuerと本番smoke | 完了 |
| P0-RELEASE | Gate・PR・merge・本番migration・同一run readback | 実行中 |

完了判定はHTTP 200だけにしない。VibePro Gate、PR merge、本番の正確なcommit、migration、Receipt、DB/API/Graph readback、Personal本文不在、重複0、同一署名authority再送時の更新差分0を同一runで確認する。

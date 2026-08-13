---
spec_id: spec-brainbase-routine-liveness
status: accepted
story: story-brainbase-routine-liveness
architecture: docs/architecture/brainbase-routine-liveness-architecture.md
---

# Brainbase記憶ルーティン生存確認仕様

## 期待値マニフェスト

正本は`server/config/routine-expectations.json`とする。各項目は`automation_id`、`source_type`、`project_id`、`timezone`、`schedule`、`grace_minutes`、`required_artifacts`を持つ。

起動時に項目の型、時刻範囲、正の猶予時間、1件以上の必須成果物を検証する。`routine`または`automation_id`が重複した設定は、該当indexとfieldを含む例外で停止する。

| automation_id | schedule | grace | required artifact |
|---|---:|---:|---|
| brainbase-oyasumi | 03:00 daily | 20分 | routine summary |
| brainbase-ohayo | 06:00 daily | 20分 | routine summary |
| brainbase-retro | 00:00 Saturday | 60分 | routine summary |

## Routine Runner入力

`node scripts/routines/run.mjs <ohayo|oyasumi|retro>`を唯一の実行入口にする。`CODEX_THREAD_ID`を`run_id`へ、固定値`brainbase`をreceiptの`project_id`へ写像する。

runnerは標準入力のJSONから`status`、`started_at`、`finished_at`、`evidence_refs`を受け取る。未指定時刻はrunnerが補う。terminal statusだけをReceipt化する。

## 診断

診断サービスは期待値と最新Receiptを照合し、次を返す。

- `missing_receipt`: scheduled time + graceを超えたが対象workflowのReceiptがない。
- `blocked_receipt`: 最新Receiptがblocked/failed/waiting_human、またはevidence stateがno_data/unconfirmed。
- `dead_letter`: 対象automationのDead Letterが存在する。

`success/confirmed`でも`required_artifacts`の証跡がないReceiptは`blocked_receipt`とし、`missing_required_artifacts`を返す。Dead Letterの読取結果は`automation_id`、`created_at`、`path`に限定する。

優先順位は`dead_letter`、`missing_receipt`、`blocked_receipt`、期限超過時間降順、automation ID昇順。返却は最大3件。

認証済みの`GET /api/run-receipts/routine-exceptions`は同じ決定順で最大3件を返す。`/ohayo`はこのAPIを朝の例外入力として利用する。

## TDDケース

1. `CODEX_THREAD_ID`があるterminal runは`project_id=brainbase`のsource receiptになる。
2. thread IDがないrunはsource successを作らずconnector observationになる。
3. 期限内Receiptはmissingにならず、期限超過はmissingになる。
4. Dead LetterはReceipt有無にかかわらず最優先になる。
5. 異常が4件以上でも決定順の上位3件だけを返す。
6. 不正または重複した期待値マニフェストは起動前に失敗する。
7. `success/confirmed`でも必須成果物が欠ければblockedになる。
8. Dead Letter読取結果にReceipt本文やblockerを含めない。

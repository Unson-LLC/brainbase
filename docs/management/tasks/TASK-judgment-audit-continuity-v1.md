---
task_id: TASK-judgment-audit-continuity-v1
story_id: story-judgment-audit-continuity-v1
status: in_progress
priority: critical
created_at: 2026-08-28
---

# Judgment監査の誤欠損と人手復旧停止を解消する

## 実装

1. event記録とStop確定のepisode読込をtransition lock内へ移す。
2. orphan Stopのdigest-only diagnosticと`audit_degraded` receiptを追加する。
3. first Stopを本文保持付き1回repair、active Stopを非blocking/idempotent degradeにする。
4. エラー文から恒久対策にならない新規task作成要求を除去する。
5. lock競合、Goal型orphan、degraded非採用、identity欠損をTDDで固定する。
6. targeted/full test、typecheck、VibePro Gate、独立reviewを実行する。

## 完了条件

- Start進行中のPostToolUse/Stopが誤ってepisode欠損にならない。
- true orphanが1回のrepair後にexit 0となり、degraded receiptをexactly oneで残す。
- true orphanがcomplete finalやprior finalized judgmentとして採用されない。
- identity/integrity failureと通常episodeの完全監査契約が維持される。
- local Gateがpassし、独立reviewのblocking findingがない。
- global Hook切替とDesktop E2Eは未承認のまま実施しない。

## Graphify impact

変更対象はCodex judgment Host adapter、対応test、published contractに限定する。Resolver分類DAG、Knowledge Resolver、Brainbase API、外部操作authorityには影響しない。

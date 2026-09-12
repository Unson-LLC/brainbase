---
story_id: story-judgment-harness-degraded-operation
title: Brainbase監査が故障してもCodexの診断と作業を継続できる
status: active
created_at: 2026-09-12
spec_docs:
  - docs/specs/story-judgment-harness-degraded-operation.md
architecture_docs:
  - docs/architecture/ADR-judgment-harness-degraded-operation.md
development_mode: SIMPLIFICATION
---

# Brainbase監査が故障してもCodexの診断と作業を継続できる

利用者として、Brainbaseの監査用Host、Node入口、journalのどれかが故障しても、Codex本体で原因調査と復旧を続けたい。
監査できなかった事実は隠さず、通常のCodex権限と承認をBrainbaseの監査receiptで置き換えたくない。

## 受け入れ条件

- Host通信、Host応答、journal保存、Node不在、module importの失敗だけでは、Codexの応答・tool利用・最終回答を停止しない。
- 故障時は完全監査済みとせず、安全な原因と監査未完了を表示する。
- Brainbaseの判断receiptは操作許可として扱わず、外部送信・削除・本番操作などは通常のCodex権限と承認に従う。
- Hostが正常なturnでは、既存のepisode、required capability、audit、Stop契約を維持する。
- 診断継続のためだけのcanary modeとcwd設定を不要にする。
- 実エントリーポイントと隔離journalを使い、Host故障と入口故障の回帰テストを行う。

## スコープ外

- Codex本体の権限・承認機構の変更
- Brainbaseの障害を正常稼働として記録すること
- 本番runtimeへの自動配備

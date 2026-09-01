---
story_id: story-m3-judgment-value-proof-surface
title: M3 代理判断の価値を日常会話で証明するportable surface
status: active
category: product
spec: docs/specs/m3-judgment-value-proof-surface.md
architecture: docs/architecture/judgment-value-proof-surface.md
canonical_story_path: docs/management/stories/active/story-m3-judgment-value-proof-surface.md
created_at: 2026-09-01
updated_at: 2026-09-01
---

# M3 代理判断の価値を日常会話で証明するportable surface

## Intent

BrainbaseをMCP接続したCodex / Claude Codeの利用者として、Brainbaseが何を検索したかではなく、どの確認を代行し、どの判断を適用し、仕事をどこまで進め、成果を確認できたかを作業中と完了時に最小の認知負荷で知りたい。これにより、Brainbaseへ判断を蓄積する行為と、日常業務が止まらなくなる価値を直接結び付ける。

## Acceptance criteria

- [x] AC-001: `intent_id`と`decision_attempt_id`で既存のJudgment/Autonomy/Tool/Outcome/Feedback証跡を結ぶportableな`brainbase-judgment-value-proof-v1`型とJSON Schemaを公開する。
- [x] AC-002: 通常参照はsilent、代理判断で行動が変わった実行中だけ1行、代理判断を含む完了時だけ結果先頭の判断レシートを返すpure placement/rendering functionsを実装する。
- [x] AC-003: 人間判断が必要な場合は、質問だけでなくAIで決めない理由、選択肢、影響をCodex / Claude向けにレンダリングする。
- [x] AC-004: Mac Companionへはhuman_required、blocked、outcome_unconfirmed、feedback_requestedだけを投影し、成功runを常時通知しない。
- [x] AC-005: 週次要約は代理判断、成果確認、人間判断、訂正、結果未確認、停止を分離し、unavailableを0件へ丸めない。
- [x] AC-006: 既定表示はEntity ID、raw evidence ref、tool response本文を出さず、監査詳細と価値表示を分離する。
- [ ] AC-007: `brainbase-unson`が固定commitの共通コアを消費し、現行Resolver HostとMac Companion projectionへ接続するconsumer回帰を通す。
- [ ] AC-008: fresh Codex taskで、不要な確認を差し戻したケースの途中1行、完了レシート、訂正feedbackまでを同一`intent_id`で読み戻す。

## Boundary

- 本Storyは監査正本を置き換えず、既存証跡から作る派生projectionだけを定義する。
- Brainbase Webに日常業務ダッシュボードを追加しない。
- 組織横断の保存、配信、権限、Companion UIは`brainbase-unson`の責務とする。
- 成果が未確認の場合は`outcome_verified`を表明しない。

## Evidence

TypeScript build、pure renderer unit tests、JSON Schema fixture、組織版consumer testを同じ公開契約へ束縛する。AC-007以降は組織版側のStoryで完了させる。

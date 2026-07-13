# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | meeting packのEve候補と担当者SSOT解決 |
| Story ID | story-eve-meeting-candidates-pull-reconciler |
| Run ID | 2026-07-13T042747Z |
| Gate | pass |
| タスク数 | 3 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-eve-meeting-candidates-pull-reconciler-spec-recovery | - | medium | 0件 | spec-recovery | todo |
| story-eve-meeting-candidates-pull-reconciler-kpi-period | - | medium | 0件 | kpi-period | todo |
| story-eve-meeting-candidates-pull-reconciler-source-alignment-review | - | high | 0件 | source-alignment-review | todo |

## story-eve-meeting-candidates-pull-reconciler-spec-recovery: Spec正本を復元する

- Source: story_plan_candidate / story-eve-meeting-candidates-pull-reconciler-spec-recovery
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: -
- Recommended strategy: spec-recovery

完了条件:
- missing_spec が残る理由を確認済みにする
- Storyのwho/problem/outcomeが人間レビュー済みになる
- Spec草案の受け入れ基準がコード分岐と対応する
- 必要なら仕様書またはNocoDB Storyを作る

## story-eve-meeting-candidates-pull-reconciler-kpi-period: KPIとPeriodを確定する

- Source: story_plan_candidate / story-eve-meeting-candidates-pull-reconciler-kpi-period
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: -
- Recommended strategy: kpi-period

完了条件:
- 主要KPIまたは効果測定観点が1つ以上ある
- Periodを確定するか未定として扱う判断がある
- 優先度の根拠が残る

## story-eve-meeting-candidates-pull-reconciler-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-eve-meeting-candidates-pull-reconciler-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: -
- Recommended strategy: source-alignment-review

完了条件:
- 各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している
- Graphifyのhub/communityを読んだ上で影響範囲を説明できる
- 要件が正しい場合はレビュー済み理由を正本またはPR本文に残している
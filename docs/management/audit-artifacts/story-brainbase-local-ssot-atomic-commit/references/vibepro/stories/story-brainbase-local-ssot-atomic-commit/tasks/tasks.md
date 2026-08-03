# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | OSS Local SSOT Atomic Commit |
| Story ID | story-brainbase-local-ssot-atomic-commit |
| Run ID | 2026-08-03T110152Z |
| Gate | pass |
| タスク数 | 3 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-brainbase-local-ssot-atomic-commit-spec-recovery | - | medium | 2件 | spec-recovery | todo |
| story-brainbase-local-ssot-atomic-commit-kpi-period | - | medium | 2件 | kpi-period | todo |
| story-brainbase-local-ssot-atomic-commit-source-alignment-review | - | high | 10件 | source-alignment-review | todo |

## story-brainbase-local-ssot-atomic-commit-spec-recovery: Spec正本を復元する

- Source: story_plan_candidate / story-brainbase-local-ssot-atomic-commit-spec-recovery
- Execution: proposal_only / mutates_repository=false
- Target files: src/ontology-ssot.ts, src/ssot.ts
- Target groups: -
- Read first: src/ontology-ssot.ts, src/ssot.ts, src/cli.ts, src/ontology.ts, src/server.ts, src/types.ts, tests/e2e/brainbase-mcp-only-acceptance.spec.ts, tests/e2e/story-brainbase-portable-ontology-kernel-acceptance.spec.ts, tests/e2e/onboarding-project-registration-acceptance.spec.ts, tests/e2e/onboarding-source-import-extract-acceptance.spec.ts
- Recommended strategy: spec-recovery

完了条件:
- missing_spec が残る理由を確認済みにする
- Storyのwho/problem/outcomeが人間レビュー済みになる
- Spec草案の受け入れ基準がコード分岐と対応する
- 必要なら仕様書またはNocoDB Storyを作る

## story-brainbase-local-ssot-atomic-commit-kpi-period: KPIとPeriodを確定する

- Source: story_plan_candidate / story-brainbase-local-ssot-atomic-commit-kpi-period
- Execution: proposal_only / mutates_repository=false
- Target files: src/ontology-ssot.ts, src/ssot.ts
- Target groups: -
- Read first: src/ontology-ssot.ts, src/ssot.ts, src/cli.ts, src/ontology.ts, src/server.ts, src/types.ts, tests/e2e/brainbase-mcp-only-acceptance.spec.ts, tests/e2e/story-brainbase-portable-ontology-kernel-acceptance.spec.ts, tests/e2e/onboarding-project-registration-acceptance.spec.ts, tests/e2e/onboarding-source-import-extract-acceptance.spec.ts
- Recommended strategy: kpi-period

完了条件:
- 主要KPIまたは効果測定観点が1つ以上ある
- Periodを確定するか未定として扱う判断がある
- 優先度の根拠が残る

## story-brainbase-local-ssot-atomic-commit-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-brainbase-local-ssot-atomic-commit-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: src/ontology-ssot.ts, src/ssot.ts, src/cli.ts, src/ontology.ts, src/server.ts, src/types.ts, tests/e2e/brainbase-mcp-only-acceptance.spec.ts, tests/e2e/story-brainbase-portable-ontology-kernel-acceptance.spec.ts, tests/e2e/onboarding-project-registration-acceptance.spec.ts, tests/e2e/onboarding-source-import-extract-acceptance.spec.ts
- Target groups: -
- Read first: src/ontology-ssot.ts, src/ssot.ts, src/cli.ts, src/ontology.ts, src/server.ts, src/types.ts, tests/e2e/brainbase-mcp-only-acceptance.spec.ts, tests/e2e/story-brainbase-portable-ontology-kernel-acceptance.spec.ts
- Recommended strategy: source-alignment-review

完了条件:
- 各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している
- Graphifyのhub/communityを読んだ上で影響範囲を説明できる
- 要件が正しい場合はレビュー済み理由を正本またはPR本文に残している
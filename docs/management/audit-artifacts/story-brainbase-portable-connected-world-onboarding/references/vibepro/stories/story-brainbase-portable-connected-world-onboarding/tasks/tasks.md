# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | story-brainbase-portable-connected-world-onboarding |
| Story ID | story-brainbase-portable-connected-world-onboarding |
| Run ID | 2026-08-04T110100Z |
| Gate | pass |
| タスク数 | 1 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-brainbase-portable-connected-world-onboarding-source-alignment-review | - | high | 11件 | source-alignment-review | todo |

## story-brainbase-portable-connected-world-onboarding-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-brainbase-portable-connected-world-onboarding-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: src/connected-onboarding.ts, src/guided-onboarding.ts, src/onboarding.ts, src/cli.ts, src/ssot.ts, src/import-extract.ts, src/projects.ts, src/server.ts, src/types.ts, src/ontology.ts, tests/connected-onboarding.test.ts
- Target groups: -
- Read first: src/connected-onboarding.ts, src/guided-onboarding.ts, src/onboarding.ts, src/cli.ts, src/ssot.ts, src/import-extract.ts, src/projects.ts, src/server.ts
- Recommended strategy: source-alignment-review

完了条件:
- 各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している
- Graphifyのhub/communityを読んだ上で影響範囲を説明できる
- 要件が正しい場合はレビュー済み理由を正本またはPR本文に残している
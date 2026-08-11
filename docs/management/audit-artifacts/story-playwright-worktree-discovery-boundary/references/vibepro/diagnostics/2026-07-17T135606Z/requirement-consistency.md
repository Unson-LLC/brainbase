# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 8 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 2 |
| Spec Refs | 1 |
| Architecture Refs | 1 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: AC-004 / ac:4: 正本checkout相当の実行で別worktree由来の二重ロード・依存不足が起きず、正本テストが1件以上列挙される (story:docs/stories/story-playwright-worktree-discovery-boundary.md)
- REQ-INV-002: E2E: Story固有Playwright内で正本specと2種類の擬似worktree specを生成し、実際のcollectorが正本1件だけを列挙することを確認する。 (story:docs/stories/story-playwright-worktree-discovery-boundary.md)
- REQ-INV-003: 加えて全探索のplaywright test --listが正本テストを1件以上列挙し、内部worktree由来のエラーが0件であることを確認する (story:docs/stories/story-playwright-worktree-discovery-boundary.md)
- REQ-INV-004: FM-002: .gitignoreだけではPlaywrightの探索境界にならず、別checkoutのファイルをimportし得る。 (story:docs/stories/story-playwright-worktree-discovery-boundary.md)
- REQ-INV-005: FM-003: worktree自体を削除して症状を消すと、並行開発を壊し、設定の境界不備が残る。 (story:docs/stories/story-playwright-worktree-discovery-boundary.md)
- REQ-SRC-001: **INV-4**: test collection境界の変更はserver、port、project、reporter契約を変更しない。 (spec:docs/specs/story-playwright-worktree-discovery-boundary.md)
- REQ-SRC-002: **C-1**: playwright.config.jsはリポジトリルートをtestDirとして維持する。 (spec:docs/specs/story-playwright-worktree-discovery-boundary.md)
- REQ-SRC-003: testDirと既存testMatchは維持する (architecture:docs/architecture/playwright-worktree-discovery-boundary.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-playwright-worktree-discovery-boundary.md: SPEC: Playwright Worktree Discovery Boundary
- architecture: docs/architecture/playwright-worktree-discovery-boundary.md: Playwright Worktree Discovery Boundary

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0

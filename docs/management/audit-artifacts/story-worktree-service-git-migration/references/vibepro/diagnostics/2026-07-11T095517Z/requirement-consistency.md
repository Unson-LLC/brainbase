# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 4 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 1 |
| Spec Refs | 0 |
| Architecture Refs | 1 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: 正本repoマージデプロイガードをgit化する: 正本checkoutのHEADとmainブランチ（origin/HEAD解決、現状develop）の一致検査、dirty検査、artifact-onlyデルタの許容を維持する。 (story:docs/stories/story-worktree-service-git-migration.md)
- REQ-INV-002: index.lock回復は維持）。 (story:docs/stories/story-worktree-service-git-migration.md)
- REQ-SRC-001: _withRepoLock によるrepo単位の直列化は維持する。 (architecture:docs/architecture/worktree-service-git-migration.md)
- REQ-SRC-002: 正本checkoutの detached HEAD → git checkout develop 復帰（syncCanonicalWorkspaceAfterMergeの checkout -B が以後これを維持する）。 (architecture:docs/architecture/worktree-service-git-migration.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- architecture: docs/architecture/worktree-service-git-migration.md: worktree-service Git Migration Architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0

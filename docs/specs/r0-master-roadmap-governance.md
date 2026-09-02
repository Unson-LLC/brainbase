---
story_id: story-r0-master-roadmap-governance
status: accepted
date: 2026-09-02
---

# R0 OSS roadmap governance contract

## Contract

1. component roadmapはProgram Masterのrepository、Markdown/JSON path、exact commit、SHA-256を表示する。
2. machine source-lockは同じcommit/path/hash、R0 / J0 / G0 / R1 / D0 / P0 / C0、6 statusに加え、snapshot更新時の新commit・両artifact hash・検証証跡・独立review要件を保持する。
3. public verificationは外部networkを前提にせず、固定metadataとローカル表示・digestの整合を検証する。
4. Program revision更新は明示的なsource-lock更新として扱い、暗黙のlatest参照を禁止する。固定snapshotを更新する場合は、新しいcommit・両artifact hash・検証証跡・独立reviewを必須とする。
5. docs-only証拠をruntime、production、またはProgram `done`へ昇格させない。

## Verification

- `tests/judgment-dag-roadmap-governance.test.ts`
- `tests/judgment-dag-public-contract.test.ts`
- `tests/repo-hygiene.test.ts`
- `npm run contracts:generate`後のdiffとhash整合
- 組織repoの固定commitから両Master artifactを読み、source-lockのSHA-256と照合するローカルverification receipt
- 固定snapshot更新時に、新しいcommit・両artifact hash・検証証跡を対象とした独立reviewの記録

## Non-goals

アプリケーション実装面、Graph mutation、production、package publication、Program status mutationは含めない。

# WorktreeごとのGraphify影響分析 Spec

## Contract

- `scripts/graphify-impact-context.mjs --ensure-graph`は`.vibepro/graphify/graph.json`が欠落している時だけ`vibepro graph <repo> --run-graphify`を実行する。
- `--refresh-graph`は同じ生成経路を必ず一度実行してから影響分析する。
- 生成先は対象repo配下に固定し、別checkoutの成果物へフォールバックしない。
- 既存のフラグなし呼び出しは読み取り専用のまま維持する。

## Traceability

- Story: `docs/stories/worktree-graphify-impact-lifecycle.md`
- Code: `scripts/graphify-impact-context.mjs`
- Test: `tests/unit/graphify-impact-context.test.js`
- Runbook: `docs/brainbase-capabilities/runbooks/vibepro-impact-review.md`

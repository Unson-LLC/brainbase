---
story_id: story-brainbase-vibepro-runtime-integrity-hook
title: VibePro runtime integrity hook architecture
status: active
---

# Architecture: VibePro runtime integrity hook

## Decision

`.claude/scripts/hooks/lib/vibepro-runtime-contract.mjs` を唯一のBrainbase側runtime contract
validatorとする。shell pre-pushとClaude Code hookはvalidatorをNodeで起動し、validatorだけが
`~/.local/bin/vibepro` をcanonical invocationとして解決する。

## Trust contract

通常利用runtimeは次の全条件を満たす必要がある。

1. package exact versionが `0.2.0-beta.5`。
2. source kindが `npm_package`。
3. release manifestがvalidで、source commitが
   `5e19da4a890a6ae607241d40bbbb438dae6f5124`。
4. sourceはdirtyでなく、origin relationが`published`。
5. VibeProのintegrity verdictが`trusted`で、identity digestが存在する。

validatorは`pr prepare`の前後でidentity digestを照合する。いずれかが欠ける場合はhookを
fail-closedにする。明示的push escapeはPR判断だけを省略できるが、runtime identity検証は
省略できない。

## Boundaries

- canonical launcher: `~/.local/bin/vibepro`
- shared validator: `.claude/scripts/hooks/lib/vibepro-runtime-contract.mjs`
- shell consumer: `.husky/pre-push`
- Claude Code consumer: `.claude/scripts/hooks/pre-tool-use/git-push-gate.ts`
- tests: `tests/unit/vibepro-runtime-hook-contract.test.js`

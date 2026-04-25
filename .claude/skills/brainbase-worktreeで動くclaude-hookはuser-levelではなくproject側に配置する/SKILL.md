---
name: brainbase-worktreeで動くclaude-hookはuser-levelではなくproject側に配置する
description: worktreeで動くClaude hookはuser-levelではなくproject側に配置する
---

# brainbase-worktreeで動くclaude-hookはuser-levelではなくproject側に配置する

## Trigger
- Use when this pattern appears: worktreeで動くClaude hookはuser-levelではなくproject側に配置する

## Steps
- 1. hook本体を`/Users/ksato/workspace/code/brainbase/.claude/scripts/hooks/<event>/`に配置
- 2. 既存worktreeで即時利用する場合は`/Volumes/UNSON-DRIVE/brainbase-worktrees/session-*-brainbase/.claude/scripts/hooks/<event>/`にもコピー
- 3. `~/.claude/settings.json`のcommandは`npx tsx .claude/scripts/hooks/<event>/<file>.ts`のままにする
- 4. `launchctl`やStop hookの実行前に、現在のworktreeからその相対パスが解決できるか確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/worktreeで動くclaude-hookはuser-levelではなくproject側に配置する

## Source
- Promoted from explicit_learn / success
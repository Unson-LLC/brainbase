---
name: brainbase-x-twitter投稿の調査はwebfetchやnitterではなくx-research-ski
description: X/Twitter投稿の調査はWebFetchやnitterではなくx-research-skillのCLIを最初に使う
---

# brainbase-x-twitter投稿の調査はwebfetchやnitterではなくx-research-ski

## Trigger
- Use when this pattern appears: X/Twitter投稿の調査はWebFetchやnitterではなくx-research-skillのCLIを最初に使う

## Steps
- cd /Users/ksato/.claude/skills/x-research-skill
- source ~/.config/env/global.env
- bun run x-search.ts tweet <tweet_id> --json
- bun run x-search.ts thread <tweet_id>
- bun run x-search.ts profile <username> --count 10
- 必要なら投稿内URLをWebFetchで深掘りする

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/x-twitter投稿の調査はwebfetchやnitterではなくx-research-ski

## Source
- Promoted from explicit_learn / success
---
name: brainbase-vibeproのstory-htmlはmarkdownと別経路で古いdiagnostics-ru
description: VibeProのStory HTMLはMarkdownと別経路で古いdiagnostics runを参照しうる
---

# brainbase-vibeproのstory-htmlはmarkdownと別経路で古いdiagnostics-ru

## Trigger
- Use when this pattern appears: VibeProのStory HTMLはMarkdownと別経路で古いdiagnostics runを参照しうる

## Steps
- fixture repoで複数runを作る
- vibepro diagnose . --run-id old-run
- vibepro diagnose . --run-id latest-run
- vibepro story report . --id <story-id>
- 生成されたindex.htmlの全hrefを抽出
- HTMLファイル所在地を基準にpath.resolveしてexists確認
- summary.md / risk-register.md / evidence.json等がlatest-run側を指すことをassert

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/vibeproのstory-htmlはmarkdownと別経路で古いdiagnostics-ru

## Source
- Promoted from explicit_learn / success
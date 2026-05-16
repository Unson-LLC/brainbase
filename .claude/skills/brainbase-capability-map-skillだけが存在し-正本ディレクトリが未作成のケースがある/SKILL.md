---
name: brainbase-capability-map-skillだけが存在し-正本ディレクトリが未作成のケースがある
description: capability-map Skillだけが存在し、正本ディレクトリが未作成のケースがある
---

# brainbase-capability-map-skillだけが存在し-正本ディレクトリが未作成のケースがある

## Trigger
- Use when this pattern appears: capability-map Skillだけが存在し、正本ディレクトリが未作成のケースがある

## Steps
- 1. `.claude/skills/brainbase-capability-map/SKILL.md` を読む
- 2. `ls docs/brainbase-capabilities/` で正本ディレクトリを確認
- 3. なければ `README.md`, `capabilities/`, `runbooks/`, `troubleshooting/` を先に作る
- 4. 個別能力は `docs/brainbase-capabilities/capabilities/<capability>.yml` に追加する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/capability-map-skillだけが存在し-正本ディレクトリが未作成のケースがある

## Source
- Promoted from explicit_learn / success
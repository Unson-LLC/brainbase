---
name: brainbase-gog-drive-downloadは-oではなく-outを使う
description: gog drive downloadは-oではなく--outを使う
---

# brainbase-gog-drive-downloadは-oではなく-outを使う

## Trigger
- Use when this pattern appears: gog drive downloadは-oではなく--outを使う

## Steps
- gog drive download --help
- # 正しい例
- gog drive download <fileId> --account <email> --out /tmp/example.pdf

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/gog-drive-downloadは-oではなく-outを使う

## Source
- Promoted from explicit_learn / success
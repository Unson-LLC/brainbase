---
name: brainbase-gog-driveはlsを使い-非対話削除は-forceが必要
description: gog driveはlsを使い、非対話削除は--forceが必要
---

# brainbase-gog-driveはlsを使い-非対話削除は-forceが必要

## Trigger
- Use when this pattern appears: gog driveはlsを使い、非対話削除は--forceが必要

## Steps
- gog drive ls --account info@unson.jp --parent <folder_id>
- gog drive delete --force --account info@unson.jp <file_id>

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/gog-driveはlsを使い-非対話削除は-forceが必要

## Source
- Promoted from explicit_learn / success
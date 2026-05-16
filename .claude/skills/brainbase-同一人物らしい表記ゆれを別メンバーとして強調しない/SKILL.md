---
name: brainbase-同一人物らしい表記ゆれを別メンバーとして強調しない
description: 同一人物らしい表記ゆれを別メンバーとして強調しない
---

# brainbase-同一人物らしい表記ゆれを別メンバーとして強調しない

## Trigger
- Use when this pattern appears: 同一人物らしい表記ゆれを別メンバーとして強調しない

## Steps
- 例: `金田 光平` と `金田光平` を別行で強調する前に照合する
- 1. 空白・敬称・全半角を正規化
- 2. Graph SSOTまたは入力内の担当情報で同一人物か確認
- 3. 同一なら合算、未確定なら「同一人物の可能性あり」として扱う

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/同一人物らしい表記ゆれを別メンバーとして強調しない

## Source
- Promoted from explicit_learn / success
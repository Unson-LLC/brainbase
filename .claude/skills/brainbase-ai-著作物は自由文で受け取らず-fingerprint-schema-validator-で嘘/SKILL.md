---
name: brainbase-ai-著作物は自由文で受け取らず-fingerprint-schema-validator-で嘘
description: AI 著作物は自由文で受け取らず、fingerprint + schema + validator で嘘を弾く
---

# brainbase-ai-著作物は自由文で受け取らず-fingerprint-schema-validator-で嘘

## Trigger
- Use when this pattern appears: AI 著作物は自由文で受け取らず、fingerprint + schema + validator で嘘を弾く

## Steps
- 1. `vibepro report fingerprint --kind pr-body --include-instructions` のように、AI が参照してよい事実だけを JSON 化する
- 2. AI の出力範囲を `summary`, `review_focus`, `risks_synthesis`, `open_questions` などの slot に限定する
- 3. `vibepro report write --from-stdin` で schema、参照 ID、数値 claim を検証する
- 4. 固定 skeleton に検証済み narrative だけを差し込む

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/ai-著作物は自由文で受け取らず-fingerprint-schema-validator-で嘘

## Source
- Promoted from explicit_learn / success
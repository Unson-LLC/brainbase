---
name: brainbase-vibepro-の-spec-は人間が手書きする契約書ではなく-ai-が整合性検査に使う内部表現
description: VibePro の Spec は人間が手書きする契約書ではなく、AI が整合性検査に使う内部表現にする
---

# brainbase-vibepro-の-spec-は人間が手書きする契約書ではなく-ai-が整合性検査に使う内部表現

## Trigger
- Use when this pattern appears: VibePro の Spec は人間が手書きする契約書ではなく、AI が整合性検査に使う内部表現にする

## Steps
- 1. `vibepro spec fingerprint --include-instructions` で Story+Code+Test の判断材料をまとめる
- 2. AI に fingerprint を読ませて `spec.json` を生成させる
- 3. `vibepro spec write --from-stdin --caller <agent>` で origin 実在・pattern 一致・clause id を検証する
- 4. `vibepro spec drift` で Code/Test/PR との不整合だけを人間に提示する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/vibepro-の-spec-は人間が手書きする契約書ではなく-ai-が整合性検査に使う内部表現

## Source
- Promoted from explicit_learn / success
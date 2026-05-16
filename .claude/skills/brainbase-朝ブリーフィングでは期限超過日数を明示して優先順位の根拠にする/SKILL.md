---
name: brainbase-朝ブリーフィングでは期限超過日数を明示して優先順位の根拠にする
description: 朝ブリーフィングでは期限超過日数を明示して優先順位の根拠にする
---

# brainbase-朝ブリーフィングでは期限超過日数を明示して優先順位の根拠にする

## Trigger
- Use when this pattern appears: 朝ブリーフィングでは期限超過日数を明示して優先順位の根拠にする

## Steps
- 1. 指定日を基準日にする
- 2. 各taskのdeadlineとの差分を日数で計算する
- 3. priority=高、期限超過が大きい、顧客影響がある、進行中で詰まりやすいものを上位化する
- 4. 推奨アクションは「午前中」「午後」「15時まで」など時間軸付きにする
- 5. NocoDBリンクはSlack mrkdwn形式 `<url|label>` で末尾に横並び表示する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/朝ブリーフィングでは期限超過日数を明示して優先順位の根拠にする

## Source
- Promoted from explicit_learn / success
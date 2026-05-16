---
name: brainbase-朝ブリーフィングでは期限超過タスクを-古さ・進行中・高優先度・顧客影響で順位付けする
description: 朝ブリーフィングでは期限超過タスクを、古さ・進行中・高優先度・顧客影響で順位付けする
---

# brainbase-朝ブリーフィングでは期限超過タスクを-古さ・進行中・高優先度・顧客影響で順位付けする

## Trigger
- Use when this pattern appears: 朝ブリーフィングでは期限超過タスクを、古さ・進行中・高優先度・顧客影響で順位付けする

## Steps
- 1. 今日の日付と各deadlineを比較し、期限超過日数を算出する
- 2. 進行中かつ最古の期限超過タスクを最優先候補にする
- 3. 同じ顧客・同じ障害領域の高優先度タスクは連続して並べ、まとめて着手できることを示す
- 4. 推奨アクションは午前・午後・夕方など時間帯付きで書く
- 5. NocoDBなど参照リンクは末尾にSlack mrkdwn形式で横並びにする

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/朝ブリーフィングでは期限超過タスクを-古さ・進行中・高優先度・顧客影響で順位付けする

## Source
- Promoted from explicit_learn / success
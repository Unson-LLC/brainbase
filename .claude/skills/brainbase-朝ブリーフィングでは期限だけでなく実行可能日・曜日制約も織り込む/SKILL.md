---
name: brainbase-朝ブリーフィングでは期限だけでなく実行可能日・曜日制約も織り込む
description: 朝ブリーフィングでは期限だけでなく実行可能日・曜日制約も織り込む
---

# brainbase-朝ブリーフィングでは期限だけでなく実行可能日・曜日制約も織り込む

## Trigger
- Use when this pattern appears: 朝ブリーフィングでは期限だけでなく実行可能日・曜日制約も織り込む

## Steps
- 1. ブリーフィング日付の曜日を確認する
- 2. タスクを「今日実行可能」「相手都合で次営業日実行」「期限超過」に分ける
- 3. 電話・対面確認は休日なら確認事項整理を今日の作業にする
- 4. 次営業日の具体時刻（例: 09:00）を推奨アクションに入れる

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/朝ブリーフィングでは期限だけでなく実行可能日・曜日制約も織り込む

## Source
- Promoted from explicit_learn / success
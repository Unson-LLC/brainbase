---
name: brainbase-ブリーフィング生成では-上位n件の可視リストだけで集計値を上書きしない
description: ブリーフィング生成では、上位N件の可視リストだけで集計値を上書きしない
---

# brainbase-ブリーフィング生成では-上位n件の可視リストだけで集計値を上書きしない

## Trigger
- Use when this pattern appears: ブリーフィング生成では、上位N件の可視リストだけで集計値を上書きしない

## Steps
- 1. 入力に集計値があるか確認する（例: 今日期限のタスクが9件）。
- 2. タスク一覧が全件か部分リストか確認する（例: 上位10件）。
- 3. 部分リストから数える場合は「上位10件内では4件確認」と書く。
- 4. 全体表現では明示集計を優先して「今日期限は9件」と扱う。

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/ブリーフィング生成では-上位n件の可視リストだけで集計値を上書きしない

## Source
- Promoted from explicit_learn / success
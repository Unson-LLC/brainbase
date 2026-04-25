---
name: brainbase-議事録検索で広域findを長時間回す前に-正本リポジトリとurl候補を優先する
description: 議事録検索で広域findを長時間回す前に、正本リポジトリとURL候補を優先する
---

# brainbase-議事録検索で広域findを長時間回す前に-正本リポジトリとurl候補を優先する

## Trigger
- Use when this pattern appears: 議事録検索で広域findを長時間回す前に、正本リポジトリとURL候補を優先する

## Steps
- 1. まず既知候補を確認: /Users/ksato/workspace/code/brainbase-project/meetings/transcripts/
- 2. 日付で絞る: ls /Users/ksato/workspace/code/brainbase-project/meetings/transcripts/ | rg '2026-04-24|大田原|Otawara|cursorvers'
- 3. GitHub URLが提示されたら、ローカル探索を続けずそのURLまたは対応ローカルファイルを読む
- 4. 広域検索する場合も find /Users/ksato/workspace ... に限定し、タイムボックスを置く

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/議事録検索で広域findを長時間回す前に-正本リポジトリとurl候補を優先する

## Source
- Promoted from explicit_learn / success
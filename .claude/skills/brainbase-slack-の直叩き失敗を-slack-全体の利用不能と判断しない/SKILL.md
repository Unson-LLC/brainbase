---
name: brainbase-slack-の直叩き失敗を-slack-全体の利用不能と判断しない
description: Slack の直叩き失敗を Slack 全体の利用不能と判断しない
---

# brainbase-slack-の直叩き失敗を-slack-全体の利用不能と判断しない

## Trigger
- Use when this pattern appears: Slack の直叩き失敗を Slack 全体の利用不能と判断しない

## Steps
- 1. Slack 直叩きが失敗したら「投稿 API 直叩き失敗」とだけ記録する
- 2. Slack MCP の conversations_history / search で対象 channel の直近投稿を確認する
- 3. 投稿元 bot / workflow / webhook の既存経路を特定する
- 4. 既存経路がある場合は独自 NocoDB incident 等を追加しない

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/slack-の直叩き失敗を-slack-全体の利用不能と判断しない

## Source
- Promoted from explicit_learn / success
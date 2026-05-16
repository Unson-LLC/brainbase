---
name: brainbase-x-twitter投稿取得でwebfetchが402になる場合はoembed-apiを試す
description: X/Twitter投稿取得でWebFetchが402になる場合はoEmbed APIを試す
---

# brainbase-x-twitter投稿取得でwebfetchが402になる場合はoembed-apiを試す

## Trigger
- Use when this pattern appears: X/Twitter投稿取得でWebFetchが402になる場合はoEmbed APIを試す

## Steps
- curl -s "https://publish.twitter.com/oembed?url=<x_status_url>&omit_script=true" | jq
- html内のblockquoteから本文・author_name・投稿日時を読む
- 画像やスレッド全文が必要な場合は別ソースで追加確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/x-twitter投稿取得でwebfetchが402になる場合はoembed-apiを試す

## Source
- Promoted from explicit_learn / success
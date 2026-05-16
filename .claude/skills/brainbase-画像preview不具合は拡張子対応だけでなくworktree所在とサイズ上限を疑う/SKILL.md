---
name: brainbase-画像preview不具合は拡張子対応だけでなくworktree所在とサイズ上限を疑う
description: 画像preview不具合は拡張子対応だけでなくworktree所在とサイズ上限を疑う
---

# brainbase-画像preview不具合は拡張子対応だけでなくworktree所在とサイズ上限を疑う

## Trigger
- Use when this pattern appears: 画像preview不具合は拡張子対応だけでなくworktree所在とサイズ上限を疑う

## Steps
- 1. ユーザーが見ているsession/worktreeと、画像を置いたworktreeが一致しているか確認
- 2. _inbox/<purpose>/ 配下にコピーして相対パスで開く
- 3. 413が出る場合は画像サイズを確認
- 4. 512KB前後を超える画像は圧縮するか、画像用上限をMAX_TEXT_READ_SIZEと分離する
- 5. HTML経由で見える場合と直接previewの経路差も確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- decisions/画像preview不具合は拡張子対応だけでなくworktree所在とサイズ上限を疑う

## Source
- Promoted from explicit_learn / success
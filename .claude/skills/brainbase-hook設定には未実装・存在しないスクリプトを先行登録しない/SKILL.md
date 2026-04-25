---
name: brainbase-hook設定には未実装・存在しないスクリプトを先行登録しない
description: hook設定には未実装・存在しないスクリプトを先行登録しない
---

# brainbase-hook設定には未実装・存在しないスクリプトを先行登録しない

## Trigger
- Use when this pattern appears: hook設定には未実装・存在しないスクリプトを先行登録しない

## Steps
- 1. settings.json内のhook commandから .ts パスを抽出する
- 2. 各ファイルが存在するか確認する
- 3. npx tsx <hook-file> を最小入力で単体実行して起動エラーがないか見る
- 4. 未実装hookはsettingsから外し、実装時に復活させる
- 5. 最後にsettings.jsonをJSON.parseして構文確認する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/hook設定には未実装・存在しないスクリプトを先行登録しない

## Source
- Promoted from explicit_learn / success
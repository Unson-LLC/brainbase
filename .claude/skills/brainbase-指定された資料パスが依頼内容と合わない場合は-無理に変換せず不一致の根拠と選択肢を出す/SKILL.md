---
name: brainbase-指定された資料パスが依頼内容と合わない場合は-無理に変換せず不一致の根拠と選択肢を出す
description: 指定された資料パスが依頼内容と合わない場合は、無理に変換せず不一致の根拠と選択肢を出す
---

# brainbase-指定された資料パスが依頼内容と合わない場合は-無理に変換せず不一致の根拠と選択肢を出す

## Trigger
- Use when this pattern appears: 指定された資料パスが依頼内容と合わない場合は、無理に変換せず不一致の根拠と選択肢を出す

## Steps
- 1. 共有パス配下の代表ファイル名と内容を確認する
- 2. 当初依頼の対象と一致するか判定する
- 3. 不一致なら「別物に見える」と明示する
- 4. 正しい資料パスの提示、意図変更、見立て整理などの選択肢を提示する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- stories/指定された資料パスが依頼内容と合わない場合は-無理に変換せず不一致の根拠と選択肢を出す

## Source
- Promoted from explicit_learn / success
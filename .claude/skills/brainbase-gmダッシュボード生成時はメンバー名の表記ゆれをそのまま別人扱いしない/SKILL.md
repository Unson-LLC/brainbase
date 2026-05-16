---
name: brainbase-gmダッシュボード生成時はメンバー名の表記ゆれをそのまま別人扱いしない
description: GMダッシュボード生成時はメンバー名の表記ゆれをそのまま別人扱いしない
---

# brainbase-gmダッシュボード生成時はメンバー名の表記ゆれをそのまま別人扱いしない

## Trigger
- Use when this pattern appears: GMダッシュボード生成時はメンバー名の表記ゆれをそのまま別人扱いしない

## Steps
- 1. メンバー一覧を生成する前に name を正規化候補でグルーピングする
- 2. 例: `卯田` / `卯田剛史` / `卯田 剛史` は同一人物候補として扱う
- 3. 同一人物と確定できない場合は、ダッシュボード上で重複候補としてGM確認事項に出す
- 4. 期限超過数やWork中タスクを合算する場合は、確定済みの同一人物だけに限定する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/gmダッシュボード生成時はメンバー名の表記ゆれをそのまま別人扱いしない

## Source
- Promoted from explicit_learn / success
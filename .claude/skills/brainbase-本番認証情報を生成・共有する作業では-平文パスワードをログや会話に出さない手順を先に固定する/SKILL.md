---
name: brainbase-本番認証情報を生成・共有する作業では-平文パスワードをログや会話に出さない手順を先に固定する
description: 本番認証情報を生成・共有する作業では、平文パスワードをログや会話に出さない手順を先に固定する
---

# brainbase-本番認証情報を生成・共有する作業では-平文パスワードをログや会話に出さない手順を先に固定する

## Trigger
- Use when this pattern appears: 本番認証情報を生成・共有する作業では、平文パスワードをログや会話に出さない手順を先に固定する

## Steps
- 1. 生成結果はstdoutに出さず、SSM SecureStringまたは一時ファイルへ直接保存
- 2. CSV作成時は必要最小限のカラムにし、パスワード入りの場合は作成直後に暗号化ZIP化
- 3. ZIPパスワードは添付メールとは別経路で共有
- 4. 送信後に `/tmp/...` の平文CSV、本文、ZIP、作成スクリプトを削除
- 5. 最終報告にはmessage_id、SSMパス、削除済み事実だけを記載し、平文秘密値は載せない

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/本番認証情報を生成・共有する作業では-平文パスワードをログや会話に出さない手順を先に固定する

## Source
- Promoted from explicit_learn / success
---
name: brainbase-診断用id-pwログインはdb作成だけでは不十分で-ビルド時許可リストへの追加と本番デプロイが必
description: 診断用ID/PWログインはDB作成だけでは不十分で、ビルド時許可リストへの追加と本番デプロイが必要
---

# brainbase-診断用id-pwログインはdb作成だけでは不十分で-ビルド時許可リストへの追加と本番デプロイが必

## Trigger
- Use when this pattern appears: 診断用ID/PWログインはDB作成だけでは不十分で、ビルド時許可リストへの追加と本番デプロイが必要

## Steps
- 1. 本番DBに `authProvider: credentials`, `role`, `status: ACTIVE`, bcrypt済みpasswordでUserを作成
- 2. 平文パスワードはSSM SecureStringに保存
- 3. `.github/workflows/deploy-production.yml` の `NEXT_PUBLIC_DEV_AUTH_EMAILS` に対象メールを追記
- 4. PRを作成し、本番デプロイ後にログイン可能になることを確認
- 5. 診断終了後は許可リスト削除、アカウント無効化、SSMパラメータ削除を実施

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/診断用id-pwログインはdb作成だけでは不十分で-ビルド時許可リストへの追加と本番デプロイが必

## Source
- Promoted from explicit_learn / success
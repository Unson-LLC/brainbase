---
name: brainbase-vercel失敗メールはgit連携とgithub-actionsの二重deployで発生し得る
description: Vercel失敗メールはGit連携とGitHub Actionsの二重deployで発生し得る
---

# brainbase-vercel失敗メールはgit連携とgithub-actionsの二重deployで発生し得る

## Trigger
- Use when this pattern appears: Vercel失敗メールはGit連携とGitHub Actionsの二重deployで発生し得る

## Steps
- 1. Gmailで `from:notifications@vercel.com` を検索し、失敗メールのdeployment/project/branchを特定する
- 2. `vercel ls <project> --scope <team>` と `vercel inspect <deployment-url> --scope <team>` で失敗deployが0ms/即失敗か確認する
- 3. GitHub Actionsで同じpushに対する `vercel deploy` が成功していないか確認する
- 4. 二重deployなら Vercel Dashboard の Project Settings > Git で自動deployを止める、または `vercel.json` に `{ "git": { "deploymentEnabled": { "develop": false, "*": false } } }` を追加する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/vercel失敗メールはgit連携とgithub-actionsの二重deployで発生し得る

## Source
- Promoted from explicit_learn / success
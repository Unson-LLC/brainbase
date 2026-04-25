---
name: brainbase-修正前に開発サーバーが実際に読んでいるソースディレクトリを確認する
description: 修正前に開発サーバーが実際に読んでいるソースディレクトリを確認する
---

# brainbase-修正前に開発サーバーが実際に読んでいるソースディレクトリを確認する

## Trigger
- Use when this pattern appears: 修正前に開発サーバーが実際に読んでいるソースディレクトリを確認する

## Steps
- 1. 起動中プロセスのcwdを確認する: lsof -i :<port> などでPIDを特定し、pwdx相当またはps情報を確認
- 2. ブラウザが叩いているportとdev serverの起動ディレクトリを照合する
- 3. worktreeではなくL2が配信元なら、実際の配信元にも同じ修正を反映する
- 4. E2Eは配信元が修正済みであることを確認してから実行する

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- spikes/修正前に開発サーバーが実際に読んでいるソースディレクトリを確認する

## Source
- Promoted from explicit_learn / success
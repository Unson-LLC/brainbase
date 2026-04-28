# Infisical Slack Announcement

Last updated: 2026-04-28

投稿先候補: `#0000-unson-member`

```text
みなさん、Infisicalの招待メールを送りました。

今後、環境変数・API key・tokenなどのsecretは、原則としてInfisicalで管理します。

URL:
https://infisical.unson.jp

まずお願いしたいこと:
1. 招待メールからアカウントを作成してください
2. ログイン後、自分の担当Projectが見えるか確認してください
3. Projectが見えない / 招待が届いていない / 使い方が分からない場合は、このスレッドで知らせてください

運用の考え方:
- .envは正本ではなく、Infisicalを正本にします
- secret値をSlack、GitHub、Notion、AIチャットに貼らないでください
- 必要なProjectだけ見えるようにしています
- 本番secretは最小人数で扱います

使い方とルールはこちらにまとめています:
docs/guides/infisical-member-onboarding.md

Claude Code / Codexに渡すプロンプト例も追記しています。

secret値そのものは、このスレッドにも貼らないでください。
必要な場合は「Project / Environment / Path / Key名 / 目的」だけを書いてください。
```

## Follow-Up Thread Template

```text
確認用テンプレです。

ログインできた / できない:
見えるProject:
見えないが必要なProject:
困っていること:

secret値やtokenは貼らないでください。
```

# Cloudflare Pages

このマニュアルはVitePressで生成し、Cloudflare Pagesへ静的サイトとして公開できます。

## build

```bash
npm run docs:build
```

出力先:

```text
docs/.vitepress/dist
```

## deploy

Cloudflare CLIで現在の認証状態を確認します。

```bash
npx --yes wrangler@latest whoami
npx --yes wrangler@latest pages project list
```

公開する場合:

```bash
npx --yes wrangler@latest pages deploy docs/.vitepress/dist \
  --project-name brainbase \
  --branch develop \
  --commit-dirty=true
```

Cloudflare Pagesは公開先の1つです。Brainbaseの概念やMCPの使い方は、Cloudflareに依存しません。

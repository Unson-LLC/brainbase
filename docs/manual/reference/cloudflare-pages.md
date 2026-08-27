# Cloudflare Pagesと公開経路

このマニュアルはVitePressで生成し、Cloudflare Pagesへ公開します。Cloudflare Pagesは配信先であり、Brainbaseの概念や正本ではありません。

## 自動公開

`.github/workflows/docs-cloudflare-pages.yml`は次の処理を行います。

### Pull request

1. `npm ci`
2. TypeScript build
3. public-message同期確認
4. 公開docsの契約確認
5. VitePress build
6. build済みHTMLのsmoke test
7. 関連unit test

pull requestからはdeployしません。

### developへmerge後

上記の検証に加えて、`docs/.vitepress/dist`をCloudflare Pages project `brainbase`へdeployします。その後、公開URLをreadbackし、次を確認します。

- 「会社の判断を、属人化させない。」が表示される
- システム構成ページと構成図が取得できる
- オントロジーページと概念図が取得できる
- 状態ページとMCP referenceが取得できる
- 配信HTMLにmerge commitの短縮SHAが含まれる

## GitHub Secrets

repositoryまたはorganizationへ次のActions secretが必要です。

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

API tokenには対象accountのCloudflare Pages Edit権限だけを与えます。secretがない状態をdeploy成功として扱いません。

## ローカルbuild

```bash
npm ci
npm run docs:check
npm run docs:build
npm run docs:smoke
```

出力先は次です。

```text
docs/.vitepress/dist
```

## 手動deploy

自動workflowの障害調査に限り、現在の認証状態とprojectを確認します。

```bash
npx --yes wrangler@latest whoami
npx --yes wrangler@latest pages project list
```

検証済みのbuildだけを公開します。

```bash
npx --yes wrangler@latest pages deploy docs/.vitepress/dist \
  --project-name brainbase \
  --branch develop \
  --commit-dirty=true
```

手動deployは恒常運用へ戻しません。原因を修正し、同じcommitをCI経路で再deployします。

## Build SHA

VitePress configは、build時の`CF_PAGES_COMMIT_SHA`または`GITHUB_SHA`を各ページ下部へ表示します。

```text
Build <12文字のSHA> · <branch>
```

「GitHubは新しいが公開siteは古い」という状態を、画面だけで検出できます。

## Brainbase Graphから公開説明を昇格する

Graphを直接Webへ表示しません。

```text
GraphのPhilosophy / Decision
  -> entity id / version / snapshot hash
  -> 人間が公開copyを承認
  -> candidate JSON
  -> dry-run plan
  -> GitHub PR
  -> CI
  -> merge
  -> Cloudflare Pages
  -> readback
```

candidate schemaは`contracts/public-message-candidate.schema.json`です。

ローカルで確認する場合:

```bash
npm run docs:promotion:plan -- --candidate /path/to/candidate.json
npm run docs:promotion:apply -- --candidate /path/to/candidate.json
npm run docs:check
```

自動PRを作る場合は`.github/workflows/public-message-promotion.yml`を使います。

workflow input:

- `candidate_id`
- candidate JSONをbase64化した`candidate_json_base64`

外部runtimeからは`repository_dispatch` type `brainbase-public-message-candidate`も使用できます。

このworkflowは検証・生成・test・PR作成までを行います。直接mergeまたはdeployしません。最終的な公開判断はPR reviewで人間が行います。

## 正本の境界

- Brainbase Graph: Philosophy / Decisionの組織内正本
- `docs/publication/public-message.json`: 公開承認済みのGitHub投影
- README / manual / package description: 生成された用途別view
- Cloudflare Pages: 配信artifact

公開viewの一部だけを手修正すると`npm run docs:check`が失敗します。

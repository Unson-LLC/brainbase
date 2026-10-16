# npm公開を NPM_TOKEN から Trusted Publishing（OIDC）へ切り替える

## Problem Frame

2026-10-16 に 0.41.12・0.41.13 の公開が `PUT https://registry.npmjs.org/@unson%2fbrainbase-mcp` の E404 で止まった（run 38880799295、38917273140）。provenance の署名と透明性ログへの記録は成功しており、拒否されたのは公開の書き込みだけだった。publish job は `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`（8/17 登録）で認証しており、トークンの失効か権限切れが疑われる。同じ run で npm は「2FA を迂回するトークンは直接の公開を制限される」と告知している（GitHub changelog 2026-07-31。直接の公開は 2027年1月に外す予定）。トークンを入れ替えても、いずれまた止まる。

## Constraints

- 公開の書き込みは `npm-publish.yml` の直列化された publish job の中だけで行う。手元からの `npm publish` はしない。
- validate job（self-hosted、`contents: read`）、immutable commit、validation proof、artifact の受け渡し、npm と GitHub Release の読み返しは変えない。
- npm Trusted Publishing の要件（docs.npmjs.com/trusted-publishers、2026-10-17 確認）:
  - npm CLI 11.5.1 以上、Node 22.14.0 以上。OIDC での dist-tag 操作は npm CLI 11.21.0 以上。
  - job に `id-token: write`。GitHub-hosted runner だけ（self-hosted は不可）。
  - `package.json` の `repository.url` が GitHub の repo と一致する。
  - npmjs.com 側で Trusted Publisher を登録し、許可する操作（`npm publish`、npm dist-tag）を選ぶ。dist-tag は既定で許可されない。
- `scripts/npm-release.mjs` は staging tag `release-<sha12>` で公開したあと `npm dist-tag add` で正規の dist-tag を進め、`npm dist-tag rm` で staging tag を消す。dist-tag 操作も OIDC で通る必要がある。

## Options

1. **採用:** publish job から `NODE_AUTH_TOKEN` と setup-node の `registry-url` を外し、npm CLI を 11.21.1 に固定する。認証は npm CLI の OIDC 交換だけにする。
2. `NPM_TOKEN` を残して併用する。npm CLI（11.21.1 の `lib/utils/oidc.js`）は OIDC 交換に成功するとトークンを上書きし、失敗すると何も言わずに既存のトークンへ戻る。壊れたトークンを残すと、登録漏れが今回と同じ E404 に見えて原因が隠れるので採らない。
3. `NPM_TOKEN` を入れ替える。2027年1月に再び止まり、長期の秘密情報も残るので採らない。

## Acceptance Criteria

- AC-1: workflow に `NODE_AUTH_TOKEN`、`secrets.NPM_TOKEN`、`registry-url:` がない。
- AC-2: publish job だけが `id-token: write` を持ち、`ubuntu-latest` で動き、`npm install --global npm@11.21.1` を実行し、`--provenance` を渡す。
- AC-3: `tests/npm-release-workflow.test.ts`、`tests/github-actions-runner-policy.test.ts`、OIDC endpoint の受け入れ試験が上の形を確かめる。
- AC-4: npmjs.com の Trusted Publisher 登録が済むまで、このPRはマージしない。マージ後に 0.41.13 の公開をやり直し、npm の `gitHead`、`dist.integrity`、`latest`、provenance、GitHub Release を照合する。

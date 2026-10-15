# npm公開ジョブに id-token: write を戻し、provenance なしで OIDC ガードを通す

## Problem Frame

#793（develop 54639152）で npm 公開から `--provenance` と `id-token: write` を外した。しかし `scripts/npm-release.mjs` の `assertSerializedPublicationContext()` は npm publish の前に `ACTIONS_ID_TOKEN_REQUEST_URL` / `ACTIONS_ID_TOKEN_REQUEST_TOKEN` を要求し、OIDC トークン（audience `brainbase-npm-publish`、workflow_ref は develop の npm-publish.yml）を検証する。この2つの変数は `id-token: write` がないジョブには渡されないため、このままでは公開がガードで止まる。`tests/npm-release-workflow.test.ts` は YAML の文字列しか見ておらず、これを検出できなかった（Inspector S2）。

## Constraints

- provenance は使わない。npm は self-hosted runner での provenance を 422 で拒否する。佐藤さんの承認（2026-10-15 19:34、Worker のチャット）:「進めていい」。
- npm 11.5.1 は OIDC の変数があると provenance を自動で有効にしうるため、publish step で `NPM_CONFIG_PROVENANCE=false` を明示する。`--provenance` は付けない。
- runner は self-hosted のまま。`ubuntu-latest` などの GitHub-hosted ラベルは置かない。
- `id-token: write` は publish ジョブだけに付ける。トップレベル `permissions: {}`、validate の `contents: read` は変えない。
- immutable commit、validation proof、artifact の受け渡し、npm/GitHub Release の readback は変えない。

## Options

1. **採用:** publish ジョブにだけ `id-token: write` を戻し、publish step に `NPM_CONFIG_PROVENANCE: 'false'` を置く。ガードはそのまま使う。workflow が渡す環境変数で実際にガードを実行するテストを足す。
2. ガードから OIDC 検証を外す。公開を develop の serialized workflow に限定する保護が弱くなるので採らない。
3. 公開を止めたままにする。採らない。

## Acceptance Criteria

- AC-1: publish ジョブだけが `id-token: write` を持ち、publish step に `NPM_CONFIG_PROVENANCE: 'false'` があり、`--provenance` はない。
- AC-2: 両ジョブが `[self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]` で動き、`ubuntu-latest` がない。
- AC-3: `tests/npm-release-publish-guard.test.ts` が、workflow の publish step の環境変数とモックした OIDC で `assertSerializedPublicationContext()` を通し、OIDC 変数がないときは throw することを確かめる。
- AC-4: 失敗時 step summary に「published with provenance」がなく、step 名「Install trusted-publishing npm CLI」が残っていない。

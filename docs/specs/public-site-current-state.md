# 公開サイト現行化仕様

## 表示契約

1. heroは狭いデスクトップ幅でも本文と画像の専有幅を分離する。
2. モバイルでは本文を画像より先に表示する。
3. 日本語見出しは単語途中の不自然な改行を避ける。
4. homepageの主要CTAは2つとする。

## 現在地の契約

1. release見出しは`Released — v${package.json.version}`と一致する。
2. source、built HTML、公開readbackの検証は同じversion正本を参照する。
3. Organizationは、公開OSS、非公開で検証中の組織版、未完成の範囲を混同しない。

## Verification

- source contract: `npm run docs:check`
- generated HTML: `npm run docs:build && npm run docs:smoke`
- visual: homepageを390pxと972px以上、Organizationを390pxと972px以上で確認する

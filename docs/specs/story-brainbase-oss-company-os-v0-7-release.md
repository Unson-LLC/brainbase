# Brainbase OSS Company OS v0.7.0 配布候補 Spec

## 目的

現在の`develop`には、Company OSの目的・世界モデル・制約・判断問題・評価・学習採用と、その参照・実行境界を表す公開subpathが0.6.0公開後に追加されている。このSpecは、それらを`@unson/brainbase-mcp@0.7.0`の配布候補として固定し、既存利用者の0.6.0契約を壊さないことを検証する。

## 互換性判断

0.7.0は0.6.xからのminor bumpとする。npm registryから取得した0.6.0の`package.json`の`exports`を基準に、既存exportがすべて現行manifestに残り、既存の参照先が変わっていないことを確認する。現行HEADのCompany OS exportは追加分として扱う。既存exportの削除、参照先の変更、package名の変更が見つかった場合は、version bumpを成立させず親へ報告する。

## 配布契約

- root package名は`@unson/brainbase-mcp`に固定する。
- `package.json`、`package-lock.json`のroot package versionは`0.7.0`で一致する。
- `npm run build`後、manifestの公開subpathが対応する型定義とESM実装を解決できる。
- `npm pack --dry-run`で`dist`、`contracts`、`ui`、README、LICENSE、SECURITYを含む配布内容を確認できる。
- version bumpはこの候補PRの変更として保持し、release CLIがpackage manifestを自動変更しない。

## 検証マトリクス

| 契約 | 検証 | 成功条件 |
| --- | --- | --- |
| version整合 | `node`でpackageとlockのroot versionを読む | すべて`0.7.0` |
| 0.6.0互換 | npmの0.6.0 manifestと現行`exports`を比較 | 既存keyの削除・参照先変更が0件 |
| TypeScript成果物 | `npm run build` | 成功し、公開subpathのJS/DTSが生成される |
| Company OS回帰 | affected testsを実行 | 対象テストが成功する |
| consumer境界 | `npm run test:consumer-smoke` | fresh package形態の公開importが成功する |
| 公開文書 | `npm run docs:check` | package versionと状態・履歴の参照が整合する |
| tarball内容 | `npm pack --dry-run` | 公開対象のmanifest・成果物が確認できる |

## 境界と未確認

このSpecはローカルの配布候補とその検証までを扱う。npm publish、dist-tag変更、GitHub Release、PR作成・merge、GitHub Actionsの成功、npm registryの`gitHead`・integrity・fresh install、Organization版・Mana側の本番接続は、この作業では確認済みとしない。公開後は既存の`story-brainbase-oss-npm-release`のCLI/Actions契約に従って、同一tarballのregistry readbackを行う。

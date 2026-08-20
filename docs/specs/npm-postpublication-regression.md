# 公開後の通常回帰 Spec

## 不変条件

1. 通常回帰は `tests/npm-prepublication-evidence.integration.test.ts` を実行しない。
2. `test:integration:release-evidence` は同テストを必ず実行対象に含む。
3. 公開前専用スクリプトの検査内容を変更しない。

## シナリオ

- 公開済みversionで `npm test` を実行すると、公開前専用検査以外の全テストを実行できる。
- 公開前専用コマンドを実行すると、公開済みversionはregistry不存在を証明できず失敗する。
- dirty HEADで公開前専用コマンドを実行すると、clean HEAD要件を満たせず失敗する。

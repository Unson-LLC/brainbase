# 公開後の通常回帰 Spec

## 不変条件

1. 通常回帰は `tests/npm-prepublication-evidence.integration.test.ts` を実行しない。
2. `test:integration:release-evidence` は同テストを必ず実行対象に含む。
3. 公開前専用スクリプトの検査内容を変更しない。
4. registry 未公開確認の適用範囲は `release:plan` と同じ版比較で決める。`BRAINBASE_RELEASE_EVIDENCE_BASE` がない場合と `release_required=true` の場合は必須とし、`release_required=false` の場合だけ HEAD 結合テストを skip して N/A とする。registry の状態で適用範囲を決めない。

## シナリオ

- 公開済みversionで `npm test` を実行すると、公開前専用検査以外の全テストを実行できる。
- base を渡さずに公開前専用コマンドを実行すると、公開済みversionはregistry不存在を証明できず失敗する。
- 版を上げる base を渡して公開前専用コマンドを実行すると、公開済みversionへの bump は失敗する。
- 版を上げない base を渡して公開前専用コマンドを実行すると、HEAD 結合テストは N/A（skip）となり、PASS として数えない。
- dirty HEADで公開前専用コマンドを実行すると、clean HEAD要件を満たせず失敗する。

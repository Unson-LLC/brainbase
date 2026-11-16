# 公開後の通常回帰 Spec

## 不変条件

1. 通常回帰は `tests/npm-prepublication-evidence.integration.test.ts` を実行しない。
2. `test:integration:release-evidence` は同テストを必ず実行対象に含む。
3. 公開前専用スクリプトの検査内容を変更しない。
4. registry 未公開確認の適用範囲は `planRelease` と同じ版比較で決め、registry の状態では決めない。`BRAINBASE_RELEASE_EVIDENCE_BASE` がない場合、base が HEAD と同じ commit の場合、base が HEAD の祖先でない場合、`release_required=true` の場合は必須とする。N/A は、base が HEAD と別の祖先 commit で `release_required=false` の場合だけとし、その場合も公開前専用スクリプトを HEAD で実行して、registry 段の失敗だけを N/A（skipped、PASS に数えない）にする。clean worktree・production audit・tarball 整合の失敗は N/A にしない。

## シナリオ

- 公開済みversionで `npm test` を実行すると、公開前専用検査以外の全テストを実行できる。
- base を渡さずに公開前専用コマンドを実行すると、公開済みversionはregistry不存在を証明できず失敗する。
- 版を上げる base を渡して公開前専用コマンドを実行すると、公開済みversionへの bump は失敗する。
- 版を上げない祖先 base を渡して公開前専用コマンドを実行すると、clean worktree・audit・tarball の検査は実行されて PASS し、registry 未公開確認だけが N/A（skipped）となり、PASS として数えない。
- HEAD 自身、HEAD と同じ commit、HEAD の祖先でない ref を base に渡すと、registry 未公開確認は必須のままとなる。
- 版を上げない base でも、dirty worktree・audit・tarball の失敗は FAIL のままとなる。
- dirty HEADで公開前専用コマンドを実行すると、clean HEAD要件を満たせず失敗する。

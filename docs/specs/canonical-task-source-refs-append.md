# Spec: Task参照の追記

親Story: [既存Taskの参照を保持して追加する](../stories/story-canonical-task-source-refs-append.md)
既存kernel: [Canonical Task service kernel](canonical-task-service-kernel.md)

## 入力と保存

`CanonicalTaskUpdateInput.source_refs_append`は任意のplain JSON object配列。未指定では従来の更新処理を使う。空配列は既存参照を削除しない。既存`source_refs`は置換更新の意味を維持し、同時指定は`validation_error`で拒否する。

JSON値はnull、文字列、boolean、有限数、plain object、密な配列に限定する。undefined、循環参照、accessor、symbol、非列挙プロパティ、不正な配列プロパティは拒否する。入力項目自身のgetterは呼び出さない。配列コンテナを深度0とし、128以上のobject/array深度は拒否する。

既存参照は順序、形状、重複を保持する。null/undefinedの既存値は空配列として扱い、その他の非配列値は変更前に拒否する。fingerprintを計算できないlegacy参照も保持するが、その参照については重複照合を保証しない。

## 追記と再送

追記の重複照合と追記updateのoperation fingerprintはobjectキーをUTF-16 code-unit順に整列する。配列の順序は保持する。既存のcreate、transition、delete、追記なしupdateのfingerprintは変更しない。

既存version付き更新境界内で最新Taskを読み、既存参照と追加参照を結合する。認証とscopeは注入policyへ委譲し、別writerや保存先を作らない。既存operation markerとexpected versionによる再送・競合処理を維持する。

## 検証と公開境界

`tests/canonical-task-service.test.ts`で追加・重複除去・Unicodeキー順の再送・既存参照保持・置換互換・入力拒否・stale versionを確認する。既存kernelのpolicy委譲とstore/audit契約を維持する。

正式PRではbuild、型検査、必要kernel契約とconsumer smokeを実行する。CIの実行環境は既存のrepository契約に従う。公開は既存レビュー済みdevelopのnpm-release経路に従う。version、gitHead、integrityを読み戻すまで公開済みと扱わない。

利用側HTTP/MCPの公開入力と依存更新、実Taskの認証付き保存・再取得は別の検証であり、この候補のテスト成功で代替しない。

# 共通 SSOT sidecar v1 Spec

## 目的

canonical SSOT の4ファイルと、その更新に付随する小さな補助ファイルを同じ transaction 境界で扱う。sidecar の追加・更新に失敗しても、読者がcanonicalとsidecarの混在した状態を観測しないことを保証する。

## 公開契約

`mutatePersonalOsWithSidecar(dataDir, sidecarPath, mutator)` は、lock取得後に回復済みの最新 `PersonalOs` と対象 sidecar の現在内容を渡す。sidecar が存在しない場合の現在内容は `undefined` とする。既存の1引数 callbackはそのまま利用できる。callbackの結果は従来どおり `{ next, sidecarContent, result }` とし、正本とsidecarを一つのmutationとしてcommitする。

`readPersonalOsSidecar(dataDir, sidecarPath)` は、通常のSSOT readerと同じlock・recovery・canonical完全性検証を経て対象sidecarを読む。未作成なら `undefined` を返し、path安全性検証やrecoveryエラーは省略しない。

## transaction と回復

- mutation開始時にcanonical 4ファイルの `previous/` を作る。
- sidecarが直前状態に存在したものだけを `previousSidecarFiles` に記録し、直前状態のsidecarを `previous/` に保存する。
- 新しいsidecarは `next/` に保存し、metadataの `sidecarFiles` に記録する。
- publication途中の失敗または次回access時の未commit transaction回復では、canonical 4ファイルを `previous/` から戻す。
- `previousSidecarFiles` に含まれるsidecarは直前内容へ戻し、それ以外の `sidecarFiles` は新規作成物として削除する。
- 旧metadataに `previousSidecarFiles` がない場合は従来metadataのfallbackを使い、既存transactionの読込形式を壊さない。
- `COMMITTED` 後のcleanup失敗は既存のSSOT契約に従い、commit済み状態を維持する。

sidecar pathはcanonical file、lock、staging、transaction管理領域との衝突を従来どおり拒否する。sidecar内容のdomain schemaや資源予約の意味はこの共通契約に含めない。

## 受入条件と実証

| 受入条件 | 実証 |
| --- | --- |
| AC-01 | `creates a new sidecar transactionally and exposes its previous content to the mutator` |
| AC-02 | `reads a missing or committed sidecar through the SSOT recovery boundary` |
| AC-03 | `rolls back a failed sidecar publication, removing a new sidecar` と canonical snapshot比較 |
| AC-04 | 同テスト内の既存sidecar更新失敗ケースで旧sidecar内容を比較 |

対象テストは `tests/ssot-atomic.test.ts`。ビルドは `npm run build` で確認し、リポジトリ全体のtest suiteはCIに委ねる。

# Spec: 問題のスナップショットのHTTP入口 v1

`createJudgmentProblemSnapshotHttpHandler(options)` は、ホストに組み込む経路のhandlerを返す。対象外のパスでは `false` を返す。

| 項目 | 内容 |
|---|---|
| `root` | スナップショットの保存先（必須） |
| `providerFactory(context)` | 文脈に束ねた `referenceProvider`（必須）と `accessProvider`（省略時は読み取り方針） |
| `basePath` | 既定 `/judgment-problem-snapshots` |
| `verifyMutationRequest` | `context.verifiedMutationOrigin` が無いホストで、POSTの出どころを確かめる |

| method | path | 振る舞い |
|---|---|---|
| POST | `{basePath}` | 本文 `{ "snapshot": … }` だけを受ける。保存して受領を返す（新規201、既存200） |
| GET | `{basePath}/{snapshot_id}` | `reference_resolution: current` で読み戻す |

エラーの対応：`invalid_request` 400、`missing_reference`・`not_applicable`・`unresolved_constraint` 422、`unauthorized` 403、`not_found` 404、`conflict`・`integrity_mismatch` 409、`storage_io_error` 503。そのほかは500。

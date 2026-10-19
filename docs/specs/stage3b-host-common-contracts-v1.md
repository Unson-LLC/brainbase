# 段3b 共通契約最小Spec

## 契約一覧

| export | 役割 | hostが差し込むもの |
| --- | --- | --- |
| `knowledge-event` | `knowledge_event.v1`の必須フィールド、canonical identity、fingerprint | tenant、actor、decision verification、candidate/Graph repository |
| `mesh` | envelope、node profile、query送信受付 | node identity、認証、暗号、WebSocket/relay、project path |
| `honcho` | Honcho v3 URL、workspace、request構築 | API secret、peer identity、fetch実行、保存 |
| `onboarding-runtime` | source、permission、candidate受領、first-value record | connector、個人identity、canonical write、promotion、scheduler |
| `mcp-runtime` | local stdio descriptor、tool call、receipt | MCP SDK server、認証、transport process、client configuration |

## 入力制約

- knowledge eventは `schema_version=knowledge_event.v1`、12必須フィールド、ISO timestamp、SHA-256 body hashを要求する。raw bodyとsecretはhostが保存前に排除する。
- meshは許可された6種類のtype、from/to/id/nonce、正のtimestampを要求する。送信受付receiptの `answer_status` は `unknown` 固定で、受信・回答・保存を成功扱いしない。
- Honcho URLは絶対HTTP(S) URLで、userinfo、query、hashを許可しない。secretはrequest本体に含めない。
- onboardingのpermission snapshotは許可キーだけを受け、source receiptのcontent hashは `sha256:<64 hex>`、first-value answer hashも同形式とする。
- local MCPはstdio/local/hostedDependency=falseを要求する。tool receiptの `verified` は必須booleanとする。

## 段階適用

Unson consumerは候補loaderを介してlocal packを実行時テストへ差し込む。現行公開版にsubpathがない間は、デフォルト経路を候補へ切り替えず、従来実装と同じhost portを使う。候補実装のlocal検証、npm publish、package versionのreadback、live cutoverは個別に記録する。

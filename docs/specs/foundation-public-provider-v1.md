---
spec_id: foundation-public-provider-v1
story_id: story-foundation-public-provider-v1
status: implementation
spec_maturity: implementation_ready
---

# 公開Foundation provider

共通の公開アダプターはFoundationRevisionStoreとJudgmentProblemReferenceProviderを使う。Organizationは認証・tenant scope・正本保存adapterを所有し、OSSは構造・参照・digest・判断利用条件を所有する。既存Ontology 1.0/2.0を書き換えず、Foundationを版付き拡張として公開する。

MCPの入力は参照と読取モードだけを受け付け、principal・tenant・ACLは受け付けない。Hostから注入したcontextがなければ未接続として失敗する。adapter未接続時の一覧は実装状況を明示し、存在しない型を実在するデータと表示しない。

検証: MCP経由の正常読取、未接続、余分な認証入力、digest不一致、依存参照欠落、現行ACL拒否。組織側のgatewayは同じ契約をconsumeする。

Graphifyはmissing_graphで影響未確認。コードの対象境界とテストで補う。

## 実際の接続点

- MCP Hostは`@unson/brainbase-mcp/server`の`createServer({ foundation: { provider, resolveContext } })`を使う。`resolveContext`は呼出しごとに現在の認証情報を解決する。
- HTTP Hostは`createFoundationHttpRouter`のroutesへ`createFoundationPublicRoute(provider)`を追加する。
- `GET /api/foundation/contract`、`GET /api/foundation/definitions/:type/:id?revision=...`、`POST /api/foundation/judgment-references/validate`、`POST /api/foundation/judgment-problems/validate`を提供する。
- 個別参照のresolvedは一式の判断開始承認ではない。一式の検証は`foundation_validate_problem`とHTTPのjudgment-problems/validateがsnapshot保存と同じ共通検証を実行する。観測の測定条件はHostの正本resolverの返却値を使い、入力の自己申告だけでは解決しない。実行許可は付与しない。

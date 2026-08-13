# Spec: Codex CallToolResult成功境界

- `content` は配列で、各要素が既知MCP content block型であること。
- search/retrieveのみcontent envelopeをtransport成功としてよい。未分類callは成功にしない。
- write/routeはそれぞれの構造化結果が必要。
- `Err`、`isError:true`、`ok:false`、`success:false`、error系statusは成功より優先する。
- null、空object、未知shapeは失敗または結果不明とする。

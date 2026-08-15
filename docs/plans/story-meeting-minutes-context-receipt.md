# 実装計画: 議事録文脈Receipt

1. Receipt契約とidentity/checksum/size limitを失敗テストで固定する。
2. 既存`InfoSSOTService.getContext`とCanonical Task検索を束ねるresolverを追加する。
3. Receipt repositoryと認証済み作成・取得APIを追加する。
4. 専用MCPツールを追加し、identity一致と監査可能な出力を固定する。
5. API、MCP、Judgment Hookの結合テストと全回帰を実行する。
6. Brainbaseを先に配備して本番readbackを取る。

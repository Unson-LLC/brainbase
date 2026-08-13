# Story: Codex MCP標準応答を正しく監査する

CodexのPostToolUseが渡す標準CallToolResultを、検索・取得では正常な呼び出しとして記録したい。書き込みやrouteは構造化された業務成功を必須とし、本文中の成功風JSONでは成功にしない。

## 受け入れ条件

- 検索・取得の妥当なcontent-only CallToolResultは正常応答になる。
- 明示エラーは全種類で失敗を優先する。
- 書き込みとrouteはtool固有の構造化成功がない限り成功にならない。
- 新規Codexタスクの実journalで検索・取得がsuccess=trueになる。

# Story: Codex MCP標準応答を正しく監査する

CodexのPostToolUseが渡す標準CallToolResultを、検索・取得では正常な呼び出しとして記録したい。書き込みやrouteは構造化された業務成功を必須とし、本文中の成功風JSONでは成功にしない。

## 受け入れ条件

- 検索・取得の妥当なcontent-only CallToolResultは正常応答になる。
- 明示エラーは全種類で失敗を優先する。
- 書き込みとrouteはtool固有の構造化成功がない限り成功にならない。
- 新規Codexタスクの実journalで検索・取得がsuccess=trueになる。

## リリース条件

- PRマージ後に正規checkoutを`origin/develop`へ同期する。
- 同期後に新規Codexタスクを作成し、実際のBrainbase検索・取得を行う。
- そのepisode journalで対象イベントが`success: true`と記録されることを確認する。
- live検証が失敗した場合は修正完了と扱わず、原因と未解決範囲を報告する。

# 組織向け接続クライアント（配布候補）

会社別の設定JSONを使い、組織のAPIで認証してCodex CLIまたはClaude CLIを組織MCPへ接続します。組織版サーバーや共通Skills全体を含む製品一式ではありません。

WindowsではNode.js 22または24を使います。Codex利用時にClaudeのインストールは不要です。Claudeを使う場合だけネイティブの`claude.exe`が必要です。Node.js 20・Linuxの実機確認は未実施です。Windows CIの結果と利用者本人の受入は別に確認してください。

PowerShellで `node --version` を確認してください。Codexでは `Get-Command codex.exe`、Claudeでは `Get-Command claude.exe` を確認します。PATH以外にある場合はそれぞれ `CODEX_EXECUTABLE`、`CLAUDE_CODE_EXECUTABLE` にネイティブ実行ファイルの絶対パスを指定できます。管理者権限や実行ポリシーの変更は要求しません。Windowsのトークンと一時MCP設定にはACL、macOS/Linuxには0600/0700を使用します。

設定JSONには `organization_id`、`api_url`、`mcp_url` を必須で指定します。秘密値を設定JSONに含めないでください。組織IDはローカルのトークン取り違え防止にも使用しますが、サーバーでの所属・権限確認を代替しません。

```sh
node bin/organization-client.mjs inspect --config /path/to/company.json
node bin/organization-client.mjs auth --config /path/to/company.json
node bin/organization-client.mjs run-codex --config /path/to/company.json
node bin/organization-client.mjs run --config /path/to/company.json
```

期限切れ時は `refresh` を実行し、更新できない場合は `auth` で再認証します。認証情報は標準で `~/.brainbase/organization-client/<organization_id>/tokens.json` に保存します。`--token-file /path/to/tokens.json` で専用の保存先を指定できます。別組織・別接続先で取得した既存トークンを流用しないでください。

`run` の後に `-- --print ...` などのClaude引数を渡せます。MCP設定の上書きは拒否します。Claude CLIは別途必要です。

### 既存OSSからの接続切り替え

既存の `.brainbase/tokens.json`、会話、データ、Codex設定を削除しません。会社設定の `token_file` や `--token-file` に旧トークンを指定せず、上記の `auth` で組織用保存先へ再認証してください。旧トークンに `organization_id` 等を追記して流用する操作は禁止です。これはデータの別環境を作る手順ではなく、認証情報の取り違えを防ぐ保存先分離です。

`run-codex` はCodex CLIの起動用です。既に起動しているCodex Desktopの設定を変更するものではなく、Desktopの常設接続が完了したとは扱いません。サーバーで所属・権限が不足している場合は、再認証だけでは解消しません。Hostのturn bindingエラーも別の確認対象です。

Codexのこの起動中だけMCP一覧を会社設定の1接続に限定し、シェルへの環境変数継承を無効にします。既存設定ファイルは変更しません。追加引数は受け付けず、依頼は起動後に入力します。他のMCPや環境変数に依存する作業は従来の起動方法を使ってください。Codex CLI 0.145.0で設定構文を確認しています。

導入時は承認記録のSHA-256を照合した後、新しい専用ディレクトリへ展開してください。既存OSSのコード・設定・データを置換しません。切戻しは候補クライアントの起動をやめ、既存の起動方法に戻します。サーバーやデータの移行はこのパッケージの範囲外です。

このパッケージは非公開配布用です。npm公開、開発リポジトリ全体やGit履歴の配布は行いません。

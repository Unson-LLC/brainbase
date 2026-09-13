# 組織向け接続クライアント（配布候補）

会社別の設定JSONを使い、組織のAPIで認証してClaude CLIを組織MCPへ接続します。組織版サーバーや共通Skills全体を含む製品一式ではありません。

検証環境はmacOS・Node.js 22です。Node.js 20以上23未満を指定していますが、Node.js 20・Linuxの実機確認は未実施です。Windowsの起動は明示的に拒否します。既存Windows用入口の代替としてはまだ提供できません。

設定JSONには `organization_id`、`api_url`、`mcp_url` を必須で指定します。秘密値を設定JSONに含めないでください。組織IDはローカルのトークン取り違え防止にも使用しますが、サーバーでの所属・権限確認を代替しません。

```sh
node bin/organization-client.mjs inspect --config /path/to/company.json
node bin/organization-client.mjs auth --config /path/to/company.json
node bin/organization-client.mjs run --config /path/to/company.json
```

期限切れ時は `refresh` を実行し、更新できない場合は `auth` で再認証します。認証情報は標準で `~/.brainbase/organization-client/<organization_id>/tokens.json` に保存します。`--token-file /path/to/tokens.json` で専用の保存先を指定できます。別組織・別接続先で取得した既存トークンを流用しないでください。

`run` の後に `-- --print ...` などのClaude引数を渡せます。MCP設定の上書きは拒否します。Claude CLIは別途必要です。

導入時は承認記録のSHA-256を照合した後、新しい専用ディレクトリへ展開してください。既存OSSのコード・設定・データを置換しません。切戻しは候補クライアントの起動をやめ、既存の起動方法に戻します。サーバーやデータの移行はこのパッケージの範囲外です。

このパッケージは非公開配布用です。npm公開、開発リポジトリ全体やGit履歴の配布は行いません。

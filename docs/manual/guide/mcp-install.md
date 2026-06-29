# MCPを登録する

Brainbase MCPは、CodexやClaude CodeなどのMCP clientからstdio serverとして登録します。

## dry-runで確認する

まず実configへ書き込まず、設定内容だけを確認します。

```bash
npm run onboard:install -- --target codex --dry-run
npm run onboard:install -- --target claude --dry-run
```

出力された設定を確認し、問題なければ実configへ反映します。

## 登録後に確認すること

エージェントを再起動してから、次を確認します。

1. MCP server `brainbase` が起動している
2. tools listに `get_context`、`list_entities`、`search`、`search_personal_kg`、`onboarding_status` が出る
3. `onboarding_status` でseed済み項目と未設定項目が見える
4. `get_context` で自分、仕事、関係性の文脈を取得できる

## うまく動かない時

まず次を切り分けます。

- `npm run build` が通るか
- `npm run doctor` でローカルSSOTを読めるか
- `~/.brainbase/personal-os/` が存在するか
- エージェント側のMCP設定に絶対パスを使っているか

相対パスは、エージェントの起動場所によって解決先が変わるため避けます。

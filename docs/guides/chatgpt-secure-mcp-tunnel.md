# ChatGPTからBrainbase MCPへSecure MCP Tunnelで接続する

**正規経路**: `ChatGPT -> OpenAI Secure MCP Tunnel -> tunnel-client -> Brainbase MCP stdio`

この経路では、Brainbaseのloopback HTTP MCP（`127.0.0.1:39002`）を公開しない。既存HTTP MCPはローカルクライアントとJudgment Hook用に維持する。

## 前提

- OpenAI Platformで作成した`tunnel_...`形式のTunnel ID
- `tunnel-client`用runtime API key
- Tunnelと対象ChatGPT workspaceのassociation
- runtime operatorの`Tunnels Read + Use`
- ChatGPT developer mode
- Mac miniから`api.openai.com:443`へのoutbound HTTPS
- `tunnel-client`、Infisical CLI、Brainbase MCP build

公式仕様はOpenAIのSecure MCP TunnelおよびChatGPT developer modeのドキュメントを参照する。

## 1. Tunnel secretをInfisicalへ保存する

Infisical project `ce20541c-02b9-4523-bbe0-49d50b2fcc19` の次の場所を使う。

```text
env:  prod
path: /mcp/openai-brainbase-tunnel
```

必要なkey:

```text
CONTROL_PLANE_API_KEY=<OpenAI tunnel runtime API key>
OPENAI_MCP_TUNNEL_ID=tunnel_...
```

値を`.env`、plist、repositoryへ保存しない。Universal Auth credentialは次のどちらかへ置き、`chmod 600`にする。

```text
~/.brainbase/runtime-env/openai-mcp-tunnel.universal-auth.env
~/.brainbase/runtime-env/infisical.unson.universal-auth.env
```

## 2. tunnel-clientをinstallする

OpenAI PlatformのTunnel settingsから公式`tunnel-client`を取得する。launchd templateの既定値は次である。

```text
~/.local/bin/tunnel-client
```

別の場所へinstallした場合、installerが`command -v tunnel-client`の結果をplistへ書き込む。

## 3. profileを初期化してlaunchdへinstallする

managed runtimeが最新の`develop`へ更新され、`mcp/brainbase/dist/index.js`がbuild済みであることを確認する。

初回のみ:

```bash
cd /Users/ksato/workspace/repos/.runtime/brainbase-31013
bash scripts/install-chatgpt-brainbase-tunnel-launchd.sh --init
```

2回目以降:

```bash
bash scripts/install-chatgpt-brainbase-tunnel-launchd.sh
```

installerは次を行う。

1. Brainbase MCPのTask API / Judgment binding preflight
2. `sample_mcp_stdio_local`でprofile `brainbase-chatgpt`を初期化
3. `tunnel-client doctor --profile brainbase-chatgpt --explain`
4. launchd job `com.brainbase.chatgpt-mcp-tunnel`をinstall
5. jobが`running`へ到達したことを確認

## 4. Mac mini側を検証する

```bash
bash scripts/run-chatgpt-brainbase-tunnel.sh check
launchctl print "gui/$(id -u)/com.brainbase.chatgpt-mcp-tunnel"
tail -n 100 ~/Library/Logs/brainbase-chatgpt-mcp-tunnel.error.log
```

## 5. ChatGPT appを作る

ChatGPTでdeveloper modeを有効にし、custom appのConnectionとして`Tunnel`を選ぶ。対象Tunnelを選択またはTunnel IDを入力し、Brainbase MCPのtool scanを実行する。

最初はKnowledge、Entity、Decisionなどのread/fetch相当toolで疎通確認する。write toolはChatGPT plan、workspace policy、承認設計が許す場合だけ有効化する。

## 更新時の動作

Brainbase runtime reconcileはMCP build後に共有HTTP MCPを再起動する。Tunnel jobがinstall済みなら、stdio childを新buildへ切り替えるためTunnel jobも再起動する。

Tunnel再起動だけが失敗してもBrainbase UI/MCP本体のdeployは維持し、状態を次へ残す。

- `~/Library/Logs/brainbase-chatgpt-mcp-tunnel.error.log`
- `/Users/ksato/workspace/var/brainbase-mcp-reconcile.last`の`chatgpt_tunnel`

## トラブルシューティング

`tunnel-client not found`の場合は公式clientをinstallし、`command -v tunnel-client`を確認する。

`missing CONTROL_PLANE_API_KEY`の場合はInfisicalのpath、environment、Machine Identity policyを確認する。

ChatGPTにTunnelが表示されない場合は、Tunnelと対象workspaceのassociation、および`Tunnels Read + Use`権限を確認する。

Brainbase preflightが失敗する場合は、TunnelではなくBrainbase MCP側を先に直す。

```bash
bash scripts/run-brainbase-mcp.sh --check
```

# ChatGPTからBrainbase MCPへ接続する正規トランスポート

- 決定日: 2026-08-19
- ステータス: 採用
- 正式決定ID: `decision_chatgpt_brainbase_mcp_transport`

## 背景

Brainbase MCPは、ローカル共有クライアント向けには`127.0.0.1:39002/mcp`のStreamable HTTP、プロセス直結時にはstdioで動作できる。ChatGPTはローカルのloopback MCPへ直接接続できないため、ChatGPT対応をHTTPポートの公開やCloudflare経由で実現すると、新しい外部ingress、認証面、運用面を増やす。

OpenAI Secure MCP Tunnelは、MCP serverを公開せず、Mac mini側からOpenAIへoutbound HTTPSを張り、ローカルMCPをstdioまたはHTTPで呼び出せる。

## 判断

ChatGPTからBrainbase MCPへ接続する正規経路を次に固定する。

```text
ChatGPT developer-mode app
  -> OpenAI-hosted Secure MCP Tunnel endpoint
  -> tunnel-client on the Brainbase Mac mini
  -> stdio
  -> scripts/run-brainbase-mcp-stdio.sh
  -> scripts/run-brainbase-mcp.sh
  -> Brainbase Graph / Knowledge / Judgment / Canonical Task APIs
```

`tunnel-client`のprofile名は`brainbase-chatgpt`とする。profileは公式の`sample_mcp_stdio_local`から初期化し、MCP commandにはBrainbaseのstdio専用launcherを指定する。

## 信頼境界

- Brainbase MCPのHTTP port `39002`は引き続き`127.0.0.1`にのみbindする。ChatGPT向けに公開しない。
- Cloudflare Tunnelや独自public reverse proxyをChatGPT MCPの正規経路にしない。
- OpenAI runtime API keyと`tunnel_id`は専用のInfisical path `/mcp/openai-brainbase-tunnel`に置き、repository、plist、ログへ保存しない。
- `tunnel-client`へ注入したInfisical tokenは起動直後に破棄する。
- Brainbase MCP childへOpenAI control-plane key、tunnel ID、HTTP transport環境変数を継承させない。
- Brainbase MCPは従来どおりBrainbase専用Infisical targetからGraph、Task、Judgment用credentialを取得する。
- ChatGPT側のtool許可はworkspace policyに従う。接続できることと、write actionを許可することを同一視しない。

## 既存HTTP MCPの扱い

既存の`com.brainbase.mcp-brainbase`は廃止しない。これはローカルの複数MCP client、health check、Judgment Hookなどが利用する共有runtimeである。

ChatGPT用Tunnelは別のlaunchd job `com.brainbase.chatgpt-mcp-tunnel`として稼働させる。runtime更新時は、共有HTTP MCPを再起動した後、Tunnel jobがinstall済みならstdio childを新buildへ切り替えるためTunnelも再起動する。Tunnel障害はBrainbase UI/MCP本体のdeployを巻き戻さず、reconcile receiptとログへ不健全状態を残す。

## 採用理由

- inbound portを増やさず、Brainbase MCPをprivateのまま保てる。
- Brainbaseが既に持つstdio transportをそのまま使える。
- HTTP Bearer headerやpublic proxyをChatGPT専用に追加する必要がない。
- OpenAI tunnel identity、ChatGPT workspace association、Brainbase credentialの責務を分離できる。
- 既存のローカルHTTP MCP利用者を壊さず段階導入できる。

## 却下した案

- **`39002`をInternetへ公開する**: 攻撃面と運用責務が不必要に増えるため却下。
- **既存Cloudflare ingressへBrainbase MCPを追加する**: ChatGPT専用transportのためにpublic proxy contractを増やすため却下。
- **Tunnelからloopback HTTP MCPを呼ぶ**: 技術的には可能だが、Bearer credential管理と共有processへの結合が増える。既存stdio pathの方が単純で境界が明確なため却下。
- **ChatGPT用に別MCP implementationを作る**: tool contractと判断ロジックが分岐するため却下。

## 運用契約

1. OpenAI PlatformでTunnelを作成し、対象ChatGPT workspaceと関連付ける。
2. runtime API keyと`tunnel_id`をInfisicalへ保存する。
3. `scripts/install-chatgpt-brainbase-tunnel-launchd.sh --init`でprofile初期化、doctor、launchd常駐化を行う。
4. ChatGPT developer modeでConnection=`Tunnel`を選び、対象Tunnelからappを作る。
5. tool schema変更後はChatGPT workspace側でもapp/action snapshotを更新する。
6. `tunnel-client doctor --profile brainbase-chatgpt --explain`とlaunchd状態を運用証跡にする。

## プラン上の制約

2026-08-19時点のOpenAI案内では、ChatGPT Proはdeveloper modeでread/fetch MCPへ接続できるが、full MCPのwrite/modifyはBusiness、Enterprise、Edu向けである。Brainbase側ではwrite toolを維持するが、ChatGPTで有効化できる権限は導入時点の公式仕様とworkspace policyを再確認する。

## 見直し条件

- OpenAIがTunnelまたはChatGPT developer-mode appの接続契約を変更したとき。
- Brainbase MCPを常時稼働するprivate HTTP serviceとして統合した方が、stdio process分離より明確に単純になったとき。
- 複数tenantへ提供する商用Brainbase Cloud側へ接続責務を移すとき。

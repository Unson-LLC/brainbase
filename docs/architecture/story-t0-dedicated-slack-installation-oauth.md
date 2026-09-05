# TechKnight専用Slack installation OAuth アーキテクチャ

## 判断

installation control planeのOAuth交換資格情報をAuthServiceのログイン資格情報から分離する。専用環境変数がすべて存在するときは専用値を使い、すべて存在しないときだけ既存AuthServiceへ戻る。専用設定の一部だけが存在する構成はfail-closeする。

## 境界

- `BRAINBASE_SLACK_INSTALLATION_APP_ID`: provider応答との一致を検証するSlack App ID
- `BRAINBASE_SLACK_INSTALLATION_CLIENT_ID`: OAuth token交換のclient ID
- `BRAINBASE_SLACK_INSTALLATION_CLIENT_SECRET`: OAuth token交換のsecret
- `BRAINBASE_SLACK_INSTALLATION_REDIRECT_URI`: Slack管理画面にも登録する固定HTTPS callback
- `BRAINBASE_SLACK_INSTALLATION_STATE_SECRET`: intentとcallbackを束縛する短命stateの署名secret
- `BRAINBASE_SLACK_INSTALLATION_BOT_SCOPES`: 導入時に要求するbot scope
- `BRAINBASE_SLACK_INSTALLATION_AUTHORIZE_URL`: 任意。既定はSlack公式authorize endpoint
- `BRAINBASE_SLACK_INSTALLATION_TOKEN_URL`: 任意。未指定時はAuthServiceのtoken URLを使う

管理者認証済みauthorize routeが、永続化したinstallation intentを署名・期限付きstateへ束縛してSlack authorization URLを返す。公開callbackはstateを検証してから同じcontrol planeを直接呼び、service tokenをブラウザへ渡さない。テナント、workspace、appの一致検証とcredential storeへの保存契約は変更しない。秘密値、code、tokenはレスポンス、DB、ログへ残さない。

## 今回含めないもの

- 一つの実行プロセスで任意個のSlackアプリを同時選択するregistry
- Slack管理画面の自動化
- 人間のOAuth同意の代行

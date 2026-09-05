# TechKnight専用Slack installation OAuth アーキテクチャ

## 判断

installation control planeのOAuth交換資格情報をAuthServiceのログイン資格情報から分離する。専用環境変数がすべて存在するときは専用値を使い、すべて存在しないときだけ既存AuthServiceへ戻る。client IDまたはsecretの片側だけが存在する構成はfail-closeする。

## 境界

- `BRAINBASE_SLACK_INSTALLATION_APP_ID`: provider応答との一致を検証するSlack App ID
- `BRAINBASE_SLACK_INSTALLATION_CLIENT_ID`: OAuth token交換のclient ID
- `BRAINBASE_SLACK_INSTALLATION_CLIENT_SECRET`: OAuth token交換のsecret
- `BRAINBASE_SLACK_INSTALLATION_TOKEN_URL`: 任意。未指定時はAuthServiceのtoken URLを使う

テナント、workspace、appの一致検証とcredential storeへの保存契約は変更しない。秘密値は環境変数境界の内側だけで扱う。

## 今回含めないもの

- 一つの実行プロセスで任意個のSlackアプリを同時選択するregistry
- Slack管理画面の自動化
- 公開インターネット上のOAuth callback route。T0本番検証は操作端末のlocalhost callbackから既存のservice-only交換APIへ渡す
- 人間のOAuth同意の代行

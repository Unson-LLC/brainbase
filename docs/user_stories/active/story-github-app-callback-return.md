# GitHub App接続後に管理画面へ戻る

## Story

組織管理者として、GitHub Appのインストールと正本への保存が成功したら、Brainbase組織管理画面へ戻り、保存済みの接続状態を確認したい。

## Acceptance criteria

- 接続の検証・credential保存・正本readbackがすべて成功した後だけ、固定設定された管理画面URLへ303で戻す。
- 戻り先はHTTPSの固定URLだけを受け入れ、利用者入力やGitHubのqueryから決めない。
- 戻り先が未設定なら従来どおりJSONを返し、無効な設定では接続フローを開始しない。
- 管理画面はcallback queryを成功根拠にせず、status APIの再取得で接続済みを判定する。

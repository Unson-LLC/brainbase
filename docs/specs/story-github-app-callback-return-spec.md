# GitHub App callback return仕様

正本APIは `GITHUB_APP_CALLBACK_RETURN_URL` を起動時に読み、GitHub App callback handlerへ固定設定として渡す。URLはHTTPS、credentialなし、fragmentなしでなければならない。これは利用者入力ではなく運用設定であり、callback requestの値で上書きできない。

callbackはstate消費、GitHub installation検証、credential storeへの保存、provider readback、connection repositoryへの保存が完了した後だけ303を返す。戻り先には管理画面がstatus APIを再取得するための非権威的な `github=connected` 表示ヒントを設定できる。未設定時は既存のJSON応答を維持する。

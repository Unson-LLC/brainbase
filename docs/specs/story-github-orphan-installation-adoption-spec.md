# Spec: GitHub App 孤立インストールのテナント限定採用

GitHub 接続開始時、保存済みの有効な接続を再確認した後も未接続なら、認証済み access の organization alias を使って `PROJECT_PROVISIONING_GITHUB_BINDINGS` の owner を解決する。request body から owner や installation ID は受け取らない。

owner が解決できた場合、GitHub App JWT で `GET /orgs/{owner}/installation` を読み、App slug と account login が一致する installation だけを候補にする。候補は callback と同じ reservation、Remote Credential Store、materialize、provider readback、現行接続保存の順で登録する。途中失敗時は credential と reservation を補償し、成功を返さない。

owner binding がない、GitHub が 404 を返す、または installation が存在しない場合は新規インストール認可へ進む。設定不備、曖昧な応答、保存・readback失敗は fail closed とし、別テナントへの fallback は行わない。

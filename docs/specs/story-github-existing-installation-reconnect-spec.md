# Spec: GitHub App の既存インストール再確認

GitHub の接続開始時に、対象テナントの現行 GitHub 接続を取得する。現行行があり、Remote Credential Store の参照検証、資格情報のmaterialize、GitHub App installation readbackがすべて一致した場合は、外部画面へ遷移させず `connected: true` とアカウント情報を返す。

行がない、または検証済み接続でない場合だけ、新規インストール用の署名済み state を発行する。unknownや検証失敗をconnectedへ変換しない。


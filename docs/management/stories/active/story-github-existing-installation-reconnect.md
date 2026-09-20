# Story: GitHub App の既存インストールを再接続する

組織管理者として、すでに有効な GitHub App 接続で「再接続」を押したとき、GitHub の設定画面へ移動して止まらず、Brainbase 上で接続済みと確認したい。

## 受け入れ条件

- 保存済み接続の資格情報と GitHub readback が有効なら、`POST /api/organization-connections/github/start` は `connected` を返す。
- 有効性を確認できない接続を成功扱いしない。
- 接続が存在しない場合は、従来どおり署名済み state を含む新規インストール URL を返す。


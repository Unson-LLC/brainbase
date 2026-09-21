# Story: 保存に失敗した GitHub App インストールを復旧する

組織管理者として、GitHub 側には Brainbase の App がインストール済みなのに Brainbase 側の接続保存だけが失敗している場合、App を削除して入れ直さずに接続を完了したい。

## 受け入れ条件

- Brainbase に現行接続がなく、対象テナントの許可済み GitHub owner に App installation が存在する場合、`POST /api/organization-connections/github/start` はその installation を検証・保存して `connected` を返す。
- 採用対象の GitHub owner はサーバー側のテナント別 binding からだけ決定し、クライアントは指定できない。
- installation の資格情報保存、materialize、GitHub readback が一致するまで接続済みにしない。
- binding がない、または許可済み owner に installation がない場合は、従来どおり署名済み state を含む新規インストール URL を返す。
- 他テナントの installation、曖昧な provider 応答、秘密情報をレスポンスへ出さない。

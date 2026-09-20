# 旧ブラウザUI・Mac Companion・ローカルAPIの区別

旧ブラウザUIは廃止済みです。Mac Companionは別アプリであり、ポート31013はローカルAPIの実行環境です。「Mac UI」という呼称でまとめないでください。

| 対象 | 役割と扱い |
| --- | --- |
| 旧ブラウザUI | 廃止済み。復活・移行の対象にしない |
| Mac Companion | 保存された接続先と認証を使うクライアント。設定の正本はCompanionのKeychainであり、UserDefaultsのcache-scopeではない |
| 31013のローカルAPI | ルーティンなどのローカル処理を受ける。UIの廃止を理由に停止しない |
| `com.brainbase.ui` / `BRAINBASE_UI_RUNTIME_ROOT` | 既存インストールの互換識別子。名前にUIが残っていても、旧UIの稼働を意味しない。別名のジョブを重複登録しない |
| ローカルDB | 存在や件数だけでは移行漏れ・不要データと判定できない。削除や書き込み有効化には別途根拠が必要 |

## タスク操作の接続先

`scripts/lib/canonical-task-api-client.js` は、コンストラクターの `baseUrl`、`BRAINBASE_TASK_API_BASE_URL`、`BRAINBASE_API_URL` の順で接続先を選びます。未設定なら通信前に失敗します。本番にもlocalhostにも暗黙で接続しません。

通常は `/api` を付けず、明示的に `https://bb.unson.jp` を設定します。クライアントが `/api/companion/tasks` を付加します。HTTPは明示したloopback接続のみ許可されます。Bearer認証は別途必要です。接続先を指定したこと自体は、タスクの作成・変更を許可するものではありません。

ルーティンの `BRAINBASE_ROUTINE_API_URL` と内部認証による31013接続、MCPの接続先は別の契約です。タスク用スクリプトの既定値除去と一緒に削除しないでください。

## 確認の境界

- APIの稼働コードは `/api/version` のSHA・cwd・dirty状態で確認する。
- Companionは保存設定と、その認証を使った実際のGETを分けて確認する。秘密値は表示しない。
- 401は認証不成立であり、タスクの不在や移行完了ではない。
- 異なるDBの件数差を、そのまま移行残件数にしない。
- ローカル確認を、他ホストや本番の確認済み状態に拡張しない。

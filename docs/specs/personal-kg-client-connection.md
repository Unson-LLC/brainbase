# 個人KGクライアント接続仕様

Story: [ManaとCodexから本人の記憶を使う](../stories/personal-kg-client-connection.md)

## ManaのAPI境界

署名済みcompany_authority_responseをPOST本文に添付する。

| API | capability | effect | 本文 |
| --- | --- | --- | --- |
| POST /api/personal-knowledge/search | personal_read | read | query, limit |
| POST /api/personal-knowledge/events | personal_write | write | 既存Personal Vaultイベント |

POST検索は非空文字列のquery（最大4000文字）と整数limit（1〜50、既定10）を受ける。

サービス経路はこの2操作のみを許可する。署名済みactorとownerの一致、personal data scope、transport project scope、配置・audience・有効期限、resource_ref=`personal://<owner>/notes`、署名済みSlack DMを検証する。権限包絡は記憶本文へ保存しない。

ユーザーJWT経路は既存の本人認証を維持する。署名済み包絡が添付されてもJWTの本人を上書きできない。

## 保存先

localとmanaged_cloudの切替は明示設定とする。クラウドのエラーを空結果・ローカルへの退避・成功へ変換しない。所有者と組織の境界、イベントID・hash・出典を両方式で保持する。既存記憶の自動移送や組織昇格は行わない。

未設定の既存MCP検索は候補storeを使う互換経路を維持する。明示設定した登録・検索はPersonal VaultイベントAPIを使う。localはループバックAPIとそのローカルDBを使い、URLがlocalhostであることだけをローカル保存の証明にしない。

## 反証と検証

正常な本人DMでの登録・検索に加え、署名変更、期限切れ、別owner、別organization、読取り権限での登録、共有チャンネル、別APIへの流用を拒否する。クラウド接続失敗がローカル保存や成功にならないことを確認する。

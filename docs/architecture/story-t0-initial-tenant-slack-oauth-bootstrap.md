# 初期Slack接続bootstrap アーキテクチャ

## 判断

通常の人員登録がactive workspace connectionを要求する契約は維持する。循環を解くため、運用者専用CLIに二つの狭い段階を追加する。

1. 初期管理者登録: 1名の`tenant_admin`について、organization、person、auth grant、tenant membershipだけを冪等に登録する。
2. OAuth開始: 上記4状態とtenant projectを同一tenant transactionで再読込し、既存installation control planeへcanonical intentを渡して署名付きSlack同意URLを発行する。

## 信頼境界

- public authorize routeの認証を迂回する公開APIは追加しない。
- CLIは本番DB roleと明示承認を持つ運用者だけが実行する。
- 初期管理者のmanifestはhuman 1名、canonical person ID、単一tenant project、期待workspace/appに固定する。
- OAuth URL発行は初期管理者状態をDBで検証した後に行い、intentの`initiated_by_person_id`へそのpersonを固定する。
- app IDはoperator CLIの本番設定とmanifestをDB接続前に照合する。workspace/appは署名stateに固定し、callback交換時にSlack応答と照合する。
- intent保存は初期管理者の再検証と同じDB transaction内で行い、別接続待ちと部分commitを作らない。
- Slackの同意画面で行うログイン・承認は本人操作とし、CLIは代行しない。
- callback以降のtoken交換、credential保存、workspace connection登録は既存control planeを再利用する。

## 失敗時

不一致、欠損、曖昧性はfail-closeする。dry-runはrollbackする。DB処理失敗時は`release(error)`で接続を破棄候補にする。OAuth intent保存後にURL作成が失敗した場合は同じtransactionをrollbackし、intent、token、接続を残さない。

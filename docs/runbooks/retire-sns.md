# SNS廃止の配備・読戻し

## 保全するもの

- 既存投稿台帳、投稿履歴、ログ、旧SQL。
- 個人知識、人物同定、会議学習、Personal→Organization昇格。
- SNS以外の認証・テナント境界・integration account基盤。

台帳のDELETE/DROP、既存行の組織への帰属変更、SNS用RLSの追加適用は不要。

## 実行元を停止する

Macのlaunchd登録と設定ファイルのLabel/ProgramArgumentsを確認する。
`launchctl print`の全出力には継承した秘密情報が含まれ得るため、証跡には保存しない。
SNS専用の投稿・反応取得ジョブだけをdisableしてbootoutする。
設定ファイルとログは消さず、disabled状態と登録一覧からの不在を読み戻す。
Lightsailはsystemd service/timer、利用者cron、system cronのSNS専用実行を確認する。
名前検索だけでは別名ジョブの不在証明にならないため、確認範囲を明記する。

## コード配備

[Lightsail配備手順](../brainbase-capabilities/runbooks/deploy-lightsail-production.md)のRLS・Personal昇格ゲートを省略しない。
マージSHAを固定し、既存稼働SHAとの差分に含まれる共通schemaを先に検証する。
SNS廃止だけを理由に、未適用の共通schemaを飛ばして再起動してはならない。

同じ対象DB・実行ロールで台帳件数を配備前後に確認し、本文・認証情報は出力しない。
HTTP読戻しでは`/api/sns-growth`のGET/POSTが410であること、対象SHAとdirty=falseを確認する。
個人知識と権限のスモークは別途実行し、healthだけを代用しない。

## 今回の運用確認（2026-09-04）

- Mac: `com.brainbase.sns-scheduled-publisher`を無効化し登録解除した。disabledを読戻し、登録一覧から不在を確認。
- 同ジョブの設定ファイルと台帳・ログは削除していない。
- Macの登録一覧およびLaunchAgentsファイル名では、SNS反応取得ジョブは見つからなかった。
- Lightsail: SNS/posting/metrics-poller名のsystemd unit/timerは見つからなかった。system cron、利用者cron、systemd定義内のSNS専用スクリプト名検索も一致なし。Macの現在利用者cronも一致なし。別名の独自ジョブまでの不在証明ではない。
- Lightsail checkout SHA: `639fbbb42dac6115d7fa7b0f220eb453c50f97e8`、作業差分なし。
- ジョブ停止後の本番台帳を読取り専用で集計し、`sns_posting_ledger_posts`は121件を確認。本文は取得していない。
- API廃止の本番配備、台帳件数の配備前後比較、T0/A0/P0/G0本番検証は未完了。

無効化の取消しはSNS再開の別判断を要する。コードの巻戻しだけで投稿ジョブを再有効化しない。

## ローカル検証

- SNS・サーバーbootstrap・共通M5-A移行・launchdの回帰: 98ファイル351テスト合格。
- SNS専用CLIは9入口それぞれで、引数なし・dry-run・公開フラグ付きの3通りを最小環境変数で実行し、廃止応答と終了コード1を確認。
- 個人知識・会社権限・Graph書き込み・共通M5-A移行の対象回帰は合格。
- `--only sns-posting-ledger`と`--only=sns-posting-ledger`はいずれもDB接続前に拒否。重複指定も拒否。
- 周辺の`companion-approval-inbox.test.js`のproduction bootstrapケースは403で失敗するが、変更前のclean SHA `4d04fa5c2e56576078214722aa7253ff88c4acc8`でも同じ失敗を再現した。今回のSNS変更による成功・修正として扱わない。
- 旧SNSのPlaywright契約3ファイル5件は、一時設定でworktree除外を解除して2件合格・3件失敗。変更前の同じclean SHAでも、履歴fixtureが空になる1件と`owner_person_id`不足2件を再現した。廃止対応とは別の既存失敗として残す。
- 本番schema・OAuth・2 tenant負例・各境界readbackは、これらのローカル合格で代用しない。

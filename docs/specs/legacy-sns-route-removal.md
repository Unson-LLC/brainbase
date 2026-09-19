# Story: 退役済みSNS APIの旧実装を再利用させない

## 目的

現行の[SNS廃止仕様](retire-sns-spec.md)に従い、production登録から外れた旧routeと専用テストを除去する。共有処理・保存台帳の削除や本番反映は含めない。

## 受け入れ条件

1. `server/routes/sns-growth.js`と、その旧API動作だけを検証する`tests/server/routes/sns-growth.test.js`を削除する。
2. production bootstrapのSNS入口は全操作410を維持し、認証・投稿実行器・DB接続・JSON台帳生成を呼ばない。
3. 旧routeファイル不在を回帰テストで固定する。既存410テストは保持する。
4. Web退役台帳の現行記述をSNS廃止仕様に合わせる。過去のUI退役実績は後続廃止と区別する。
5. `server/services/sns`、CLI退役スタブ、SQL・保存台帳には変更しない。

## 代替仮説と検証

外部consumerが旧routeを直接importする可能性はrepo内調査だけでは否定できない。一方、公開APIは既に410であり、旧route保持は現行サービス提供の要件ではない。production登録・逆参照を確認し、共有サービスを対象外にした限定削除とする。

Graphifyと参照検索で影響を確認し、旧route不在テストのRed→Green、既存410境界テスト、退役CLIの対象テストを実行する。一度の独立レビューと通常PR/CIを経て統合する。マージを本番廃止完了とは扱わない。

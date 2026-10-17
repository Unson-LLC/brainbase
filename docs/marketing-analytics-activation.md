# 公開マーケティングGA4計測（未有効化）

2026-10-08時点。今回のPRは計測基盤の準備です。公開配備、GA管理設定変更、新規プロパティ/ストリーム作成、実装後のGA受信確認は行っていません。

## 公開前に必要な確認

1. 他4サイトのIDを新しい公開マーケティング用プロパティ/ストリームで用意するか確認する。既存Zeimsは `G-K0PLHCYHL5` を継続し、重複タグを追加しない。既存brainbase-omi-selfhostはアプリ用なので流用しない。
2. 基本同意方式を承認する。同意前はGoogleタグもpingも読み込まない。同意した訪問者に限りGA cookieをホスト単位・30日間で使用する。選択はlocalStorageに保存し、常設の設定ボタンから撤回可能。広告3種の同意は常にdenied。Googleには計測イベントと標準ブラウザ情報、通信に伴うIPが届く。フォーム値、メール、氏名、顧客内容は渡さない。撤回後は送信停止する（既存cookieの削除はこの実装では行わない）。
3. ストリームの拡張計測を無効にする。特に履歴の自動page_view、離脱クリック、フォーム、検索を停止して、生URL/queryの自動収集・二重計測を防ぐ。GAのメール削除設定だけを防御にしない。既存Zeimsの拡張計測は有効、URL query削除は無効だった。既存同意ポリシーがある場合はこのUIと併存せず承認済みCMPへ接続する。
4. JS先頭の `id` を設定し、実際にGA管理設定を確認した後だけ `enhancedMeasurementDisabled` と `enabled` をtrueにする。Zeimsはさらに `NEXT_PUBLIC_MARKETING_ANALYTICS_ENABLED=true` で既存GoogleAnalyticsを置換する。同時稼働しない。デフォルトでは既存タグの動作は維持する。
5. 通常のrepoレビュー・配備経路で公開する。このPRをマージしても新しいGA送信は始まらない。

## イベントと分析

|イベント|意味|追加固定値|
|---|---|---|
|page_view|許可された公開ページ分類の閲覧|site_name, page_group, acquisition_group|
|select_product|別製品の公開ページ・組織版への移動|product_name|
|trial_click|Zeims登録リンク/OSSパッケージへのクリック|product_name|
|inquiry_click|問い合わせセクション・予約への移動|cta_kind|
|generate_lead|公開フォームが成功応答を返した時のみ|cta_kind|

全イベントのpage_locationは固定の仮想アドレス `/__marketing/<分類>`。訪問者のURL、query、hash、参照元URL、リンク先URL、タイトル文字列を送りません。流入は参照元をsearch/social/owned/referral/directに分類し、UTM/queryを読み取りません。任意の属性を受け付けるAPIはありません。対象ホストとページはコード内の許可リストに限定し、アプリ・不明なルート・preview環境では起動しません。広告機能とクロスドメインlinkerは無効です。

GAでイベントスコープの `site_name`, `page_group`, `acquisition_group`, `product_name`, `cta_kind` をカスタムディメンションに登録。`generate_lead` だけを問い合わせキーイベントに指定。探索で流入分類→公開ページ→製品選択→試用クリック/問い合わせ成功を集計します。ホスト間は匿名ユーザーを連結しないため、個人単位のサイト横断ファネル・ログイン後の登録完了・契約/売上は計測できません。クリックを試用完了や問い合わせ成功と報告しないでください。

## 検証と受信確認の境界

`node --test tests/marketing-analytics.node.cjs` はGoogleへ送信しないVMテストです。無効化、同意前、重複タグ、PII/query排除、拒否/撤回、SPAページ重複、未知ルート、CTA、成功イベントを検証します。これはブラウザでの実際のGA通信や受信を保証しません。

承認・配備後、Networkでg/collectを確認：拒否時0件、同意時page_view一回、SPA遷移一回、離脱クリック/フォーム値/URL/queryがないこと、設定撤回後0件を実測。フォームは実顧客データを使わずテスト用問い合わせ送信の許可を別途得る。DebugViewは承認されたデバッグ設定で固定値のみの受信を確認し、最後にRealtimeと翌日の標準レポートを確認する。未検証は未検証と記録し、debug_modeは本番常設しない。

参考：[手動page_viewと履歴の拡張計測](https://developers.google.com/analytics/devguides/collection/ga4/views)、[Google同意モード](https://developers.google.com/tag-platform/security/guides/consent)。

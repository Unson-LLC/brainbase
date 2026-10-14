# RQ012: 目的と現状・判断履歴の件数帯を除く

## 受け入れ条件・最小仕様

共通UIのfoundation overview（目的/哲学/世界モデル）とjudgment history（通常/legacy）から大きな3列件数summaryを除く。共通workspaceMetrics部品そのものや集計データ/APIは変更しない。

取得範囲、一部取得/未接続/不正応答、未確認の意味、再試行、記録一覧、詳細、検索/ページングを保持する。件数帯を警告と混同せず、未取得を成功や0件に変換しない。代替の大きなsummaryを追加しない。

## 境界

共有UIの正本だけを変更する。組織ホストによるOSS CSS上書きやコピーは行わない。組織版のpublished pinの更新は承認済み公開版が出た後の別作業。パッケージ公開・手動配備は今回対象外。その他画面の件数帯は別途調査するため、RQ012全件完了とは扱わない。

## 検証

foundationの内容・状態・出典を保持する既存tests、判断履歴の通常/legacy/空/partial records/再試行を確認する既存tests。表示summaryはなくてもpure aggregatorの件数契約は保持する。

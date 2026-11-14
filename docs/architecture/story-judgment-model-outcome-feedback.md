# 判断の結果を世界モデルへ書き戻す仕組みの配置

記録の形・検証・一覧への反映・エスカレーションはOSS正本に置き、既存 `judgment-frame` subpathから公開する。テナント側に同じ実装をコピーしない。

handlerは保存先を所有しない。世界モデルの読込みは既存の `loadRecords`、結果記録の読込みと追記は呼出し側が渡す `loadModelOutcomes`・`appendModelOutcome` に任せる。記録者・記録時刻・認可・保存先（追記専用）はhostの責務である。

世界モデル本体（版・`validationState`・`adoptionState`）は変えない。Graphのfoundation履歴は本文の変更ごとに版を上げるため、結果は世界モデルのid＋版に結び付く別の追記専用記録として保持する。これは世界モデル仕様の「Graph定義＋証拠記録」の分け方に従う。

カタログのdigestは従来どおり定義だけから作る。結果の件数は表示と記録時のエスカレーション判定のたびに読み直し、digestに含めない。これにより、本文取得とHostのdigest照合は変わらない。

採否や改訂は `foundation_adopt`（ADR-015）と `company-os-learning-adoption` の経路に残す。このsource変更はpackageのversionを変更せず、公開と稼働反映は別の手順で行う。

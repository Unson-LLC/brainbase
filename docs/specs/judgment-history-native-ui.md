# 判断履歴の共通UI

Story: `story-judgment-history-native-ui-v1`

- 既存`/api/value-proofs/home`のread modelを読み、四区分内のproofを一つの履歴へ投影する。既存reader・公開APIを変更して新たな台帳を作らない。
- `ui/judgment-history.js`に純粋な集計と読み取り専用UIを置く。`createJudgmentHistoryUI`はroot/rail/document/fetcher/basePath/page/autoLoad等のホスト設定を受ける。load、render、disposeを持ち、破棄後や後発のload後に古い応答を表示しない。
- ペイロードのavailable/partialとcoverageを検証する。unavailable、HTTP失敗、不正応答を数値0へ変換しない。coverageのrejectedや不完全な取得を近くに説明し、部分取得の件数には「取得できた範囲」を付ける。partial/unknownで読めた履歴がない場合、主要件数も未確認と表示する。完全取得を確認した空の場合だけ0件とする。
- 同一intentのrecorded_at最大を選ぶ。同時刻はdecision_attempt_idで順序を固定する。その後に今週（JST月曜開始）/過去30日/全期間と検索を適用する。既定は過去30日。未来の記録を期間件数へ混ぜない。
- 検索は参照・判断・本人への問い・実行と結果の補足を対象とする。期間・検索を変えても入力のフォーカスを維持し、詳細はEnterで開き、閉じるボタンまたはEscapeで元の行へ戻る。
- `interruption.resolution=continued_without_human`かつ非空のdecision.summaryのみ代理判断として数える。その他は履歴に残し、本人確認や判断内容未記録と示す。
- 参照はbasis(entity_id, version, application, layer)とinheritance.sources(ref, version, label, kind)。同一ID・版を一つとし、application/labelを失わない。参照の件数は絞り込んだ代理判断に含まれる一意の参照数。
- 件数は代わりに判断N件、そこで使った参照N件、判断N回分相当。検索・期間で履歴と同時に更新する。時間や金額の換算はしない。
- workspace-kitと既存tokensを用いる。親シェルが見出しを持つ場合は共通部品の見出しを省略する設定を用意する。履歴の行は共通grid/table行として3列が同じ高さを共有し、モバイルは同一行をカードへ変形する。
- 詳細は参照と判断を先に、実行・結果・記録IDを補足へ置く。評価フォームなし。DOMへの文字はtextContentを用い、保存されたURLを無条件にリンク化しない。
- 既存value-proof-review UIは公開互換のため維持するが、OSSの今日/standalone reviewと組織版の履歴入口は新しい共通UIを使用する。
- 新しいUI資材をpackage exportとホストの明示allowlistへ登録する。組織版はコピーせず同一配布物を使用する。

検証は、重複intentの新しい判定が期間外にある反例、human_required、空summary、複数参照と重複、検索/期間一致、未知/partial/確定空、遅延応答、本人scope不一致、実製品ホストの本人journal読取、desktop/mobileの行整列を対象とする。

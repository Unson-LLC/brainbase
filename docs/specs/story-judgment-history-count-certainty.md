# 判断履歴の件数表示の最小仕様

関連: [Story](../stories/story-judgment-history-count-certainty.md)

- 正本APIのcoverage.completeとcoverage.totalを件数確定の根拠にする。records.lengthだけで全件数を確定しない。
- complete=trueかつtotalが非負整数なら「判断件数」「N件」を示す。ページが途中でもtotalを利用する。
- partialまたはunavailableなら、表示できたN件を「取得済み」と明示し、「全件数は未確認」を近接して示す。
- 未取得または壊れた応答は既存のエラー／未確認表示を保ち、0件へ変換しない。
- 絞り込みや検索で全件確定の前提が崩れる場合は、現在の表示対象件数として明示する。
- 対応するUIテストでcomplete・partial・empty partial・paginationを検証する。サーバーのcoverage契約を変更しない。

既知の制約: journal走査と公開projectionの上限、未接続取得元がある限り全件数は未確認のまま。今回の表示修正を完全取得の解消とは呼ばない。

実装正本: OSSの`ui/judgment-history.js`。組織側はこの共通UIを読み込む。利用可能なGraphifyツールがないため、実ファイル・呼び出し箇所と既存UIテストを直接確認した。影響は通常判断履歴の件数集計・表示に限定し、legacyの代理判断集計は変更しない。

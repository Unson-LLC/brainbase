# UNS-449 / UR-016・UR-017 確認

判断を毎日見返す利用者が、検索・期間・プロジェクト・判断したAIを一覧の直上で選べるようにする。仕事ページの常時表示インライン方式を採用した。
ポップオーバー維持は要求と合わず、組織ホストへのUIコピーは所有境界に反するため採用しない。
新しい色、書体、影、アニメーションは追加しない。既存の --bb-space-1/2/4、--bb-color-muted、--bb-font-size-xs を使い、トークン定義は変更しない。

## 結果

- `vitest run tests/ui/judgment-history.test.mjs`: 57件成功。inline・focus維持・検索・部分取得の件数の確実性を含む。
- 組織版のローカルpreviewと本ブランチの `/oss/` 資材をブラウザのrouteで合成し、1440×900 / 390×844、reduced motionで確認。
- 全期間16件 → 次のページで24件 → プロジェクト sample-b で8件。横スクロール、console/page error、壊れた画像なし（report.json）。
- after-* は全期間、before-* は変更前UIの既定期間。スクリーンショットでモバイルの折返しと操作の常時表示を確認。件数行のmuted色 #6b7280 はcanvas #f6f8faに対し約4.54:1、白に対し約4.83:1。
- プロジェクト・判断したAIの選択肢はnormalモード限定を維持。legacyは既存の期間・検索のクライアント集計を保持する。サンプルはnormal形式。

## ローカル再確認

対応する brainbase-organization のfixture PRを用い、`npm run preview:web` → `?screen=value-proofs`。
公開済み依存は変更していないため、本UIを確認するときはローカルの `/oss/` 配信を本ブランチの `ui/` へ向ける。一時的なプレビュー合成であり、正式取り込みはOSS公開後のexact pin更新が別途必要。
DB投入、migration適用、公開、配備は行わない。

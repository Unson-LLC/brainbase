# プロジェクトアイコンの仕様

共有Graphのproject限定で `metadata.icon: string` を保持する。組織版は正本payload.iconから投影する。未登録/削除はnull、外部URLとSVGは受け付けない。data:image/png|jpeg|webp;base64の画像を256KiBまで許可し、形式、base64、署名、容量を検証する。

既存Graph correctionへproject限定iconを追加する。他のフィールドを上書きしない。UIは名前横の画像、登録/変更・削除操作、選択画像のプレビュー、保存/キャンセル、理由を表示する。削除も保存前に確認できる。canCorrect/correctionScope、競合処理、保存readbackを既存訂正コントローラへ委譲する。理由と履歴で画像の長いデータを表示しない。

組織・テナント固有の生成画像と初期設定は共有OSSのdefaultsに置かない。UIモック資料: brainbase-project/docs/design/project-icons-2026-10-05。

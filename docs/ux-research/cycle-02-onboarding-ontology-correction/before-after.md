# 修正前後

| 意見 | 修正前 | 採用した修正 | 最終確認 |
|---|---|---|---|
| CUX-001 入力フォーム | MCP Inspectorには `Execute Tool` だけが表示され、入力欄がなかった | 公開スキーマを平坦化し、必要な7項目を表示 | `after-first-value-form.png`、`after-completion.png` |
| CUX-002 次の操作 | 状態とIDだけが返り、次に使うツールは利用者が推測する必要があった | 全結果に `runId` と状態別の `nextAction` を追加 | `after-next-action.png`、意図テスト |
| CUX-003 エラー復旧 | 「推論候補は承認できない」で止まり、復旧方法がなかった | 出典確認後の `edit` または `reject` を明示 | `after-recovery-error.png`、意図テスト |
| CUX-004 オントロジー理解 | 説明なしで完全な契約JSONから始まった | 1文の説明、5要素、例、次のツールを先に表示 | `after-ontology-guide.png`、意図テスト |
| CUX-005 前入力の残留 | 記録から評価へ切り替えると前の項目も再送され、厳格検証で失敗した | 不要な残留項目を受け止め、実行前に操作別の項目だけへ整形 | `after-completion.png`、意図テスト |

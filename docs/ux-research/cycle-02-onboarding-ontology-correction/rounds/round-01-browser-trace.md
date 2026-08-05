# 訂正評価・初回の実ホスト操作記録

操作画面: リポジトリでビルドした `brainbase-mcp` stdio serverへ接続したMCP Inspector 2.0.0。

評価者: Codexが4つの合成初心者視点を使って評価した。これは構造化された評価視点であり、実在する参加者ではない。発言、人間の所要時間、実端末、支援技術の証拠は収集していない。

## 共通の操作履歴

1. 実ホスト画面で `brainbase_onboarding_start` を開いた。
2. Driveは `ready`、Gmailは `waiting_for_authorization` として開始した。
3. 両方の接続状態と `runId` が結果に保持されることを確認した。
4. `brainbase_onboarding_ingest` で推論されたDecision候補を1件送り、`candidates_ready` になった。
5. `brainbase_onboarding_review` で推論候補の直接承認を試した。
6. エラーは `inferred candidates cannot be approved` だけで、復旧操作が書かれていないことを確認した。
7. `brainbase_onboarding_first_value` を開いた。
8. 公開JSON Schemaの最上位が `oneOf` だったため入力欄が表示されず、`Execute Tool` しか操作できないことを確認した。
9. `get_ontology` を開いた。
10. 結果が完全なバージョン付き契約から始まり、その前に初心者向けの全体像がないことを確認した。

## 証拠の範囲

- 収集済み: 実ホスト画面、ブラウザDOMスナップショット、スクリーンショット、MCPリクエスト履歴。
- 未収集: 実利用者の観察、実端末、スクリーンリーダー、タスク所要時間。

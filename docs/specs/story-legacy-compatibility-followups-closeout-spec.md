# 互換境界の追加検証・残件更新

Story: `docs/management/stories/active/story-legacy-compatibility-followups.md`

## 受入条件

1. 個別の変更結果を対応するStory・Specと結び、実装・検証済みの範囲と稼働環境で未確認の範囲を区別する。
2. Canonical Taskの切替手順は`CANONICAL_TASK_BACKEND=postgres`を明示する。変数未設定時は`disabled`としてTask APIだけを503で閉じ、NocoDBを暗黙選択しない。
3. 古いHEADのreadiness証拠を現行HEADの成功と扱わない。利用者認証不足や環境未確認は残件として保持する。
4. データ、秘密情報、ユーザー別設定、他作業の変更は削除しない。
5. 追加・更新した退役境界テストは既存のCIで実行する。本番への接続や権限をCIに追加しない。
6. `vibepro-graph-ssot-check.mjs`、`ontology-release-publish.js`、`generate-memory-preamble.mjs`はBearerを維持し、`x-brainbase-*`で権限を申告しない。トークン不足時の拒否と既存リクエスト内容を維持する。
7. Wikiの2本の保存データ調査スクリプトはdry-runで書き込まない。読取エラーを空結果や成功に変換せず、fixtureで確認する。実DBや保存済みデータの監査とは区別する。
8. 退役済みNocoDB MCPの手動追加案内を配布文書から除く。ユーザー別設定や外部コピーを勝手に変更しない。

## 検証

- `tests/server/scripts/preflight-canonical-task-cutover.test.js`の手順契約。
- `tests/server/bootstrap/canonical-task-backend-selection.test.js`の未指定backend契約。
- 各独立変更の対象テストと一度の統合レビュー。
- 本番反映は別途、対象HEAD・認証・API応答を読み戻して判定する。

# Spec: ルーティンの実完了と内容を一致させる

## 対象

- `server/services/routine-runtime/cycle-executor.js`
- `server/services/routine-runtime/production-routine-ports.js`
- 対応するサービス単体テスト

## 完了判定

- ohayo: `today_focus`、`ai_actions`、`immediate_decisions`、`warnings`、`carryovers` のいずれかに内容がある。
- oyasumi: `closed`、`consolidated_memories`、`associations`、`feedback_targets`、`unresolved_items`、`carryovers` のいずれかに内容がある。
- retro: `outcomes`、`decision_replays`、`changed_judgments`、`mistaken_assumptions`、`system_changes`、`repeated_patterns` のいずれかに内容がある。
- 元の状態が `completed` でも上記を満たさない場合は `partial` / `routine_content_empty` に降格する。
- 既に failed / partial の結果は上書きしない。

## 失敗診断

- executor の境界で例外を捕捉した場合、`code` に加えて処理段階と安全な要約を保存する。
- secret、token、SQL、stack trace は応答へ含めない。

## oyasumi の0件表現

未処理・矛盾・期限切れ・未配信がすべて確認済み0件なら、`closed` にその確認結果を1項目追加する。これは不足値を0へ変換する処理ではなく、全指標が数値0である場合だけ行う。

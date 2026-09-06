# Story: 委任タスクの追加指示を保った監査復旧

## 利用者価値

新規Codexタスクへ追加指示を送っても、最初のStopで依頼と追加制約を欠落させず判断契約を開始できる。

## 背景と範囲

Graphifyの新規タスク検証で同一turnにcreate_threadと後続send_message_to_threadが記録された。現行Hostは複数入力を一律拒否する。Graphify変更はこの処理を変更していない。実際の初回実行は中断されており、この問題を過去の最初のStopエラーの原因とは断定しない。

## 受け入れ基準

- [x] 同一turn・同一送り元の一意なcreate_threadに後続send_message_to_threadが続く場合、全入力を記録順に保持してStop復旧する。
- [x] 複数create、異なる送り元、作成前の追加指示、複数sendのみ、別turn/sessionの入力は推測結合しない。
- [x] 通常入力と単一委任の既存契約を保ち、復旧はpost_generation_recoveryとして記録する。
- [x] 回帰テストで修正前の失敗と修正後の成功を確認する。過去のjournalを書き換えず、実タスクE2Eと自動テストを区別する。

Spec: `docs/specs/delegation-input-chain.md`

## 検証結果

- 3入力の回帰はunitとHost入口統合で修正前に失敗、修正後に成功。
- Host unit 139件、Host入口統合22件、Stop・継続・managed-turn回帰13件が成功。
- 新規Codexタスクによる実運用E2Eはこの変更では未実施。初回中断後の別turnに過去の依頼を推測適用する処理は追加しない。

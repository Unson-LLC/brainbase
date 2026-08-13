---
spec_id: spec-brainbase-memory-routine-cycle
status: accepted
story: story-brainbase-memory-routine-cycle
architecture: docs/architecture/brainbase-memory-routine-cycle-architecture.md
---

# Brainbase記憶循環ルーティン仕様

## 公開契約

`runRoutine`は`routine`、`input`、`env`に加えて`executeCycle`を受け取る。標準経路は認証済みの`POST /api/routines/:routine/execute`から`RoutineCycleExecutor.execute`を呼ぶ。返された共通実行結果から既存`run_receipt.v1`を生成し、Outbox経由で送信する。

共通実行結果は`status`、`coverage`、`summary`、`evidence_refs`、`artifacts`を持つ。`artifacts`には必ず永続化済みの`routine_summary`を含める。ルーティン本体が実行されない場合や必須成果物が欠落する場合は`required_artifact_missing`を記録し、terminal successを合成しない。CLIは`completed=0`、`partial/waiting=2`、`failed/blocked=1`を返す。

## おやすみ

処理順は`reconcile`、`compressEpisodes`、`verifyRetrievability`とする。照合対象は未処理キュー、矛盾、期限切れ、Outboxである。Episode圧縮は判断、結果、未解決事項、対象event ID集合、版、ハッシュを持つ成果物を永続化し、対象全件の更新と再読取が成立した場合だけ完了する。検索不能または確認不能が1件でもあれば、表示可能な成果物を残しても`status=partial`、`coverage=partial`とし、異常を`artifacts.anomalies`へ残す。

## おはよう

生存診断から`listExceptions({ limit: 3 })`を呼び、優先順の最大3件を返す。GraphとPersonal KGの両方を想起する。生成ポート自身が表示対象を最大3件へ選び、Graphの`payload.derived_from_event_id`または正式な`kev_*`出典へ解決できた`used_knowledge_ids`だけへ利用結果を記録する。利用結果の記録失敗、Judgment Outboxの未配信、再試行、Dead Letterは、朝の表示を失わず`partial`にする。

## レトロ

誤登録率、訂正率、矛盾残数、処理時間、停止回数の5指標を評価する。標準期間は実行時刻までの7日間とし、イベント指標は`occurred_at`、訂正・却下指標は`feedback.created_at`で絞る。Run Receiptは3ルーティンについて同一runの再送を除外し、期間内の各最新runを集計する。改善候補は効果順に最大3件のStory／PR候補として返す。入力が部分的なら変更なしへ潰さず`coverage=partial`とする。本番ポリシー、Skill、Graphの更新ポートは依存として受け取らない。

## Codex Host Adapter

`createKnowledgeEventFromCompletedEpisode`はHost ID、episode ID、final digestから決定的なevent IDを作る。`status=completed`だけを変換し、親Episode ID、安全な最終回答本文、`codex://threads/...`形式の解決可能なsource pointerを保持する。本文がない判断を検索可能な記憶として成功扱いにしない。

出力へ`action_allowed`、外部作用の権限、Graph昇格許可を含めない。判断内容はEpisode層の観測として登録し、Graphへの昇格は通常の記憶登録ポリシーとRACI検証へ委ねる。

## TDDケース

1. 3コマンドはそれぞれ対応するRunnerを1回だけ呼ぶ。
2. おやすみは定義順で処理し、検索不能を部分成功にする。
3. おはようは例外を3件へ制限し、使った知識だけへ利用結果を記録する。
4. レトロは5指標と最大3候補を返し、本番状態を変更しない。
5. 同じ完了済みepisodeは同じ知識イベントIDになる。
6. 未完了episodeと行動許可に見える入力は、外部作用の権限を生成しない。
7. Routine Runnerは本体の結果だけからRun Receiptを作る。
8. 完了結果でも必須成果物がなければ失敗Receiptを作り、CLIは非zeroで終了する。
9. Episode圧縮は意味を持つ成果物の全件更新と再読取後だけ完了する。
10. レトロのfeedback期間はfeedback自身の作成日時で評価する。

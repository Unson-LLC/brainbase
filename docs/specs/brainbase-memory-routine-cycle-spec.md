---
spec_id: spec-brainbase-memory-routine-cycle
status: accepted
story: story-brainbase-memory-routine-cycle
architecture: docs/architecture/brainbase-memory-routine-cycle-architecture.md
---

# Brainbase記憶循環ルーティン仕様

## 公開契約

`runRoutine`は`routine`、`input`、`env`に加えて`executeCycle`を受け取る。標準経路は認証済みの`POST /api/routines/:routine/execute`から`RoutineCycleExecutor.execute`を呼ぶ。返された共通実行結果から既存`run_receipt.v1`を生成し、Outbox経由で送信する。

共通実行結果は`status`、`coverage`、`summary`、`routine_output`、`evidence_refs`、`artifacts`を持つ。`status`は処理成否、`coverage`は`confirmed|partial|unavailable`の確認範囲であり、同じ値を複製しない。`artifacts`には必ず完全な`routine_summary`を含め、その中に安全化済みの`routine_output`を保存する。ルーティン本体が実行されない場合や必須成果物が欠落する場合は`required_artifact_missing`を記録し、terminal successを合成しない。CLIは`completed=0`、`partial/waiting=2`、`failed/blocked=1`を返す。

## おやすみ

`/oyasumi`は睡眠のように1日の経験を整理・統合する夜間処理であり、「今日を閉じてよいか」の判定ではない。処理順は`reconcile`、`compressEpisodes`、`verifyRetrievability`とする。照合対象は未処理キュー、矛盾、期限切れ、Outboxである。Episode圧縮は判断、結果、未解決事項、対象event ID集合、版、ハッシュを持つ成果物を永続化し、対象全件の更新と再読取が成立した場合だけ完了する。

`routine_output`は`headline`、`sleep_state`、`sleep_causes`、`consolidated_memories`、`associations`、`feedback_targets`、`unresolved_items`を主成果物として返す。`deep`は4つの照合値が確認済み0件で圧縮と再読取が完了した場合だけ、`shallow`は残件または確認不能がある場合、`unconfirmed`は深浅を確定できない場合とする。浅い場合は原因、件数、記憶への影響を見出しと`sleep_causes`へ明示する。再編された各記憶には翌朝の訂正に使える正式event IDと`graph_ssot|personal_kg`の出典を付ける。

おやすみレポートは夜に生成・保存し、翌朝に読むが、`/ohayo`の成果物にはしない。互換欄として`tomorrow_focus`、`closed`、`carryovers`を残す。Personal KGへ仮記憶した内容は`personal_kg_memories`、明示確認が必要な例外は`personal_kg_review_exceptions`、Graph昇格待ちは`graph_promotion_reviews`へ分ける。既存利用者との互換用に全件を`personal_kg_registration_candidates`にも残す。通常のPersonal KG記憶はオプトアウト型とし、何もしなければ保持する。`candidate`状態だけを確認待ちと解釈せず、明示的な`requires_approval`または`needs_review`があるものだけを確認待ちにする。Graph昇格は別の明示承認とする。検索不能または確認不能が1件でもあれば、表示可能な成果物を残しても`status=partial`、`coverage=partial`とし、異常を`artifacts.anomalies`へ残す。

## おはよう

生存診断から`listExceptions({ limit: 3 })`を呼び、優先順の最大3件を返す。GraphとPersonal KGの両方を想起する。生成ポート自身が表示対象を最大3件へ選び、Graphの`payload.derived_from_event_id`または正式な`kev_*`出典へ解決できた`used_knowledge_ids`だけへ利用結果を記録する。利用結果の記録失敗、Judgment Outboxの未配信、再試行、Dead Letterは、朝の表示を失わず`partial`にする。`routine_output`は`headline`、`today_focus`、`immediate_decisions`、`warnings`、`carryovers`、`references`の順で返す。根拠はGraph SSOTとPersonal KGを区別する。

コマンド入口は、認証済みの全Googleアカウントの当日Calendarと未処理Gmail、および`salestailor`、`unson`、`techknight`のSlackを確認し、`input.day_view`へ渡す。取得元ごとの`source_coverage`は`confirmed|partial|unavailable`と対象範囲を持ち、`confirmed`以外を確認済み0件へ変換しない。

`today_focus`は今日変える状態であり、想起された記憶の並び順から生成しない。`ai_actions`は既存権限内でBrainbaseが進める作業、`immediate_decisions`は目的・価値・責任・追加権限など人間が決める事項だけを持つ。想起記憶は`references`へ残す。

Runnerは`day_view`のCalendar、Mail、Slack、優先事項を省略せず、`var/daily-ops-reports/ohayo-YYYY-MM-DD.html`と同名JSONへ保存する。CLIと`routine_summary`は短い判断面を返し、HTMLは各項目のリンクと証跡を含む詳細面とする。HTML生成または成果物参照に失敗した場合は完了扱いにしない。

## レトロ

誤登録率、訂正率、矛盾残数、処理時間、停止回数の5指標を評価する。標準期間は実行時刻までの7日間とし、イベント指標は`occurred_at`、訂正・却下指標は`feedback.created_at`で絞る。Run Receiptは3ルーティンについて同一runの再送を除外し、期間内の各最新runを集計する。改善候補は効果順に最大3件のStory／PR候補として返す。加えて、Personal KGで明示確認が必要な例外と、`pending_approval`のGraph昇格候補をレビュー項目として返す。`routine_output`は`headline`、`system_changes`、`repeated_patterns`、`personal_kg_registration_reviews`、`graph_promotion_reviews`の順とする。入力が部分的なら変更なしへ潰さず`coverage=partial`とする。本番ポリシー、Skill、Graphを変更するポートは依存として受け取らず、定期実行は`applies_changes=false`を守る。

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
11. 3ルーティンの先頭結論と詳細欄は同じ密度にせず、`routine_output`の固定階層を保つ。
12. `completed`でも一部ソースが未確認なら`coverage=partial`にできる。
13. 夜はPersonal KGへ仮記憶した全件、明示確認が必要な例外、Graph昇格レビュー待ちを分け、`candidate`だけを確認待ちにしない。
14. レトロは`pending_approval`候補を表示するが、候補状態やGraphを変更しない。
15. CLIと`routine_summary`成果物は朝だけでなく夜・週次の`routine_output`も保持する。
16. 夜は深い／浅い／未確認を分け、浅い場合は原因と影響を明示する。
17. 夜の圧縮成果は記憶、関連付け、正式event ID付き訂正対象としてCLIと成果物へ残る。
18. おやすみレポートは`/oyasumi`に属し、`/ohayo`の表示契約を変更しない。
19. おはようは収集元別の未確認を`partial`にし、確認済み0件と区別する。
20. おはようは今日の到達点、AIの作業、人間の判断、想起根拠を混ぜない。
21. おはようHTMLは要約上限を超える全項目とリンクを保持する。

---
story_id: story-brainbase-memory-routine-cycle
title: Brainbase記憶循環ルーティンのコード実行化
status: implemented
created_at: 2026-08-13
updated_at: 2026-08-14
architecture_docs:
  - docs/architecture/brainbase-memory-routine-cycle-architecture.md
spec_docs:
  - docs/specs/brainbase-memory-routine-cycle-spec.md
---

# Brainbase記憶循環ルーティンのコード実行化

## 背景

`/ohayo`、`/oyasumi`、`/retro`は、実行規則をMarkdownの指示として所有している。これではHostやmodelの解釈差により、同じ名前のルーティンでも処理順、完了条件、記録範囲が変わる。Run Receiptの生存確認を復旧しても、ルーティン本体が未実行のまま成功Receiptだけを作れる。

## User Story

Brainbase operatorとして、3ルーティンをリポジトリ管理の同じ実行器で動かし、結果と異常を同じ契約で確認したい。なぜなら、日々の記憶循環を文章解釈ではなく再現可能なコードとして運用したいから。

さらに利用者として、朝は「今日進めること」、夜は「今日を閉じてよいか」、週次は「来週から変える仕組み」を最初に理解したい。内部処理の完了報告を読み解かなくても、Graph SSOTとPersonal KGの中身に基づいて判断し、候補を正しい保存先へ送れるようにしたい。

## Acceptance Criteria

- [x] 3コマンドはRoutine Runnerを呼ぶ薄い入口だけを持つ。
- [x] `/oyasumi`は未処理、矛盾、期限切れ、Outboxを照合し、Episode圧縮後に検索可能性を確認する。
- [x] `/ohayo`は異常を最大3件提示し、GraphとPersonal KGを想起し、実際に使った知識だけへ利用結果を記録する。
- [x] `/retro`は5つの品質指標を評価し、最大3件のStory／PR候補だけを作る。
- [x] `/retro`は本番ポリシー、Skill、Graphを直接変更しない。
- [x] 完了済みCodex judgment episodeだけを冪等な`knowledge_event.v1`へ変換できる。
- [x] episode receiptに含まれる値を外部作用やGraph昇格の許可へ変換しない。
- [x] ルーティン本体の結果をRun Receiptへ渡し、本体未実行や必須成果物欠落を成功扱いにしない。
- [x] 3ルーティンは、内部処理とは別に、結論を先頭に置いた`routine_output`を返す。
- [x] `/ohayo`は「今日進めること」を先頭にし、直近判断、注意、持越し、Graph SSOT／Personal KGの根拠を段階表示する。
- [x] `/oyasumi`は「今日を閉じてよいか」を先頭にし、完了、持越し、明日の最優先、Personal KG登録候補、Graph昇格レビュー待ちを分ける。
- [x] `/retro`は「来週から変える仕組み」を先頭にし、反復パターン、改善案、Personal KGへの登録・確定レビュー、Graphへの昇格レビューを分ける。
- [x] Personal KGは「候補から登録・確定」、Graphは「承認済み候補の昇格」と呼び分ける。
- [x] 定期実行の`/retro`は候補を表示するだけで、Graph昇格を自動承認・自動実行しない。
- [x] `status`（処理結果）と`coverage`（確認範囲）を別々に返し、取得不能を確認済み0件へ変換しない。
- [x] CLIと永続成果物は3ルーティンすべての`routine_output`を保持する。

## 運用確認

3ルーティン7回連続の予定実行は、導入後の運用完了条件として追跡する。実装PRでは失敗注入を含む自動テストで、実行器、成果物、Run Receipt、Outbox、停止検知の契約を確認する。31013ランタイムと実データを使う一巡、7回連続、10分以内の検索可能性は、マージ後の運用確認として別に記録する。

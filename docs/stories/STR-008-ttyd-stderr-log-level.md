---
story_id: STR-008
title: ttyd起動バナーをerrorとして記録せず正しいログレベルに分類する
source_requirement:
  requirement_title: "brainbase自体のLokiログを分析し可観測性を損なうノイズを解消する"
architecture_docs:
  - kind: adr_unnecessary
    reason: ttyd子プロセスのstderr1行をシビリティ接頭辞でログレベルに振り分けるだけで、アーキテクチャ・データフロー・永続化・公開APIに変更はない。純粋関数1つの追加と既存stderrハンドラ1行の差し替えに閉じる。
status: in_progress
created_at: 2026-06-01
updated_at: 2026-06-01
---

# STR-008: ttyd起動バナーをerrorとして記録せず正しいログレベルに分類する

## 背景

brainbase の Loki error ストリームを直近で分析したところ、`level=error` の 300 行中 297 行が ttyd の正常な起動バナー（libwebsockets の `N:` notice / `W:` warning 行）だった。本物の error はわずか 3 件（exit copy mode 失敗 / worktree 付きセッション生成失敗 / sendInput タイムアウト）で、ノイズに埋もれて発見しづらい状態になっていた。

原因は `runtime-lifecycle-methods.js` の ttyd stderr ハンドラが、stderr のあらゆる出力を無条件に `logger.error` へ流していること。ttyd は通常の起動情報を stderr に書くため、起動するたびに error が大量発生していた。

## 誰が

brainbase の運用・監視を行う開発者として（Loki の error アラート/ダッシュボードと、ログ駆動の改善ループに依存している）。

## 何を

ttyd のログを失わずに維持したまま、ttyd の正常な起動バナーが `error` レベルで記録されない状態にしたい。本物の ttyd エラー（`E:`）は引き続き error として可視化されてほしい。

## なぜ

error ストリームが正常バナーで埋まると、本物の障害が見えなくなり、検知が遅れる。可観測性は監視とログ駆動の改善ループそのものの前提なので、error レベルは「対応が必要な事象」だけを表す必要がある。

## 受け入れ基準

- [ ] ttyd の `N:`(notice) / `D:`(debug) 行は error 以外（info）で記録される
- [ ] ttyd の `W:`(warning) 行は warn で記録される
- [ ] ttyd の `E:`(error) 行は引き続き error で記録される
- [ ] 複数行チャンクは最高シビリティで分類され、notice に混じった `E:` が降格されない
- [ ] ttyd のログ出力自体は失われない（レベルが変わるだけ）
- [ ] VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる

## スコープ外

- ttyd トークン（`N/W/E/D`）を持たない想定外 stderr の細分類は行わない（一律 warn で可視化）
- 空文字/null/undefined チャンクは info として扱い、別経路の異常検知は行わない
- ttyd stdout 側のログレベル（現状 info）の変更
- Loki / Promtail / Grafana の構成変更
- ttyd 本体や libwebsockets のログ書式の変更

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・誰が・何を・なぜ・受け入れ基準のみ。

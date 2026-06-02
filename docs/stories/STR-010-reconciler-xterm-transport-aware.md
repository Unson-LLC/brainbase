---
story_id: STR-010
title: xterm transport 時に reconciler が ttyd 欠落で churn しないようにする
source_requirement:
  requirement_title: "brainbaseの自己復旧ループが収束せず無駄処理とログノイズを出す不具合を解消する"
architecture_docs:
  - kind: adr_unnecessary
    reason: reconciler の分類条件に transport 判定を1つ足すだけで、アーキテクチャ・データフロー・永続化・公開APIに変更はない。ttyd前提の他経路（lifecycle/maintenance）には触れない、reconciler 内に閉じた変更。
status: in_progress
created_at: 2026-06-02
updated_at: 2026-06-02
---

# STR-010: xterm transport 時に reconciler が ttyd 欠落で churn しないようにする

## 背景

brainbase の Loki に `[PTY Watchdog] Runtime reconciliation recovered 36 issue(s)` が約30分ごとに、毎回ほぼ同数で出続けていた。

本番は `BRAINBASE_TERMINAL_TRANSPORT=xterm`（tmux + WebSocket）でターミナルを提供しており、ttyd プロセスは実際に1つも動いていない（ttyd は現行アーキでは live 機構ではない）。ところが terminal reconciler は、active かつ tmux 生存・永続 `ttydProcess` レコード有り・実 ttyd 観測 0 のセッションを `stale_ttyd_process`（DEGRADED）と分類し、PTY Watchdog が毎サイクル `forceTtyd:true` で ttyd を reconnect していた。xterm 機構では ttyd は定着しないため、翌サイクルもまた同じセッションが stale 判定となり、収束しない churn（無駄な ttyd 起動 + ログノイズ）が続いていた。

実測でも ttyd プロセス 0、active 50 セッション全てで観測 ttyd 0 を確認した。

## 誰が

brainbase の自己復旧（PTY Watchdog / terminal reconciler）と運用監視に依存する開発者として。

## 何を

ターミナルの live transport が xterm のときは、ttyd の欠落を異常（stale）として扱わず、reconciler が ttyd を毎サイクル再接続しない状態にしたい。tmux 生存ベースの健全性判定で十分なセッションを DEGRADED 扱いしないでほしい。

## なぜ

ttyd が live 機構でない構成で ttyd 欠落を「壊れている」と判定すると、自己復旧が無限に空振りし、無駄な ttyd 起動とログノイズで本来の異常検知が埋もれる。reconciler は実際の transport を前提に健全性を判定する必要がある。

## 受け入れ基準

- [ ] xterm transport 時、active + tmux 生存 + 永続 ttydProcess + 実 ttyd なし のセッションを `stale_ttyd_process` 扱いせず DEGRADED にしない
- [ ] ttyd transport 時は従来どおり `stale_ttyd_process` で DEGRADED 分類する（既存挙動を維持）
- [ ] xterm transport で recover 実行時、該当セッションに `reconnect_ttyd` アクションを出さない（churn 停止）
- [ ] VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる

## スコープ外

- `_isXtermOnlyMode()` の env gate（`BRAINBASE_TEST_MODE !== 'false'` 条件が本番 xterm を除外している件）の修正は別 Story（lifecycle/maintenance 等多数経路に波及するため）。
- `duplicate_ttyd` / `ttyd_port_conflict` 分類（xterm では観測 ttyd が 0 のため自然に発火しない）の変更。
- ttyd transport 構成での挙動変更。
- 永続 `ttydProcess` レコードのクリーンアップや状態スキーマ変更。

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・誰が・何を・なぜ・受け入れ基準のみ。

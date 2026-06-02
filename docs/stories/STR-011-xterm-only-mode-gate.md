---
story_id: STR-011
title: 本番を xterm-only と正しく認識させ ttyd-vestigial churn を解消する
source_requirement:
  requirement_title: "brainbaseの本番端末transportとttyd前提コードのミスマッチによる無駄処理を解消する"
architecture_docs:
  - kind: adr_unnecessary
    reason: 既存フラグ _isXtermOnlyMode の評価条件から stale なロールアウト用 clause を1つ外すだけで、新しいアーキ・データフロー・永続化・公開APIは導入しない。本番が実際に採用している xterm transport を、判定関数に正しく反映させる是正変更。
status: in_progress
created_at: 2026-06-02
updated_at: 2026-06-02
---

# STR-011: 本番を xterm-only と正しく認識させ ttyd-vestigial churn を解消する

## 背景

本番 (launchd) は `BRAINBASE_TERMINAL_TRANSPORT=xterm`（tmux + WebSocket）で端末を提供し、ttyd プロセスは1つも動いていない。ところが `_isXtermOnlyMode()` は `transport === 'xterm' && BRAINBASE_TEST_MODE !== 'false'` の AND 条件で、本番は `TEST_MODE='false'` のため **false を返す**。この `&& TEST_MODE !== 'false'` は xterm-only を test/dev で先行有効化しつつ本番は ttyd を残したロールアウト時の名残で、本番も xterm transport に切られた今は stale。

結果、本番では ttyd 前提コード（startTtyd/ensureTtyd の spawn、runtime scan、restoreActiveSessions の ttyd 復元、repairActiveTtydSessions）が生きたまま。特に `repairActiveTtydSessions` は PTY Watchdog から毎サイクル呼ばれ、ttyd を実際に spawn → 11秒タイムアウトで失敗（Loki: `ttyd port ... did not become ready within 10000ms`）を繰り返し、watchdog をブロックしていた。

## 誰が

brainbase の自己復旧（PTY Watchdog / maintenance）と運用監視に依存する開発者として。

## 何を

本番のように terminal transport が xterm のときは、test mode の値に関わらず xterm-only と認識され、ttyd-vestigial な scan/restore/repair/spawn が走らない状態にしたい。ttyd transport 構成では従来どおり ttyd を扱ってほしい。

## なぜ

本番が xterm なのに ttyd 前提コードが生きていると、自己復旧が毎サイクル ttyd を起動して失敗し、watchdog をブロックし、ログを汚し、本来の異常検知を埋もれさせる。判定関数は実際の transport を正本にすべきで、test mode をゲートに混ぜるべきではない。

## 受け入れ基準

- [ ] `transport === 'xterm'` のとき、`BRAINBASE_TEST_MODE` の値に関わらず `_isXtermOnlyMode()` が true を返す
- [ ] xterm-only 時、`repairActiveTtydSessions` は早期 return し ttyd 修復（spawn）を試みない
- [ ] ttyd transport 構成では従来どおり、`repairActiveTtydSessions` が active セッションを検査し、`startTtyd` が ttyd spawn の環境変数を設定する（既存挙動を維持）
- [ ] VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる

## スコープ外

- session open/takeover の xterm-only 分岐（`runtime-handlers.js` の ttyd プロセス再利用チェック skip）の挙動自体の再設計。xterm では ttyd プロセスが無く skip が正しいため本変更で有効化されるが、新たな仕様変更は加えない。
- ttyd transport 構成の挙動変更。
- 永続 `ttydProcess` レコードのクリーンアップや状態スキーマ変更。
- develop に既存の pre-existing なテスト失敗（pg/画像プレビュー/modal-dom 等、本変更と無関係）の修正。

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・誰が・何を・なぜ・受け入れ基準のみ。

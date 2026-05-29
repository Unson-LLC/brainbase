---
story_id: story-active-indicator-pane-spinner-unchanged-drop
title: pane-title フォールバックの 30 秒未変化ドロップで Claude 稼働インジケータが消える
status: implemented
horizon: M1
view: runtime
period: 2026-05
reason: 既存 _getPaneTitleActivityStatuses の未変化タイムアウト定数を 30s→30min に揃える局所修正。責務分担・依存関係・公開境界・データ構造を変えない。pane/スピナー文字消失の即時ドロップは維持。
architecture_docs:
  - path: docs/session-activity-indicator-lifecycle.md
    status: accepted
spec_docs:
  - path: docs/specs/story-active-indicator-pane-spinner-unchanged-drop-spec.md
    status: accepted
source_requirement:
  requirement_title: Claude セッションのインジケータが青→無印に変わる(working→idle)経路を塞ぐ
---

# pane-title フォールバックの 30 秒未変化ドロップ修正

## Background

ユーザー報告: 「インジケータが青になった後、無印に変わる。青→無印に変わるルートなんて存在しないよな？」。
その通りで、working→idle は本来あってはいけない遷移。working は done にしか移らないはず。

[[story-active-indicator-claude-toolless-staleness]] (PR #888) で explicit heartbeat の
5 分 staleness は 30 分に直したが、ユーザーが実際に見ていたのは**別経路**だった。実機調査:

1. `/api/sessions/status` を時系列で観測 → Claude セッションは confidence=`fallback`
   (`lastEventType: tmux-pane-title-spinner`) で青くなっていた。explicit hook が届かず
   pane-title フォールバックに依存している状態。
2. 生の tmux 行: `session-xxx\t⠂ Claude Code`。`⠂` は braille で `PANE_TITLE_SPINNER_CHARS`
   に含まれ認識される。フォールバック 1 回目では working として返る。
3. しかし `_getPaneTitleActivityStatuses` は「タイトルが `PANE_TITLE_SPINNER_UNCHANGED_TIMEOUT`
   (=30s) の間変化しない」と working から落とす。Claude の braille スピナーは pane title 上では
   ゆっくりしか進まず、思考 / 長文生成 / ツール待ちの静止区間で 30s 超の未変化が普通に起きる。
   → **作業中なのに 30 秒で青→無印**。これが報告の主経路。

未変化ドロップは本来「スピナーがフリーズ＝プロセスがハング」を検出する意図だが、30s は
Claude の進行速度に対して短すぎ、正常稼働を誤判定していた。

## Change

`server/services/session-core/activity-service-methods.js`:

- `PANE_TITLE_SPINNER_UNCHANGED_TIMEOUT` を 30s → 30 分に変更し、explicit 側の
  `CLAUDE_WORKING_TIMEOUT` / `STALE_TURN_TIMEOUT` と揃える。
- pane が一覧から消える (`PANE_TITLE_SPINNER_STALE_TIMEOUT` 30s) / スピナー文字が消える
  (idle/done タイトルに変わる) 場合の即時ドロップは従来どおり維持。
- braille が進む (タイトル変化) たびに未変化タイマーがリセットされるので、正常稼働は
  事実上無制限に working を保ち、真にフリーズしたスピナーのみ 30 分で打ち切る。

これで working 中は青を維持し、終了時はスピナー文字消失で落ちる（青→無印 mid-work を解消）。

## Acceptance Criteria

- [x] Claude の braille スピナーが 30s 以上未変化でも 30 分以内なら `getSessionStatus` で working を保つ
- [x] 真にフリーズした(30 分超未変化)スピナーは `getSessionStatus` から落とす
- [x] スピナー文字が消えたら(idle/done タイトル)即落とす(従来挙動維持)
- [x] braille が進めば(変化すれば)未変化タイマーがリセットされ working を継続する

## Implementation Evidence

- `server/services/session-core/activity-service-methods.js`: `PANE_TITLE_SPINNER_UNCHANGED_TIMEOUT` 30s→30min + コメント
- `tests/unit/activity-service-methods.test.js`: `_getPaneTitleActivityStatuses` の describe を追加(5 テスト)。pre-fix(30s) では未変化 5 分ケースが落ちる
- `tests/e2e/story-active-indicator-pane-spinner-unchanged-drop-report-activity.spec.ts`: AC1-4 を getSessionStatus 経由で固定

## Known Limitations (accepted tradeoff)

- 未変化タイムアウトを 30s→30 分にしたことで、**プロセスがハングしたまま pane title に
  スピナー文字が描かれ続ける**ケース（tmux プロセスが wedge / ツール呼び出しで固まる /
  端末がフレーム途中で凍結）では、青の working インジケータが最大 ~30 分残り得る。
  これは「作業中なのに 30 秒で消える」誤検知(false-negative)を解消するための意図的な
  トレードオフで、explicit hook セッションには影響しない。pane が閉じれば 30s (STALE) で、
  スピナー文字が done/idle タイトルに変われば即座に落ちる。30 分という上限は explicit 側の
  `CLAUDE_WORKING_TIMEOUT` / `STALE_TURN_TIMEOUT` と揃えた値で、稼働表示の寿命を turn 寿命と
  一致させる狙い。中間段階（数分で dim/二次トーンに落とすなど）でハング中を区別する案は
  将来の改善候補として別途検討する。

## Out Of Scope

- explicit activity-bridge hook が一部セッションで届かない根本(別調査)。本修正はフォールバックを
  堅牢化して hook 不達時でも working を維持する安全網にする
- 終了時に done(緑) ではなく無印になるケース(explicit Stop hook 不達時)。done への解決は別Story
- Codex 経路のスピナー挙動(braille は Codex も使うため本修正の恩恵を受けるが意図変更はしない)

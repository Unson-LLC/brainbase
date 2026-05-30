---
story_id: story-session-hook-provisioning-backfill
title: 非brainbaseプロジェクトのセッションにhook登録ファイルを補完し稼働インジケータを機能させる
status: implemented
horizon: M1
view: runtime
period: 2026-05
reason: SessionStart 配布スクリプトに「settings.json 不在時のみ L2 から hook 登録ファイルを補完する」分岐を追加する局所修正。brainbase worktree は settings.json 既存ガードで対象外、上書きしないため dirty 退行を起こさない。
architecture_docs:
  - path: docs/session-activity-indicator-lifecycle.md
    status: accepted
spec_docs:
  - path: docs/specs/story-session-hook-provisioning-backfill-spec.md
    status: accepted
source_requirement:
  requirement_title: 別プロジェクトのセッションで稼働インジケータが最初から最後まで無印のままになる問題を解消する
---

# 非brainbaseプロジェクトのセッションへ hook 登録ファイルを補完

## Background

ユーザー報告:「『脆弱性発見』セッションは最初から最後までインジケータに変化がない（中で AI は動いているのに）」。

サーバ↔フロント比較で特定した真因:

- `session-1780151846829`「脆弱性発見」(claude, active) の worktree は **別プロジェクト**(`…-g1-dialog_ai_infra`)。
- サーバ `/api/sessions/status` は当該セッションを **ABSENT**(activity が一度も報告されていない)で返す → フロントは正しく idle 描画。
- worktree の `.claude/` に **`settings.json`(hook 登録) と `scripts/run-hook.sh`(実行基盤) が無い**(`.ts` 本体や core/lib は存在)。
- 結果 activity-bridge フックが登録・実行されず explicit heartbeat ゼロ。当日 hook ログ無し・state.json にも当該セッション無し。
- pane title は静止 `✳ <task>` で braille スピナーでないため pane-title fallback も拾えない(`✳` は常時表示で working signal にならず追加不可)。

根本原因: SessionStart の slim 配布 `session-start-copy-plugins.sh` は設計上
「settings.json / run-hook.sh は brainbase repo に git-tracked だから worktree 作成時に既に存在する」
と仮定している。これは **brainbase 自身の worktree では真**だが **別プロジェクトの worktree では偽**で、
hook 登録ファイルを欠いたまま稼働インジケータが永久に無印になる。

## Change

`session-start-copy-plugins.sh` に「**`.claude/settings.json` が無い場合のみ** L2 から hook 登録 +
実行基盤を補完する」分岐を追加:

- `settings.json` ← `$L2_CLAUDE/settings.json`
- `scripts/run-hook.sh` ← L2(+ chmod +x)
- `scripts/hooks/{post-tool-use,user-prompt-submit,stop}/activity-bridge.mjs` ← L2(node 高速経路用、無ければ run-hook.sh は tsx に fallback)

`settings.json` の有無をガードに使うことで、**brainbase worktree(git-tracked で既存)には一切触れず**、
過去に肥大化 cp が起こした "dirty 1000件" 退行を再発させない。SessionStart 毎に走る self-healing 方式。

## Acceptance Criteria

- [x] settings.json が無い worktree では SessionStart hook が settings.json と run-hook.sh を L2 から補完する
- [x] 補完された settings.json は activity-bridge PostToolUse フックを登録している
- [x] settings.json が既存(brainbase worktree)なら上書きしない(dirty 退行防止)
- [x] activity-bridge .mjs バンドルも補完され run-hook.sh が node 高速経路を使える

## Implementation Evidence

- `.claude/hooks/session-start-copy-plugins.sh`: settings.json 不在ガード付き補完ブロックを追加
- `tests/e2e/story-session-hook-provisioning-backfill-contract.spec.ts`: 一時 worktree で実 hook を実行し
  補完(ac:1/2/4)と非上書き(ac:3)を検証(4 passed)
- 手動 smoke: settings.json 無しの temp dir で hook 実行 → settings.json / run-hook.sh / .mjs 補完を確認

## Out Of Scope

- 既に起動中のセッション(Claude Code は settings.json をセッション開始時に読むため、補完は次回起動から有効)。
  現行の「脆弱性発見」セッションは worktree を手動補完しても再起動まで反映されない
- セッション**作成時**の provisioning 本体(本修正は SessionStart の self-healing で補完する方式)
- `.sample`(setup.sh 用テンプレ。live hook が tracked で存在するため通常未使用)
- pane-title fallback の `✳` 認識(常時表示で working signal にならないため対象外)

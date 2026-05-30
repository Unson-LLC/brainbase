---
spec_id: spec-session-hook-provisioning-backfill
story_id: story-session-hook-provisioning-backfill
status: accepted
---

# Spec: SessionStart hook による hook 登録ファイル補完

## Invariants

- `session-start-copy-plugins.sh` は `.claude/settings.json` が **存在しない** 場合のみ補完を行う。
  存在する場合(brainbase worktree 等)は settings.json / run-hook.sh / .mjs を一切上書きしない。
- 補完元は `$L2_CLAUDE`(= `/Users/ksato/workspace/code/brainbase/.claude`)。
- 補完対象: `settings.json`、`scripts/run-hook.sh`(実行権限付与)、
  `scripts/hooks/{post-tool-use,user-prompt-submit,stop}/activity-bridge.mjs`。
- 各コピーは best-effort(`|| true`)で、失敗しても SessionStart hook 全体は成功扱いで継続する。
- 補完は冪等(一度補完すると settings.json が存在するため次回はスキップ)。

## Scenarios

### S1. 別プロジェクト worktree(settings.json 不在)への補完 flow

1. SessionStart hook が cwd=worktree で起動
2. `.claude/settings.json` が存在しない
3. L2 から settings.json / run-hook.sh / activity-bridge .mjs をコピーする state transition
4. 以降 activity-bridge フックが登録・実行され explicit heartbeat が届く

### S2. brainbase worktree(settings.json 既存)は非上書き

1. `.claude/settings.json` が git-tracked で既に存在
2. 補完ブロックの `[ ! -f settings.json ]` ガードが false
3. settings.json / run-hook.sh / .mjs を一切変更しない → working copy が dirty にならない

### S3. 補完後の hook 登録内容

1. 補完された settings.json の `hooks.PostToolUse` に activity-bridge を実行する command がある
2. 補完された run-hook.sh は `.mjs` があれば `node` で実行する分岐を持つ(無ければ tsx fallback)

## Contracts

- 補完は SessionStart 毎に評価される self-healing 動作。既存セッションの稼働インジケータは
  Claude Code が settings.json をセッション開始時に読むため、補完反映は次回起動からとなる。

## Anti-patterns (this fix avoids)

- 別プロジェクト worktree が hook 登録ファイルを欠き、activity-bridge が発火せず稼働インジケータが永久無印
- settings.json/hooks を無条件 cp して brainbase worktree の git-tracked 版を上書きし "dirty 1000件" 退行を起こす

## Verification

- `tests/e2e/story-session-hook-provisioning-backfill-contract.spec.ts`
  - ac:1 settings.json 不在 → settings.json + run-hook.sh 補完
  - ac:2 補完 settings.json が activity-bridge PostToolUse を登録
  - ac:3 settings.json 既存 → 非上書き(sentinel 不変)
  - ac:4 .mjs 補完 + run-hook.sh の node 分岐

## Out Of Scope

- 起動中セッションへの即時反映(次回起動から有効)
- セッション作成時 provisioning 本体
- pane-title fallback の `✳` 認識

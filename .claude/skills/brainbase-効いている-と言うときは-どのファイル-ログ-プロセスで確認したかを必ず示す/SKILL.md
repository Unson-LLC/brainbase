---
name: brainbase-効いている-と言うときは-どのファイル-ログ-プロセスで確認したかを必ず示す
description: 「効いている」と言うときは、どのファイル/ログ/プロセスで確認したかを必ず示す
---

# brainbase-効いている-と言うときは-どのファイル-ログ-プロセスで確認したかを必ず示す

## Trigger
- Use when this pattern appears: 「効いている」と言うときは、どのファイル/ログ/プロセスで確認したかを必ず示す

## Steps
- repo: /Users/ksato/workspace/code/brainbase
- runtime server: http://localhost:31013
- current worktree/session: /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1774143351256-brainbase
- branch: develop
- .claude bootstrap は server/services/session-manager.js に入っていて、worktree には .claude/settings.json / skills は存在する
- Codex hook bridge 実装は scripts/codex-app-repl.mjs に入れ、scripts/ensure_session_runtime.sh の BRAINBASE_CODEX_APP_SERVER default は 1 に変更済み
- 単体テストは通っている:
- tests/unit/codex-app-repl.test.js
- tests/unit/server-session-manager.test.js
- tests/server/session-manager-env.test.js
- この session-1774143351256 はまだ旧経路で動いている
- 実プロセスは `codex resume 019d1a7a-...` で、codex-app-repl.mjs ではない
- .claude/output/codex-app-server/session.json はまだ無い
- userpromptsubmit log はあるが 2026-03-25 01:23 の古い実行痕跡だけ
- つまり「server 再起動」ではなく「この tmux session 内 Codex の再起動/切替」が必要
- 実際に session-1774143351256 を新経路へ切り替える
- その session で codex-app-repl.mjs が起動していることを確認する
- UserPromptSubmit hook がその session の入力時に実行されていることを確認する
- skills reminder が Codex に届いていることを確認する
- 確認は推測禁止。実プロセス、tmux、ログ、生成ファイル、必要なら Playwright/CLI で end-to-end まで見る
- 直したら「何が原因だったか」「何を変えたか」「どう確認したか」を簡潔に報告する
- `ps` / `tmux` 上で session-1774143351256 が codex-app-repl.mjs 経路になっている
- /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1774143351256-brainbase/.claude/output/codex-app-server/session.json が生成される
- UserPromptSubmit hook 実行の新しい痕跡が出る
- 実際の user turn 後に skills/context reminder が injected されていると確認できる
- 「効いている」と言うときは、どのファイル/ログ/プロセスで確認したかを必ず示す

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- specs/効いている-と言うときは-どのファイル-ログ-プロセスで確認したかを必ず示す

## Source
- Promoted from codex_session_log / success
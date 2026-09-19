# Session Hibernation Mutating Smoke（退役済み）

ADR-019により、Brainbaseがsessionをhibernate/resumeする機能は廃止された。この文書は履歴への入口だけを残す。旧POST手順を実行したり、削除済みruntimeを復元したりしない。

- task、worktree、terminal、processの所有者: Codex app/CLI。
- Brainbaseが受け取る実行証跡: Run Receipt。
- 過去のsession/archiveデータ: 読み取り専用の移行証跡として保護する。
- 現行の退役確認: `npm run test:run -- tests/server/bootstrap/development-runtime-boundary.test.js tests/server/routes/retired-capability.test.js`

設計判断: [ADR-019](../../architecture/ADR-019-codex-owns-development-runtime.md)。旧手順の原文はGit履歴に保存されている。

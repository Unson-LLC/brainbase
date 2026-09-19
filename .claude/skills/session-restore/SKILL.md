---
name: session-restore
description: "旧Brainbaseセッション復旧の廃止境界と、所有アプリへの案内"
---

# 旧Brainbaseセッション復旧は廃止済み

ADR-019により、Brainbaseは開発セッションの作成・復旧・worktree管理を行わない。
旧state.json/state.dbは移行証跡であり、現役セッションの正本ではない。
旧ファイルを編集したり、BRAINBASE_SESSION_IDを注入して復旧しない。

1. 利用者が指すタスクと所有アプリを確認する。
2. CodexのタスクならCodex app/CLIのタスク一覧・履歴で対象を特定し、その製品の再開操作を使う。
3. Claude Codeの会話ならClaude Codeが管理する履歴と再開操作を使う。Brainbaseの旧IDと同一とは推定しない。
4. 過去データの調査が必要な場合はread-onlyで扱い、現在のタスクへの対応が確認できない部分を未確認とする。

現在の所有境界: `docs/architecture/ADR-019-codex-owns-development-runtime.md`
退役API契約: `docs/brainbase-capabilities/capabilities/session.create.yml`

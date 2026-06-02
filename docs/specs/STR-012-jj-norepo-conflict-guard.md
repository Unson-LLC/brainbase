# Spec: STR-012 jj non-repo conflict inspection guard

Story: STR-012 / 受け入れ基準を検証可能な仕様句に落とす。

## 対象

`server/services/worktree-service.js`:
- `_isBenignConflictInspectError(output)`（新規 pure helper）
- `_hasWorkingCopyConflicts(workspacePath)` の catch 分岐

## 契約 (Spec Clauses)

- SPEC-1 (ac:1): `_hasWorkingCopyConflicts` が "There is no jj repo" を含む失敗を受けたとき、`logger.warn` を呼ばず false を返す。
- SPEC-2 (ac:2): "No conflicts found" を含む失敗時も `logger.warn` を呼ばず false を返す（既存挙動）。
- SPEC-3 (ac:3): 上記いずれの benign パターンも含まない一般的な jj エラー時は、false を返しつつ `logger.warn` を1回呼ぶ。
- SPEC-4 (ac:4): 本 Story は VibePro dogfood として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる。

## 不変条件

- `_isBenignConflictInspectError` は "No conflicts found" または "no jj repo"（大文字小文字非依存）にマッチしたときのみ true。
- conflict が実在する場合（resolve --list 成功で conflict 行あり）は従来どおり true を返し warn しない。

## 非目標

- 非 jj worktree の生成原因の修正、conflict 判定基準の変更は対象外。

---
story_id: story-brainbase-production-artifact-reconciliation
status: accepted
---

# Spec: production artifact reconciliation

## CL-001 ホットフィックの同一性

本番4ファイルの差分は保全commitとpatch IDで一致し、Remote Hook、Judgment Host、Ontologyの対象テストと型検査が合格した場合だけPRへ進める。

- Story: AC-001, AC-002
- Code: `mcp/brainbase/src/remote-judgment-hook-http.ts`, `scripts/codex-hooks/judgment-resolver-host.mjs`
- Test: `mcp/brainbase/tests/auth/remote-judgment-hook-http.test.ts`, `tests/unit/judgment-resolver-host.test.js`, `tests/server/services/ontology-registry.test.js`

## CL-002 内部状態toolの監査例外

空のPostToolUse監査出力を受理する例外は`mcp__brainbase__brainbase_judgment_state_record`の完全名だけとし、短縮名、別名、他toolは`judgment_hook_audit_not_recorded`でfail closedにする。

- Story: AC-001, AC-007
- Code: `mcp/brainbase/src/remote-judgment-hook-http.ts`
- Test: `mcp/brainbase/tests/auth/remote-judgment-hook-http.test.ts`

## CL-003 Claude MCP応答の成功判定

content block配列とJSON文字列は意味的成功条件を再検証する。検索監査行欠落、error状態、壊れたJSONは成功としない。

- Story: AC-001, AC-007
- Code: `scripts/codex-hooks/judgment-resolver-host.mjs`
- Test: `tests/unit/judgment-resolver-host.test.js`

## CL-004 本番配備readback

merge後の配備receiptは直前SHAとmerge SHAを保存し、checkout、process、`/api/version`のSHA一致と`dirty=false`を個別に検査する。不明値は一致やfalseに丸めない。

- Story: AC-002, AC-003, AC-007
- Evidence: Lightsail deployment receipt and public `/api/version` readback

## CL-005 OntologyとGraphの同一run検証

公開鍵overrideだけを削除し、秘密鍵と`key_id`の値を証拠へ出力しない。再投影後の同一runでOntology 1.1.0のGit信頼ストア署名検証と`graph_validate(project_code=brainbase)`を実行し、HTTP 200、`collection_complete=true`、構造違反0件、Ontology違反0件、`valid=true`がすべて揃った場合だけ完了とする。

- Story: AC-004, AC-005, AC-006, AC-007
- Evidence: redacted projection receipt, Ontology trust readback, authenticated Graph validation response

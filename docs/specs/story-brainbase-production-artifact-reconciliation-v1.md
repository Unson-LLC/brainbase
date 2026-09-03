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

content block配列とJSON文字列は、search、retrieve、route、write、state、value_proof、汎用callの各event kindで意味的成功条件を再検証する。検索・取得監査行欠落、error状態、壊れたJSON、意味的証拠のない汎用callは成功としない。

- Story: AC-001, AC-007
- Code: `scripts/codex-hooks/judgment-resolver-host.mjs`, `server/services/routine-runtime/judgment-value-proof-adapter.js`
- Test: `tests/unit/judgment-resolver-host.test.js`, `tests/unit/judgment-value-proof-adapter.test.js`

## CL-004 4実行面の配備readback

merge後の配備receiptは、Global Codex lifecycle Hook、canonical local UI/API、persistent MCP Host bridge、Lightsail Resolver API/serverの各直前SHAとmerge SHAを保存する。各面のcheckout/reconcile receipt、process、version/readinessを独立して検査し、Git checkoutを持つ面は`dirty=false`を要求する。不明値は一致やfalseに丸めない。

- Story: AC-002, AC-003, AC-007
- Evidence: four-surface rollback capture, deployment receipts, local/public version and readiness readback

## CL-005 fresh taskによる実動確認

4実行面をmerge SHAへ揃えた後に2つの新しいCodexタスクを作成する。通常taskでJudgment episodeと完全なowner auditを実証して`judgment_lifecycle_active`とする。別の委譲taskで、実際の中断候補、Brainbase tool event、権限内の継続、実行成果物、正本読戻し、value proof、complete final、`owner_audit_source=stop_hook_system_message`、Codex UIまたはevent stream上のユーザー向け判断レシートを同一turnへ束縛する。assistant本文への監査行複製や不安定なJSONL transcript表現をHook表示の代替証拠にしない。両taskの証拠が一意に対応した場合だけ`proven_active`とする。既存タスク、readiness、synthetic entrypoint testは代替にしない。

- Story: AC-002, AC-003, AC-007, AC-008
- Regression: `tests/integration/judgment-resolver-host-entrypoint.test.js`で`create_thread`由来の委任入力、同一turnのvalue proof、complete final、Stop `systemMessage`として返す`Brainbase判断レシート`のexact-once表示を固定する
- Production acceptance: 通常taskを`tests/e2e/story-brainbase-judgment-resolver-v1-live-session.spec.ts`で検証し、別の委譲taskを`tests/e2e/story-brainbase-judgment-resolver-delegation-recovery-live-session.spec.ts`で検証する。各fresh Codex task id、exact merge SHA、episode/event/value-proof/final paths、assistant本文を対応するturnで読み戻し、Stop表示はCodex UIまたはevent streamで別途読み戻す。synthetic regressionだけでは`proven_active`にしない
- Normal live-session E2E: `tests/e2e/story-brainbase-judgment-resolver-v1-live-session.spec.ts`は通常taskの取得監査と`judgment_lifecycle_active`までを証明し、value proofと判断レシートのproduction acceptanceには数えない

## CL-006 OntologyとGraphの同一run検証

公開鍵overrideだけを削除し、秘密鍵と`key_id`の値を証拠へ出力しない。再投影後の同一runでOntology 1.1.0のGit信頼ストア署名検証と`graph_validate(project_code=brainbase)`を実行し、HTTP 200、`collection_complete=true`、構造違反0件、Ontology違反0件、`valid=true`がすべて揃った場合だけ完了とする。

- Story: AC-004, AC-005, AC-006, AC-007
- Evidence: redacted projection receipt, Ontology trust readback, authenticated Graph validation response

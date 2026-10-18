# Stage 3 OSS common contracts

## Story

OSS利用者が、実行結果と会議レビューの候補をBrainbaseの個人データ正本へ渡す前に、外部runtimeへ依存しない検証可能な契約を利用できるようにする。既存の個人知識・routine canonicalを再実装せず、実行記録と会議レビューの最小契約を公開package subpathとして提供する。

## Scope

- `@unson/brainbase-mcp/run-receipt` は、実行元、状態、証拠、再実行識別子、WMC投影を正規化する純粋関数を提供する。
- `@unson/brainbase-mcp/meeting-automation` は、会議から得たTask/Decision候補、送信前ドラフト、loop intentのscope検証を提供する。
- 3b（記憶・知識共通）は、既存の`personal-knowledge`、`knowledge-promotion`、`personal-memory`、`routines`をcanonicalとして維持する。新しい重複実装は追加しない。
- `ADR-003 D4`のPersonal KG SSOT、`oyasumi`とweekly scheduleを維持する。
- 会議provider、OAuth、runtime、DB保存、Graph判断event/outcome/outbox、外部送信は対象外とする。

## Acceptance Criteria

1. 実行receiptの必須項目、許可値、証拠、時系列、identity、禁止キーを純粋契約として検証できる。
2. OpenClawを含む実行元のidentityを`project_id`・`source.type`・`external_run_id`から決定的に分離できる。
3. 会議候補を最大5件まで検証し、Task/Decision候補を決定的に正規化できる。
4. フォローアップは`draft_only`かつ人間承認必須として返し、外部送信を実行しない。
5. 会議レビューは必須出力とloop intentのorg/project scopeを検証してからconsumerへ渡せる。
6. 既存の3b canonical、routine、会議minutes、判断系実装を削除・置換しない。

## Migration boundary

この変更はPhase Aであり、旧Unson pathの削除、公開package publish、本番readback、runtime切替は行わない。Phase Bは、公開packageのreadbackと実利用consumerの同等テストが確認された後に、別のレビュー可能な変更として扱う。

## Verification

- `npm run build`
- `npx vitest run tests/run-receipt.test.ts tests/meeting-automation.test.ts`
- `git diff --check`

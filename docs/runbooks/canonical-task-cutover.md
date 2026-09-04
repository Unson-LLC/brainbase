# Canonical Task 初回切替手順

このrunbookは、Brainbaseの既存NocoDB Task表を正本のまま維持しつつ、書込経路をCanonical Task APIへ一本化する初回切替を管理する。

## 所有する実行経路

- 事前検査: `scripts/preflight-canonical-task-cutover.js`
- 自動テスト: `tests/server/scripts/preflight-canonical-task-cutover.test.js`
- 実行: `npm run preflight:canonical-task-cutover -- --phase <phase>`
- 実環境証跡収集: `npm run capture:canonical-task-cutover -- --base-url <Brainbase URL> --mac-result <Mac read-only result> [--mac-source-root <transported snapshot>] --out-dir <directory>`
- 実Postgres並行検査: `npm run canonical-task:check-postgres-concurrency`
- 既存行の冪等キーbackfill: `npm run backfill:canonical-task-idempotency-keys -- --dry-run|--apply`
- Task移行（承認後のみ）: `npm run migrate:canonical-task-postgres-workflow -- --approve-apply`
- Postgres切替後の検索索引追加（承認後のみ）: `npm run migrate:canonical-task-search-indexes -- --approve-apply`
- readiness操作: `scripts/set-canonical-task-readiness.js`
- Postgres向けenable: `CANONICAL_TASK_BACKEND=postgres npm run canonical-task:readiness -- --enable --evidence <artifact>`
- disable: `npm run canonical-task:readiness -- --disable --reason <reason>`
- writer明示回復: `npm run canonical-task:recover-writer -- --expected-token <旧token> --expected-pid <旧PID> --new-token <新process token>`
- manifest差替え: `CANONICAL_TASK_STORE_MANIFEST`だけを許可する。base/tableの個別環境変数は禁止する。

## stale writer回復

異常終了後に503 `canonical_task_writer_unavailable` が出た場合だけ使用する。自動takeoverは行わない。

1. `canonical_task_writer.process_identity`のPID・entrypoint・source HEADを確認する。tokenは作業ログへ出力しない。
2. 旧PIDが停止済みであり、同じtokenを使用する別processが存在しないことを確認する。確認できなければ回復しない。
3. 稼働予定processの`BRAINBASE_SERVER_GENERATION`を新tokenとして固定し、
   `npm run canonical-task:recover-writer -- --expected-token <旧token> --expected-pid <旧PID> --new-token <新token>`を実行する。
   compare-and-swapが不一致なら他のoperator/processが状態を変更したため中止する。
4. 回復操作はreadinessを`writer_recovered_requires_reverification`でclosedにする。
   current HEADで必須証跡を再収集し、before-enable preflightを通す。
5. `CANONICAL_TASK_BACKEND=postgres npm run canonical-task:readiness -- --enable --evidence <artifact>`を実行する。
6. readiness、writer process identity、Task mutation、`task_store`承認materializationを読み戻して確認する。

## before-migration

1. 旧Brainbase process、Mana capture writer、NocoDB MCP mutation、5本の運用scriptを停止し、処理中要求を排水する。
2. `npm run preflight:canonical-task-cutover -- --phase before-migration`を実行する。
3. 静的writer検査とprocess evidenceの両方で、CanonicalTaskServiceを迂回する正本直接writerが0件であることを確認する。
4. 失敗時はmigrationを開始しない。

## before-enable

1. Postgres調停schemaとNocoDB Task列・冪等key unique migrationをapplyする。続けてTask移行を次の順で実行する。
   0. 冪等キーを持たない既存NocoDB行がある場合、先に`npm run backfill:canonical-task-idempotency-keys -- --dry-run`で
      対象件数と競合0件を確認し、before-migration相当のwriter排水を確認した上で`-- --apply`で
      `legacy:nocodb:<record-id>`形式の決定的キーを採番する。applyは競合検出時に書込前へ停止し、
      完了後に未設定行0件を再検証する。出力は件数のみで本文・secretを含まない。
   1. 本番applyの明示承認を作業記録へ残したoperatorだけが、`npm run migrate:canonical-task-postgres-workflow -- --approve-apply`を実行する。`--approve-apply`がなければ全phaseを開始せず拒否する。このコマンドだけが`dry-run -> check -> apply -> final-check`を順番に実行でき、途中失敗時は後続phaseへ進まない。
      dry-run/checkは旧本番にも存在する基礎スキーマを検査し、applyは`pg_trgm`を確認して検索索引を`CREATE INDEX CONCURRENTLY`で1本ずつ追加する。final-checkは検索索引の存在に加えて`pg_index.indisvalid = true`かつ`indisready = true`を含む完全スキーマを検査する。apply前にDB roleが拡張を作成できることを確認し、権限不足時は開始しない。並行索引作成の失敗で無効索引が残った場合はreadinessをclosedのまま維持し、DB運用者が該当名とvalid/ready状態を確認して無効索引だけを明示的に削除した後、workflow全体を先頭から再実行する。
   2. 各phaseの出力には本文やsecretを含めず、`source_count`、`target_count`、`matched_count`、`pending_count`、`inserted_count`、`conflict_count`だけを残す。
   3. `final_check_passed: true`、`pending_count: 0`、`conflict_count: 0`、`source_count`と`target_count`の一致を確認する。一致しなければreadinessをenableしない。
   4. `npm run migrate:canonical-task-postgres -- --apply`の直接実行は拒否される。row移行処理内の失敗は、そのrow移行transactionをrollbackする。一方、`CREATE INDEX CONCURRENTLY`はtransaction外で1文ずつ実行するため、失敗済み索引を自動rollbackしたとはみなさず、手順1のvalid/ready確認と無効索引の明示削除を行う。row移行のCOMMIT後または索引作成後にfinal-checkが失敗した場合、挿入済みrowや有効な索引は削除せずreadinessをclosedのまま維持し、原因を解消して冪等なworkflow全体を先頭から再実行する。
   active writerが存在しない排水済み状態で`npm run canonical-task:check-postgres-concurrency`を実行し、実operation repositoryへの同時2要求が1回だけ処理され、同一結果を返し、検査行と一時writerが削除されたことを確認する。既存writerが現れた場合は検査を中止する。
2. guardを含む新BrainbaseとMCPを起動する。process-local mutation gateがclosedで、mutationが503 `canonical_task_mutation_not_ready`になることを確認する。
3. 下記「必須証跡」の全回帰をcurrent HEADで実行する。Macはこの時点ではTask一覧の実HTTP読み取りと認証拒否だけを確認し、mutationは実行しない。
4. `npm run capture:canonical-task-cutover -- --base-url http://127.0.0.1:<port> --mac-result <Mac read-only result> --out-dir .vibepro/verification/canonical-task-cutover/checks`を実行し、実Postgres、実NocoDB、実Brainbase process、Mac read-only consumerの4 artifactを生成する。
   capture実行hostがMac resultのhostと異なる場合だけ、読み取り専用で運搬したsnapshotを
   `--mac-source-root <transported snapshot>`に指定する。snapshotはresultの`mac_checkout`と同じGit HEADの
   Git repositoryであり、resultの`raw_log`を元の`mac_checkout`からの同じ相対pathに置く。captureは元resultを
   一切書き換えず、snapshot HEAD、raw log hash、path containmentを再検証する。元の絶対raw logが元checkout外、
   相対pathがcheckout外へescape、snapshot root/raw logにsymlink、またはHEAD/hash不一致なら失敗する。
   snapshotのdirty状態はcleanとして扱わず、この手順はclean性を主張しない。`--mac-source-root`を省略した
   同一hostの既存手順は変わらない。
5. `npm run preflight:canonical-task-cutover -- --phase before-enable --backend postgres --evidence-out .vibepro/verification/canonical-task-cutover/before-enable.json --postgres-check .vibepro/verification/canonical-task-cutover/checks/postgres.json --nocodb-check .vibepro/verification/canonical-task-cutover/checks/nocodb.json --runtime-check .vibepro/verification/canonical-task-cutover/checks/runtime.json --mac-check .vibepro/verification/canonical-task-cutover/checks/mac.json`を実行する。証跡はbackend名とbackend固有のmanifest hashを固定し、別backend向け証跡の流用を拒否する。
6. `CANONICAL_TASK_BACKEND=postgres npm run canonical-task:readiness -- --enable --evidence .vibepro/verification/canonical-task-cutover/before-enable.json`を実行する。command-scopedのbackend指定により、手順5のPostgres向けartifactを同じbackend identityで再検証する。指定を省略すると安全側の`nocodb`として検証され、backend mismatchで失敗する。artifact、manifest、schema、writerのtransaction内再検証が失敗した場合はclosed rowを変更しない。稼働中processは各mutation前に永続rowを再照合するため、enable後の再起動は不要である。
7. mutationが解禁されることを確認する。再起動時は、新processが単一writerを取得し、保存rowのHEAD・manifest・schema・evidence hashが一致した場合だけwriter tokenをtransaction内で引き継いで開く。不一致ならclosedのままにする。
8. `TEST_MODE=true BRAINBASE_CANONICAL_TASK_LIVE_FIXTURE=1 npm run canonical-task:seed-live-fixture -- --ledger <workflow-ledger.json>`で、Mac実契約が使用する固定Human Stepを稼働中processの起動前に作る。担当者はCanonical Task manifestの`owner_person_id`から取得し、既に消費済みなら再利用せず失敗させる。
9. Brainbaseを起動し、APIの作成・再送・更新・競合・完了・承認materializationの実契約をMac testから確認してからMac Companionを反映する。

## デプロイ・再起動時のHEAD更新（enable後の通常運用）

Postgres正本への切替後に検索索引だけを追加する場合は、NocoDBとの行一致を再検査する初回移行workflowを再利用しない。
`npm run migrate:canonical-task-search-indexes -- --approve-apply`を実行し、基礎schema検査、transaction外の
`CREATE INDEX CONCURRENTLY`、`pg_index.indisvalid = true`かつ`indisready = true`の最終検査を順番に通す。
この経路はTask本文の参照・移行・更新を行わない。失敗時はreadinessを変更せず、無効索引が残った場合だけ
前節の手順どおり索引名とvalid/ready状態を確認して明示的に削除し、先頭から再実行する。

readiness rowは`source_head`を固定するため、enable後にデプロイでHEADが進んだ再起動は原則そのままでよい。
起動時に以下の決定論的ガードが自動で判定する（`server/services/companion/canonical-task-source-head-guard.js`）。

1. 保存rowの`manifest_hash`・`schema_version`・`evidence_hash`が現在processと一致し、`source_head`だけが不一致の場合、
   `git diff --name-only <旧HEAD>..<新HEAD>`をcanonical task関連パス
   （`server/services/companion/`、`server/sql/`、`server/bootstrap/core-services.js`、`config/canonical-task-store.json`）
   に限定して実行する。
2. 差分0件なら`source_head`を新HEADへtransaction内でrebindし、mutationは継続する。起動ログに
   `[canonical-task] readiness source_head rebound after guarded diff check` が残る。
3. 差分がある、旧HEADがローカルに存在しない、gitが失敗した場合はfail-closedを維持する
   （起動ログ: `source_head rebind refused`）。この場合はcanonical task系の変更を含むデプロイなので、
   before-enableの証跡フロー（手順3〜6）を新HEADで再実行してからenableし直す。

デプロイ後は必ず起動ログで`[canonical-task] writer claimed and persisted readiness verified`を確認する。
`mutation disabled: persisted_readiness_mismatch`のまま放置しない。手動SQLでの`source_head`書き換えは行わない。

## rollback

1. `npm run canonical-task:readiness -- --disable --reason rollback`で永続rowをclosedにし、mutationが503になることを確認する。
2. 必要ならMac CompanionまたはCanonical Task API受付を戻す。
3. Postgres schema、NocoDB列・unique、共有manifest、legacy/Mana/MCP guardは維持する。
4. `npm run preflight:canonical-task-cutover -- --phase rollback`を実行し、旧直接writerの起動コマンドと有効経路が存在しないことを確認する。
5. 旧writerは復活させず、forward fixする。

## 必須証跡

`scripts/preflight-canonical-task-cutover.js`と`tests/server/scripts/preflight-canonical-task-cutover.test.js`は、
次の固定allowlistを`required_evidence_ids`として共有する。artifactのID集合はこの集合と完全一致しなければならず、
未知ID、重複ID、欠落ID、`pass != true`、file hash欠落のいずれかがあればbefore-enableを失敗させる。

allowlistと生成元の唯一の正本は`config/canonical-task-evidence-registry.json`である。71件の各entryは
`producer_command`、`owner_path`、`test_command`、`artifact_path`、`artifact_schema`、
`pre_fix_assertion`を必須とする。証拠は登録済み`producer_command`で
`scripts/collect-canonical-task-evidence.js`を起動して生成し、collectorは現在HEAD、registry hash、
owner file hash、実行したtest command、終了codeをraw artifactへ保存する。
collectorはテスト結果から`matched_tests`と`matched_assertions`も保存し、どちらかが0の場合は
commandの終了codeが0でも`pass: false`として失敗させる。

`matched_tests`はrunnerごとの機械可読出力からevidence IDと完全一致するtest titleを数える。Vitestと
Playwrightはregistryの`runner_adapters`が指定する専用JSON reporter、Node testはTAP reporterを使う。
adapterはregistered test commandからeffective argvへの決定的変換とresult pathを正本化する。collectorは
shellを介さずargvでspawnし、registry指定の`VIBEPRO_EVIDENCE_ID`、`VIBEPRO_EVIDENCE_RESULT`、
64桁hex `VIBEPRO_EVIDENCE_NONCE`だけを明示envへ追加する。artifactは両command、env値、nonce hash、
adapter、reporter/result hashを保持する。custom reporterはfile SHA-256、Node TAPは
`sha256("node:<process.version>:node:test:tap")`を使う。env欠落、未登録env、template外引数、出力先差替えは拒否する。

各owner testは`withCanonicalTaskEvidence`へ全assertionのcallbackとrunner contextを渡す。helperはcallbackが
正常完了した後だけnonce付きfinal eventをattachment/diagnosticへ出す。専用reporterはfinal eventを現在のtest eventへ
関連付ける。title完全一致・passed・nonce一致・final event単一のeventだけを成功とし、global、別test、
failed/skipped、test終了後、raw手書きmarker、重複markerは拒否する。Node TAPもhelperが該当subtest block内へ
callback完了後に出したdiagnostic lineだけを認める。
process raw stdoutは別fileで保存しhashをartifactに含める。

preflightはregistry自体の71件完全一致と重複なしを検証した上で、raw artifactのIDとpath、schema、command、
owner path/hash、registry hash、source HEADをentryと照合する。別IDのartifact入替、未登録command、
owner変更後の古いartifact、失敗をpassとしたartifact、`matched_tests == 0`、`matched_assertions == 0`、
期待path以外のartifactをすべて拒否する。
preflightはrunner resultとraw runner outputを自身で再parseし、artifact記載の両count、event-marker相関、
reporter/result/stdout hashを照合する。collector/preflightのfixtureはzero test、zero marker、改ざんcount、
改ざんstdout、global forged marker、assertion前marker、failed/skipped test marker、別test marker、
duplicate marker、env欠落、result path差替え、reporter hash差替えを個別に失敗させる。

### BDDシナリオ証跡ID

`scenario.SC-001`, `scenario.SC-002`, `scenario.SC-003`, `scenario.SC-004`, `scenario.SC-005`,
`scenario.SC-006`, `scenario.SC-007`, `scenario.SC-008`, `scenario.SC-009`, `scenario.SC-010`,
`scenario.SC-011`, `scenario.SC-012`, `scenario.SC-013`, `scenario.SC-014`, `scenario.SC-015`,
`scenario.SC-016`, `scenario.SC-017`, `scenario.SC-018`, `scenario.SC-019`, `scenario.SC-020`,
`scenario.SC-021`, `scenario.SC-022`, `scenario.SC-023`, `scenario.SC-024`, `scenario.SC-025`,
`scenario.SC-026`, `scenario.SC-027`, `scenario.SC-028`, `scenario.SC-029`, `scenario.SC-030`,
`scenario.SC-031`, `scenario.SC-032`, `scenario.SC-033`, `scenario.SC-034`, `scenario.SC-035`,
`scenario.SC-036`, `scenario.SC-037`, `scenario.SC-038`, `scenario.SC-039`, `scenario.SC-040`,
`scenario.SC-041`, `scenario.SC-042`, `scenario.SC-043`, `scenario.SC-044`, `scenario.SC-045`,
`scenario.SC-046`, `scenario.SC-047`

### 横断回帰証跡ID

- `surface.auth.matrix`: bearer/internal/service許可とcookie-only/insecure-header拒否
- `surface.approval.inbox`: approval inboxの候補、安定ID、owner投影
- `surface.approval.resolve-run`: run配下resolve route
- `surface.approval.resolve-step`: human-step直下resolve route
- `surface.approval.non-task`: 非`task_store`承認
- `surface.workflow.get-run-reconcile`: getRun時の再投影
- `surface.workflow.retry-reconcile`: retry時の再投影
- `surface.workflow.audit-idempotency`: 監査upsertと重複なし
- `surface.writer.claim-reconcile`: listen前claim/reconcile
- `surface.writer.release-recover`: graceful releaseと明示回復
- `surface.readiness.closed-start`: 起動時closedと保存row再検証
- `surface.readiness.atomic-enable`: current HEAD/hash/schema/writerのtransaction検証
- `surface.readiness.explicit-disable`: rollback先頭の明示disable
- `surface.legacy.route`: 旧routeのread/非正本write/正本guard
- `surface.legacy.ui`: waiting/urgent/unknown投影
- `surface.mana.auth-retry-read`: session/CSRF、actor、再送、read、no-fallback
- `surface.browser.mutations`: list/create/update/transition/deleteとcookie-only無効化
- `surface.mcp.write-fence`: record/column mutation guardとread互換
- `surface.delete.recovery`: prepared停止、削除後停止、actor分離
- `surface.operational-scripts`: 5本の運用scriptの直接writer 0件
- `surface.migrations.postgres`: operation/writer/readiness schema apply/check
- `surface.migrations.nocodb`: 必須列と冪等key unique apply/check
- `surface.mac.wire-contract`: 固定fixtureと実route schema
- `surface.runtime-path`: current HEADから起動したprocessのcwd/command/commit

- source HEAD、各phaseのJSON出力と終了code、各証跡fileのSHA-256
- manifest path/canonical SHA-256、schema version、writer token owner/process identity
- Task固有authのbearer/internal/service許可とcookie-only/insecure-header拒否
- approval inbox、両human-step resolve route、非`task_store`承認回帰
- legacy routeのread/非正本write/正本guard、旧UIのwaiting/urgent/unknown投影
- Manaのsession/CSRF/person principal/read/retry/no-fallback
- browserのCanonical list/create/update/transition/deleteとcookie-only無効化
- MCPの正本record/metadata mutation guard、正本read、非正本mutation互換
- deleteのprepared停止回復、actor type/ID/区切り文字namespace分離
- 5本の運用scriptに直接writerがない静的検査
- Postgres/NocoDB migration apply/check結果と再起動readiness回帰
- 実Postgresでの同一operation key並行実行結果（caller 2、run 1、completed、cleanup completed）
- Mac consumer固定wire fixtureと実route schema結果

preflight artifactは上記71件の安定したevidence ID、pass状態、file hash、producer command hash、
owner path/hash、raw artifact path/schema、registry hashをすべて持ち、current HEADと一致しなければならない。
いずれかが欠落・失敗・staleの場合、明示enableはatomicに失敗し、mutation readinessは成立しない。

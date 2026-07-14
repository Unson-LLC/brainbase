# Canonical Task 初回切替手順

このrunbookは、Brainbaseの既存NocoDB Task表を正本のまま維持しつつ、書込経路をCanonical Task APIへ一本化する初回切替を管理する。

## 所有する実行経路

- 事前検査: `scripts/preflight-canonical-task-cutover.js`
- 自動テスト: `tests/server/scripts/preflight-canonical-task-cutover.test.js`
- 実行: `npm run preflight:canonical-task-cutover -- --phase <phase>`
- readiness操作: `scripts/set-canonical-task-readiness.js`
- enable: `npm run canonical-task:readiness -- --enable --evidence <artifact>`
- disable: `npm run canonical-task:readiness -- --disable --reason <reason>`
- manifest差替え: `CANONICAL_TASK_STORE_MANIFEST`だけを許可する。base/tableの個別環境変数は禁止する。

## before-migration

1. 旧Brainbase process、Mana capture writer、NocoDB MCP mutation、4本の運用scriptを停止し、処理中要求を排水する。
2. `npm run preflight:canonical-task-cutover -- --phase before-migration`を実行する。
3. 静的writer検査とprocess evidenceの両方で、CanonicalTaskServiceを迂回する正本直接writerが0件であることを確認する。
4. 失敗時はmigrationを開始しない。

## before-enable

1. Postgres調停schemaとNocoDB Task列・冪等key unique migrationをapplyし、checkを通す。
2. guardを含む新BrainbaseとMCPを起動する。process-local mutation gateがclosedで、mutationが503 `canonical_task_mutation_not_ready`になることを確認する。
3. 下記「必須証跡」の全回帰をcurrent HEADで実行する。
4. `npm run preflight:canonical-task-cutover -- --phase before-enable --evidence-out .vibepro/verification/canonical-task-cutover/before-enable.json`を実行する。
5. `npm run canonical-task:readiness -- --enable --evidence .vibepro/verification/canonical-task-cutover/before-enable.json`を実行する。artifact、manifest、schema、writerのtransaction内再検証が失敗した場合はclosed rowを変更しない。
6. mutationが解禁され、再起動後も保存rowと現在値の再検証後だけ開くことを確認する。
7. Brainbase APIの実契約を確認してからMac Companionを反映する。

## rollback

1. `npm run canonical-task:readiness -- --disable --reason rollback`で永続rowをclosedにし、mutationが503になることを確認する。
2. 必要ならMac CompanionまたはCanonical Task API受付を戻す。
3. Postgres schema、NocoDB列・unique、共有manifest、legacy/Mana/MCP guardは維持する。
4. `npm run preflight:canonical-task-cutover -- --phase rollback`を実行し、旧直接writerの起動コマンドと有効経路が存在しないことを確認する。
5. 旧writerは復活させず、forward fixする。

## 必須証跡

- source HEAD、各phaseのJSON出力と終了code、各証跡fileのSHA-256
- manifest path/canonical SHA-256、schema version、writer token owner/process identity
- Task固有authのbearer/internal/service許可とcookie-only/insecure-header拒否
- approval inbox、両human-step resolve route、非`task_store`承認回帰
- legacy routeのread/非正本write/正本guard、旧UIのwaiting/urgent/unknown投影
- Manaのsession/CSRF/person principal/read/retry/no-fallback
- browserのCanonical list/create/update/transition/deleteとcookie-only無効化
- MCPの正本record/metadata mutation guard、正本read、非正本mutation互換
- deleteのprepared停止回復、actor type/ID/区切り文字namespace分離
- 4本の運用scriptに直接writerがない静的検査
- Postgres/NocoDB migration apply/check結果と再起動readiness回帰
- Mac consumer固定wire fixtureと実route schema結果

preflight artifactは上記の安定したevidence ID、pass状態、file hashをすべて持ち、current HEADと一致しなければならない。
いずれかが欠落・失敗・staleの場合、明示enableはatomicに失敗し、mutation readinessは成立しない。

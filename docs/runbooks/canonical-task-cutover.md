# Canonical Task 初回切替手順

このrunbookは、Brainbaseの既存NocoDB Task表を正本のまま維持しつつ、書込経路をCanonical Task APIへ一本化する初回切替を管理する。

## 所有する実行経路

- 事前検査: `scripts/preflight-canonical-task-cutover.js`
- 自動テスト: `tests/server/scripts/preflight-canonical-task-cutover.test.js`
- 実行: `npm run preflight:canonical-task-cutover -- --phase <phase>`
- manifest差替え: `CANONICAL_TASK_STORE_MANIFEST`だけを許可する。base/tableの個別環境変数は禁止する。

## before-migration

1. 旧Brainbase process、Mana capture writer、NocoDB MCP mutation、4本の運用scriptを停止し、処理中要求を排水する。
2. `npm run preflight:canonical-task-cutover -- --phase before-migration`を実行する。
3. 静的writer検査とprocess evidenceの両方で、CanonicalTaskServiceを迂回する正本直接writerが0件であることを確認する。
4. 失敗時はmigrationを開始しない。

## before-enable

1. Postgres調停schemaとNocoDB Task列・冪等key unique migrationをapplyし、checkを通す。
2. guardを含む新BrainbaseとMCPを起動する。
3. `npm run preflight:canonical-task-cutover -- --phase before-enable`を実行する。
4. manifest canonical hash、writer claim、legacy route、Mana、MCP、運用scriptのbypass fixtureがすべて成功した場合だけmutationを解禁する。
5. Brainbase APIの実契約を確認してからMac Companionを反映する。

## rollback

1. 必要ならMac CompanionまたはCanonical Task API受付を戻す。
2. Postgres schema、NocoDB列・unique、共有manifest、legacy/Mana/MCP guardは維持する。
3. `npm run preflight:canonical-task-cutover -- --phase rollback`を実行し、旧直接writerの起動コマンドと有効経路が存在しないことを確認する。
4. 旧writerは復活させず、forward fixする。

## 必須証跡

- 各phaseのJSON出力と終了code
- manifest pathとcanonical SHA-256
- writer token ownerとprocess identity
- 直接writer静的検査結果
- legacy/Mana/MCP bypass fixture結果
- migration check結果

いずれかの証跡が欠落または失敗した場合、mutation readinessは成立しない。

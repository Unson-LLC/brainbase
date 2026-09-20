# Canonical Task readiness test contract Spec

`tests/e2e/story-companion-canonical-task-provider-contract.spec.ts`のSC-030と`surface.legacy.route`は、`tests/server/routes/nocodb-canonical-task-write-guard.test.js`の現行テスト名に存在する安定した接頭辞`returns 410 for`を指定する。

これによりパラメータ化された9ケースをすべて実行し、旧テスト名への依存を除く。legacy routeの振る舞い、readiness判定基準、mutation guard自体は変更しない。

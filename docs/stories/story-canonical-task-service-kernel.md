# Story: Canonical Taskの公開サービスカーネル

Story ID: `story-canonical-task-service-kernel`

## Story

公開Brainbaseの利用者として、Canonical Taskの共通サービス契約を、保存先・認可・監査・時刻・URLの実装から切り離して利用したい。これにより、利用側は同じタスク契約を保ったまま、各環境のポリシーと永続化実装を注入できる。

## 受け入れ条件

1. `@unson/brainbase-mcp/canonical-task-service` からサービス、DI interface、エラー型をimportできる。
2. 既存の`canonical-task-contract`と`canonical-task-principal`の公開サブパスと挙動を変更しない。
3. list/search/get/create/update/transition/deleteをrepository interface経由で実行できる。
4. 認可・tenant scope・監査・operation coordinationはpolicy/audit/operation repositoryへ委譲され、公開カーネルに特定組織の判定を持ち込まない。
5. 冪等キー、楽観ロック、状態遷移、入力正規化、監査readback、base URLによるURL生成がunit testとconsumer smokeで検証される。
6. Postgres、Graph、資格情報、secret値、顧客固有のowner/project/clearanceはこのStoryの対象外である。

## 境界

- 本Storyの正本は公開BrainbaseのTypeScript service kernelと、そのsubpath exportである。
- 永続化実装、組織認証、tenant policy、外部Graph resolver、Postgres adapterは利用側repoが所有する。
- 既存の公開subpathは互換性のため削除・変更しない。

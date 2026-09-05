# 実利用者の会社操作権限プロビジョニング Spec

## 入力

CLIは`human-company-action-authority.v1` manifestを受け取る。

- tenant: `tenant_id`
- organization: `organization_id`
- project: `project_id`, `project_code`
- transport: `provider=slack`, `workspace_id`, `app_id`
- humans: `person_id`, `slack_user_id`, `membership_id`, `identity_id`, `placement_id`, `expected_project_codes`, `bindings`
- binding: `resource_ref`, `capability_id`, `decision`, `allowed_effects`, RACI person IDs、resource/policy/RACI revision、stop conditions、validity

未知field、秘密らしいfield/value、重複human、同一human内の重複resource/capabilityを拒否する。`expected_project_codes`は有界・重複なしで正規化し、既存membershipの`project_codes`とcanonicalな完全一致を要求する。`approval`はapprover、`human_action`はresponsible personを必須とする。

## CLI

```text
node scripts/provision-human-action-authority.js --manifest <path> --check
node scripts/provision-human-action-authority.js --manifest <path> --dry-run
BRAINBASE_PROVISIONING_ACTOR=<actor> node scripts/provision-human-action-authority.js --manifest <path> --apply --approve-apply
```

`apply`は`--approve-apply`とactorの両方がなければ拒否する。出力は秘密を含まないJSON receiptとする。

## 永続化契約

この経路が書き込むのは`company_authority_bindings`だけである。事前に次をexact readbackする。

1. active tenantとtenant内project
2. tenant内organization
3. active Slack workspace connection
4. active person membershipと宣言したperson ID
5. active Slack external identityのID、subject、workspace、app、project、placement、membership

bindingの自然キーはtenant、membership、organization、project、resource、capabilityである。active 0件なら全statusの最大revisionに1を加えて作成する。active 1件は全項目の完全一致時だけnoopとする。active 2件以上、または1件でも差分があれば失敗する。

## 実行と読戻し

`--dry-run`と`--apply`はtenant contextとadvisory lockを設定し、同じ検証・計画・transaction内readbackを実行する。dry-runはrollbackし、applyはcommitする。apply後はCLIが新しいDB接続を取得し、foundationと全bindingを再読込する。

返却する`persisted`はcommit実行の事実だけを表す。実操作、外部副作用、配送の成功は表さない。

## 境界

これはT0の人物・membership・external identity・project accessとは分離したA0
company authority bindingの宣言である。T0の既存provisionerは変更せず、別の
汎用プロビジョナーへstrict manifestを渡す。VibeProはStoryとSpecの対応確認に
限定し、廃止済みgateや新規DAGは作らない。

## 実装・検証リンク

- Story: `docs/management/stories/active/story-human-company-action-authority-provisioning.md`
- 実装: `server/services/multitenant/human-action-authority-provisioner.js`
- CLI: `scripts/provision-human-action-authority.js`
- テスト: `tests/server/services/multitenant/human-action-authority-provisioner.test.js`

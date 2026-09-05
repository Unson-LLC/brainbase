# Spec: 別事業体の実利用者プロビジョニング

## 入力

manifest versionは`human-company-authority.v1`とする。

- tenant: `tenant_id`
- organization: `organization_id`, `graph_organization_id`, `display_name`
- project: `project_id`, `project_code`
- transport: `provider=slack`, `workspace_id`, `app_id`
- people: `person_id`, `person_name`, `slack_user_id`, `login_role`, `tenant_role`, `project_codes`, `clearance`, `placement_id`

未知field、重複person、重複Slack identity、秘密らしいfield/value、空配列、無効なIDを拒否する。各humanの`project_codes`は宣言したtenant projectだけを許可する。

## CLI

```text
node scripts/provision-human-company-authority.js --manifest <path> --check
node scripts/provision-human-company-authority.js --manifest <path> --dry-run
BRAINBASE_PROVISIONING_ACTOR=<actor> node scripts/provision-human-company-authority.js --manifest <path> --apply --approve-apply
```

`apply`は`--approve-apply`とactorの両方がなければ拒否する。出力は秘密を含まないJSON receiptとする。

## 永続化契約

- `tenant_organizations`: tenant内organizationとGraph organization参照
- `people`: canonical person projection
- `auth_grants`: workspace単位のログインrole、project_codes、clearance
- `tenant_memberships`: active human membership、revision、tenant role、placement
- `company_external_identities`: provider/workspace/app/person/project/placementを束縛したactive identity

会社権限bindingは、このT0登録を入力にA0の権限cutoverで別途宣言する。

`tenant_memberships`には既定のSlackログインresolverが必要とするSlack user/workspace、project、clearanceも保存する。

各自然キーは0件または1件だけを許可する。1件は完全一致時だけnoop、2件以上または差分ありはconflict/ambiguousとして失敗する。実行前にGraph organizationと同一tenantのactive workspace connectionを検証する。external identityはactive候補をstatus付きSQLで取得し、全statusの最大revisionから次revisionを決める。

## 検証

- manifest validationと秘密値拒否
- fresh create
- exact rerun noop
- cross-tenant organization ID衝突拒否
- membership / identityの曖昧性拒否
- dry-run rollback、途中失敗rollback
- 実PostgreSQLでRLS、FK/unique制約、cross-tenant不可視、commit後の別接続readback
- CLIのapply承認とactor必須

# Personal KG 昇格の本番スモーク（AC-008）

このスモークは、Personal KG の合成イベントを一度だけ組織Graphへ昇格し、同じ署名済み `organization_review` を再送して副作用が増えないことを確認する。顧客データは使わない。

実行結果は標準出力のJSONをそのまま保存する。JSONにはPersonal本文、正規化payload、署名済みcontext、アクセストークン、DB接続文字列を含めない。

## 事前条件

- 対象デプロイのAPIと、同じ環境のPostgreSQLへ接続できること。
- owner用と、ownerとは別人のGM/CEO reviewer用のBearer JWT。両方とも対象projectへアクセスできること。
- Tenant Runtimeへ接続できるfixture発行専用service token。署名はTenant Runtime内の`TenantContextProducer`が行い、秘密鍵はfixture発行プロセスへ渡さない。
- 本番データを検索・削除して再利用しない。synthetic IDが既に存在した場合、スクリプトは開始前に停止する。

### 認証・権限の事前検証

スクリプトはfixtureの構文検証後、業務POSTやDB readbackより先に、ownerとreviewerそれぞれのBearer JWTを`/api/auth/verify`へ送る。両方ともHTTP 200、`ok=true`、`authMode=bearer`で、`access`に次の値が完全に揃っていなければ停止する。

- `personId`（canonical person ID）
- `organizationId`
- `projectCodes`（fixtureの`project_code`を含む配列。別名や空白で補完しない）
- `role`
- `clearance`

ownerとreviewerの`personId`は異なる必要があり、同じ`organizationId`に属し、reviewerの`role`は`gm`または`ceo`だけを許可する。署名contextの`actor.principal_id`は検証済み`personId`と一致させ、`authenticated_subject_id`（外部OAuth subject）からperson IDを導出しない。`project_code`は`access.projectCodes`に含まれることを検証し、canonical `project_id`はproducerが発行した各署名context間で一致することを検証する。`project_code`とcanonical `project_id`を同一視せず、aliasを推測しない。

DB readbackは、接続後に`current_user`の`pg_roles.rolsuper`と`rolbypassrls`がともに`false`であることを確認する。各readback queryは個別のpool clientで`BEGIN READ ONLY`、次の6つの`set_config(..., true)`、query、`COMMIT`、releaseの順に実行する。

`app.person_id`、`app.actor_person_id`、`app.organization_id`、`app.project_codes`、`app.role`、`app.clearance`を設定し、raw/admin DSN、`SET ROLE`、`row_security`無効化は使用しない。`BEGIN`または`ROLLBACK`が失敗したclientはpoolへ戻さず破棄する。

## Migration preflightとreadback

このmigrationのDDLは再適用可能だが、署名・正規化証跡のない旧`pending_org_review`をfail closedで`pending_owner_approval`へ戻す。適用前の対象集計は、生SQLで正規化列を直接参照しない。旧スキーマではその列自体がまだ存在しないためである。

`deploy-lightsail-production.md`のPersonal KG手順を正本とし、`personal-knowledge-migration-release-gate.mjs preflight`で列の存在を検査して対象集合とDB identityをReceiptへ固定する。migration後は同じReceiptを`postflight`へ渡し、対象集合、総件数、status別件数、database・role・host・port、`knowledge_promotion_authority_uses`のRLS有効・強制を照合する。preflight・migration・postflightのいずれかが失敗した場合はserviceを停止したまま終了する。

対応する署名producerとAPI serviceを同じrelease単位で反映する。対象者への再同意通知は自動送信せず、影響件数を運用Receiptへ記録して別途判断する。旧clientからのwriteは503でfail closedするため、producer未反映の状態でserviceだけを公開しない。

## Fixture

`personal_knowledge_promotion_production_smoke.v1` を正本とする。最小構造は次のとおり。`body` は実行IDを含む合成文字列だけにする。

```json
{
  "schema_version": "personal_knowledge_promotion_production_smoke.v1",
  "synthetic": true,
  "data_class": "synthetic",
  "run_id": "p0_smoke_20260825_001",
  "event": {
    "event_id": "pke_smoke_20260825_001",
    "body": "synthetic production smoke p0_smoke_20260825_001",
    "body_hash": "sha256:<sha256(body)>",
    "source": {"type": "production_smoke"},
    "source_pointer": {"run_id": "p0_smoke_20260825_001"}
  },
  "request": {
    "project_code": "brainbase",
    "summary": "synthetic production smoke",
    "subject": {"type": "decision", "id": "smoke_20260825_001"},
    "normalized_payload": {"schema_version": "personal_knowledge_normalized.v1", "kind": "entity", "entity": {"id": "smoke_20260825_001", "type": "glossary_term", "payload": {"label": "synthetic production smoke term"}}, "edges": [], "context_entities": [], "sensitivity": "internal", "role_min": "member"},
    "signed_context": "<request context object>"
  },
  "owner": {"signed_context": "<owner consent context object>"},
  "organization": {"signed_context": "<organization review context object>"}
}
```

署名contextはAPIへ `Brainbase-Tenant-Context` として送られる。署名の有効期限、対象event/request、operation ID、idempotency key、normalized payload hashはサーバーが検証するため、手で書き換えない。ownerとorganizationのcontextは別の `operation_id` にする。

## 署名済みFixtureの発行

合成run IDごとに、次のコマンドでrequest / owner consent / organization reviewの3 contextを発行する。service tokenと署名鍵は標準出力やfixtureへ保存されない。出力先は新規ファイルに限定され、権限`0600`でreadbackされる。

環境値は本番のProject Catalogとtenant connectionのreadback値を使う。revisionを推測しない。ownerとreviewerは別の認証主体にする。

```bash
export BRAINBASE_TENANT_RUNTIME_URL='http://127.0.0.1:<tenant-runtime-port>'
export BRAINBASE_PERSONAL_KG_FIXTURE_SERVICE_TOKEN='(secret)'
export BRAINBASE_PERSONAL_KG_FIXTURE_TENANT_ID='ten_...'
export BRAINBASE_PERSONAL_KG_FIXTURE_TENANT_REVISION='<confirmed revision>'
export BRAINBASE_PERSONAL_KG_FIXTURE_CONNECTION_ID='wsc_...'
export BRAINBASE_PERSONAL_KG_FIXTURE_CONNECTION_REVISION='<confirmed revision>'
export BRAINBASE_PERSONAL_KG_FIXTURE_WORKSPACE_ID='<workspace id>'
export BRAINBASE_PERSONAL_KG_FIXTURE_APP_ID='<app id>'
export BRAINBASE_PERSONAL_KG_FIXTURE_PROJECT_CODE='brainbase'
export BRAINBASE_PERSONAL_KG_FIXTURE_CHANNEL_ID='<synthetic smoke channel id>'
export BRAINBASE_PERSONAL_KG_FIXTURE_OWNER_SUBJECT_ID='<owner subject id>'
export BRAINBASE_PERSONAL_KG_FIXTURE_REVIEWER_SUBJECT_ID='<reviewer subject id>'

npm run personal-kg:issue-production-smoke-fixture -- \
  --run-id p0_smoke_20260826_001 \
  --output /secure/path/personal-knowledge-promotion-smoke.json \
  > /secure/path/personal-knowledge-promotion-smoke.fixture-receipt.json
```

発行Receiptの`status=passed`、`readback.status=passed`、`readback.mode=0600`、`correlation.context_count=3`を確認する。失敗時は`failure.code`だけを記録し、同じ出力ファイルを上書きしない。

## 実行

秘密値は引数やログに置かず、実行シェルの環境変数から渡す。`BRAINBASE_PERSONAL_KG_SMOKE_CSRF_TOKEN` を省略すると、指定sessionで `/api/csrf-token` から一時トークンを取得する。

```bash
export BRAINBASE_PERSONAL_KG_SMOKE_BASE_URL='https://<target-host>'
export BRAINBASE_PERSONAL_KG_SMOKE_OWNER_TOKEN='(secret)'
export BRAINBASE_PERSONAL_KG_SMOKE_REVIEWER_TOKEN='(secret)'
export BRAINBASE_PERSONAL_KG_SMOKE_DATABASE_URL='(secret)'
node scripts/personal-knowledge-promotion-production-smoke.mjs \
  --fixture /secure/path/personal-knowledge-promotion-smoke.json \
  > /secure/path/personal-knowledge-promotion-smoke.evidence.json
```

成功条件はJSONの `status` が `passed` で、次がすべて `true` になること。

- `assertions.receipt_db_graph_correlated`
- `assertions.personal_body_absent_from_evidence`
- `assertions.personal_body_absent_from_graph_projection`
- `assertions.replay_rejected_before_second_mutation`
- `replay.mutation_diff_zero`
- `replay.db_mutation_diff_zero`
- `replay.graph_mutation_diff_zero`
- `replay.receipt_mutation_diff_zero`

同じrun IDがDBまたはGraphに存在する、署名期限切れ・署名不正、HTTP/DB/Graph readback不一致、またはJSONへの秘密値混入はすべて失敗（fail closed）とする。失敗時は出力JSONの `failure.code` だけを証跡に残し、再実行前に新しい合成run IDと新しい署名contextを発行する。部分適用を前提に自動削除・自動再試行しない。

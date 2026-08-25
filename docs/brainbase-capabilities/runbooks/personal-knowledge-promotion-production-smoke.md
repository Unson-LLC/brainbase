# Personal KG 昇格の本番スモーク（AC-008）

このスモークは、Personal KG の合成イベントを一度だけ組織Graphへ昇格し、同じ署名済み `organization_review` を再送して副作用が増えないことを確認する。顧客データは使わない。

実行結果は標準出力のJSONをそのまま保存する。JSONにはPersonal本文、正規化payload、署名済みcontext、アクセストークン、DB接続文字列を含めない。

## 事前条件

- 対象デプロイのAPIと、同じ環境のPostgreSQLへ接続できること。
- owner用と、ownerとは別人のGM/CEO reviewer用のBearer JWT。両方とも対象projectへアクセスできること。
- `TenantContextProducer` が発行した有効な署名済みcontextを3個（request / owner consent / organization review）。秘密鍵はfixtureに入れない。
- 本番データを検索・削除して再利用しない。synthetic IDが既に存在した場合、スクリプトは開始前に停止する。

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
    "normalized_payload": {"schema_version": "personal_knowledge_normalized.v1", "kind": "decision", "entity": {"id": "smoke_20260825_001", "type": "decision", "payload": {"statement": "synthetic smoke decision"}}, "edges": [], "context_entities": [], "decision_domain": "production_smoke", "sensitivity": "internal", "role_min": "member"},
    "signed_context": "<request context object>"
  },
  "owner": {"signed_context": "<owner consent context object>"},
  "organization": {"signed_context": "<organization review context object>"}
}
```

署名contextはAPIへ `Brainbase-Tenant-Context` として送られる。署名の有効期限、対象event/request、operation ID、idempotency key、normalized payload hashはサーバーが検証するため、手で書き換えない。ownerとorganizationのcontextは別の `operation_id` にする。

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

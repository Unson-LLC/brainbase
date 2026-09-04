# OutcomeCase v1 Architecture

## 判断

OutcomeCase は既存 Graph の entity type を増やさない、PostgreSQL の制御面 record とする。`project_code` と `capability_id` は既存 Graph/ontology の参照値であり、この API は未知型の Graph entity を生成しない。これは成果の進行・評価履歴を保持しつつ、組織事実の ontology を推測で拡張しないためである。

## 境界

```text
create → OutcomeCase PostgreSQL record → read
                              ↓
evaluate → technical evidence (入力)
         → retained RunReceipt refs（初回参照との和集合を read-only 照会）
         → external readback（入力）
         → constraint status（入力）
         → authoritative project/capability resolver（read-only）
         → authenticated actor と Info SSOT RACI authority resolver（read-only）
                              ↓
                      derived closure_status
```

- API は `POST /api/outcome-cases`、`GET /api/outcome-cases/:caseId`、`POST /api/outcome-cases/:caseId/evaluations` のみ。
- repository は OutcomeCase 専用 table を使う。実行時の PostgreSQL がない場合は API を利用不可として fail loud にし、JSON fallback を正本にしない。
- RunReceipt の参照確認は既存 `RunReceiptQueryService.diagnose` の read-only 結果だけを使う。receipt が見つからない場合は `no_data` であり、成功へ丸めない。
- `closure_status` は request から直接指定できず、評価ごとに導出する。`closed` は evidence、参照解決、解決済み authority、認証済み actor を満たす場合だけで導出する。
- `current_external_state` は評価に含む任意の明示値だけで更新する。欠落時に `unknown` を書き込まない。
- `evaluation_history` は append-only である。`run_receipt_refs` は create 時の値と全評価で追加された値の和集合であり、評価 payload で既存 ref を削除できない。各評価は閉鎖可否にかかわらずその和集合を診断し、当時の `current_external_state`、`unresolved_failure_boundary`、結果の revision/status も保存する。close 判定では全件 confirmed を要求する。

## 閉鎖不変条件

`technical_evidence.status = confirmed`、保持済み全 `run_receipt_refs` の `evidence_state = confirmed`、`external_readback.status = confirm`、`constraints_status = satisfied`、`reference_resolution.project/capability = confirmed`、Info SSOT RACI から解決した authority が confirmed、かつ authority が認証済み actor の `person_id` を許可する、の AND 以外では `closed` を返さない。特に HTTP 200、テスト成功、保存、デプロイは API の評価入力や導出規則ではない。

## データと権限

`authority` は `{ state, closure_authorized_person_ids, provenance, reason }` の小さな明示契約である。create/evaluate request は authority を渡せず、service は actor の access context を用いて既存 Info SSOT `raci_assignments` を read-only 照会する。resolver の未解決・例外は理由付き unresolved として保存され、close を禁止する。閉鎖時は request の `evaluator` 文字列ではなく route が渡す認証済み actor の `person_id` と照合する。`evaluator` は監査上の claim としてだけ保存する。本 v1 は Graph/RACI を書き換えない。

参照は注入された authoritative resolver で、scope を設定した PostgreSQL の `projects` と active `brainbase_capabilities` を read-only で照会する。repository の read/update は actor の `projectCodes` で絞り、table は `app_project_codes()` を使う FORCE RLS policy でも二重に絞る。capability registry が未適用、参照が見つからない、または resolver が利用不能なら、record に `unresolved` と理由を保存し、閉鎖を禁止する。resolver は Graph entity を作成・更新しない。

`server/sql/outcome-case-schema.sql` は `scripts/info-ssot-apply.sh` の single-transaction bundle に入る。`CREATE/ALTER ... IF NOT EXISTS` と readback により、初回と既存 v1 table の両方を idempotent に扱う。これはローカル適用経路の接続証拠であり、本番への適用を意味しない。

## 証拠境界

local unit/route test は API と導出規則の証拠であり、外部の受領・提供・利用者可観測の完了、本番 migration、production Graph 状態の証拠ではない。

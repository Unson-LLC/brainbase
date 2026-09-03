# OutcomeCase v1 Architecture

## 判断

OutcomeCase は既存 Graph の entity type を増やさない、PostgreSQL の制御面 record とする。`project_code` と `capability_id` は既存 Graph/ontology の参照値であり、この API は未知型の Graph entity を生成しない。これは成果の進行・評価履歴を保持しつつ、組織事実の ontology を推測で拡張しないためである。

## 境界

```text
create → OutcomeCase PostgreSQL record → read
                              ↓
evaluate → technical evidence (入力)
         → RunReceiptQueryService（既存 receipt の read-only 照会）
         → external readback（入力）
         → constraint status（入力）
                              ↓
                      derived closure_status
```

- API は `POST /api/outcome-cases`、`GET /api/outcome-cases/:caseId`、`POST /api/outcome-cases/:caseId/evaluations` のみ。
- repository は OutcomeCase 専用 table を使う。実行時の PostgreSQL がない場合は API を利用不可として fail loud にし、JSON fallback を正本にしない。
- RunReceipt の参照確認は既存 `RunReceiptQueryService.diagnose` の read-only 結果だけを使う。receipt が見つからない場合は `no_data` であり、成功へ丸めない。
- `closure_status` は request から直接指定できず、評価ごとに導出する。`closed` は four-way evidence だけで導出する。
- `current_external_state` は評価に含む任意の明示値だけで更新する。欠落時に `unknown` を書き込まない。

## 閉鎖不変条件

`technical_evidence.status = confirmed`、全 `run_receipt_refs` の `evidence_state = confirmed`、`external_readback.status = confirm`、`constraints_status = satisfied` の AND 以外では `closed` を返さない。特に HTTP 200、テスト成功、保存、デプロイは API の評価入力や導出規則ではない。

## データと権限

`authority` は判定責任の payload を保存するが、本 v1 は Graph/RACI を書き換えない。route は既存 workflow authentication を通す。成果 record は project/capability への参照を保存するだけで、参照先を未知の型として補完しない。

## 証拠境界

local unit/route test は API と導出規則の証拠であり、外部の受領・提供・利用者可観測の完了、本番 migration、production Graph 状態の証拠ではない。

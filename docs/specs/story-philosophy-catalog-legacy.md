# Spec: 旧哲学を含むカタログの一覧境界

## 適用範囲

`GET /api/foundation/catalog` の `philosophies` は、選択プロジェクトの現行Graph行とその最新履歴を一覧投影する。判断で参照できる哲学は、payloadに `judgmentApplicability` キーが存在し、既存のreader検証を通過した版に限る。

## SQL契約

`GRAPH_PHILOSOPHY_LIST_SQL` は、現行行の選択プロジェクト・哲学種別・履歴結合・現行可視性の条件に加え、次のJSONBキー存在条件を持つ。

```sql
AND current_entity.payload ? 'judgmentApplicability'
```

この条件は、キーがない旧payloadだけを一覧の入力から除外する。キーが存在するpayloadは、`validatePhilosophyHistoryAccess` と `parseJudgmentApplicability` に渡し、`null`、不正なscope、期間不正、履歴との不整合、ダイジェスト不一致を `corrupt_catalog` として拒否する。読込側の検証をSQLへ複製しない。

## 境界と不変条件

- 一覧は「判断可能な哲学」の投影であり、適用範囲のない旧行を判断可能とみなさない。
- 個別の `philosophyReader.read` / `readCanonical` は引き続き適用範囲を必須とし、旧payloadを成功として返さない。
- 現行Graph行のACL、可視性、active状態、選択プロジェクトと、履歴のstorage digest検証は従来どおり適用する。
- 旧payloadの内容、適用範囲、期間を推測・補完・書換えしない。
- 一覧に混在する別の有効な目的・哲学は、旧行の存在だけで失敗しない。

## 検証方針

PGliteを使った実DB互換テストで、旧行（キーなし）と有効行を同一プロジェクトへ置き、一覧SQLが有効行だけを返すことを確認する。reader単体テストでは、明示されたnull・不正metadataが拒否されることと、個別読込の欠損payloadが厳格に失敗することを確認する。

## 追記: 適用範囲が未記録の哲学（story-philosophy-catalog-unscoped-visible）

判断の一覧（`brainbase_judgment_frame_catalog`）は適用範囲の無い哲学も参照する。そのため、一覧から外した旧行を画面で「無い」と見せない。`GET /api/foundation/catalog` は `philosophies` と別に `philosophies_without_applicability` を返す。

- 入力は `GRAPH_UNSCOPED_PHILOSOPHY_LIST_SQL`。選択プロジェクト・`lifecycle_status = 'active'`・`judgmentApplicability` キーなしの現行行だけを読む。
- 判断の一覧と同じく、`payload.status` が superseded・retired・rejected で始まる行と、`statement` の無い行は含めない。
- 各項目は `{ kind: 'philosophy', id, version, applicability: null, applicability_state: 'unrecorded', payload: { title?, statement, summary?, status? } }`。`version` は現行Graph行の版で、検証済みの改訂版ではない。payload の他の項目は返さない。
- 共通UIはこの項目を「適用範囲: 未記録」として区別して表示する。項目が無い応答（古いホスト）では、未記録の哲学の有無を確認できていないと表示する。

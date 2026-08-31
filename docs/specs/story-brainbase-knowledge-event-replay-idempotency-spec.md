# Brainbase Knowledge Event 再送冪等性仕様

## 対象

`KnowledgeEventService`が既存の`event_id`を検出した場合のidentity比較を定義する。対象はPostgreSQLへ記録済みの`knowledge_event.v1`再送である。

## 契約

PostgreSQL行の`payload`が同じ`event_id`を持つ`knowledge_event.v1`であり、必須identity項目がすべて揃う受信原形なら、identity項目はその原形と再送イベントで比較する。部分欠損、旧形式、破損したpayloadは採用せず、DBのtop-level列へfail-closed fallbackする。

比較項目は従来どおり次を維持する。

- `body_hash`
- `source_pointer`
- `subject`
- `decision_authority`
- `applicability_scope`
- `permission_snapshot`
- `parent_episode_id`
- `organization_id`
- `sensitivity`
- `role_min`
- `venue`

受信原形ではない通常のイベントpayloadや、インメモリ・旧形式の保存値では、従来のtop-level identity比較を維持する。

## 永続化境界

検索・権限・表示用に補完されたPostgreSQL列は変更しない。再送identityの比較元だけを受信原形へ戻し、候補、audit、outbox/retry、Graph projectionの処理も変更しない。

## 検証

- `tests/unit/knowledge-event-service.test.js`で、補完列があっても同一再送が成功し、受信原形の差分はconflictになることを検証する。
- `tests/server/services/pg-knowledge-event-repository.test.js`で既存のPostgreSQL復元契約を検証する。
- `tests/server/routes/knowledge-event-routes.test.js`とMCP Knowledge Event testsで入口とreceipt契約を検証する。

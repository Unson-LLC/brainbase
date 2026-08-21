# Architecture: Graph Maintenance Phase 0.2 cross-scope rehome

## 決定

既存`move_scope`を暗黙に拡張せず、明示的な`rehome_entity` operationを追加する。Planのauthority projectは従来どおり1件だが、Snapshot imageは`project_codes`で複数scopeを保持する。

## データフロー

1. MCP/RESTがauthority `project_code`と`include_project_codes`を受け取る。
2. Serviceが全codeについてcaller scopeと`projects.organization_id`を同一transaction内で検証する。
3. Snapshotは各scopeのEntity/Edgeを結合し、canonical sortした全体hashを持つ。
4. `rehome_entity`はtarget Project entityを要求し、旧membership retire、新membership作成、Entity scope変更を一つのafter imageへ生成する。
5. Apply/rollbackはbefore/after imageに含まれる全scopeをlockし、完全image hashをreadbackする。

## 不変条件

- active `belongs_to_project`: `from.project_code == edge.project_code == to.project_code`
- target Project entityは`entity_type=project`、active、同tenant、callerがアクセス可能
- 新Edge IDはserviceがidempotency keyから決定し、caller指定ID衝突を許可しない
- 無関係incident Edgeは自動でscope移動しない
- project organization未紐付けはfail closed

## 展開順序

1. 明示的organization mapping migrationを適用・readback
2. API/MCPを同一SHAで展開
3. Batch 2の新Snapshot/dry-runを再作成
4. 差分確認後のみHuman Gate/Apply

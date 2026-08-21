# ChatGPT Phase 0 Connector同期アーキテクチャ

## データ経路

`Graph SSOT entity row` → `Graph API response` → `GraphAPISource metadata` → `EntityIndex` → `search/get_entity formatter`

保守状態は行の`lifecycle_status`と`version`を正本とする。`semantic_state`はAPI行を優先し、互換期間だけpayloadをfallbackとして読む。payload内の`status`は業務上のDecision状態なので別表示する。

## 認証境界

ChatGPT Connector専用の`bbsvc_`サービスIDをorganization `unson`と許可project集合へ束縛する。MCPはInfisicalから`BRAINBASE_TASK_API_TOKEN`と`BRAINBASE_GRAPH_API_TOKEN`を注入して起動し、欠落・形式不正・Canonical Task preflight失敗時は起動しない。

## API境界

管理診断は`/api/admin/graph/entities`の`project`、`type`、`limit`、`id`、`q`を透過的に転送する。Graph Maintenanceは既存の6操作だけを公開し、scope外projectをHTTP到達前に拒否する。

## リリース確認

PR前は実装・投影・認証選択のローカル契約を検証する。マージ後は別Story `story-chatgpt-phase0-connector-production-activation`で、同一commitのAPI/MCPを再起動し、tools/list、Canonical Task、対象Decisionの保守列、変更なしdry-run、権限なしApplyの構造化拒否を本番でreadbackする。ChatGPT Hostのschema cache更新はMCP再起動とは別の運用境界として扱い、本番readbackが揃うまで有効化完了にしない。

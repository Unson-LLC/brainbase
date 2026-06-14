# Brainbase管理画面で正本・候補・AI参照文脈を可視化する

Story ID: `story-brainbase-admin-visualization-bdd`

## User Story

Brainbaseを運用する人として、設定状態と保存されている内容をひとつの管理画面で確認したい。Graph SSOT、candidate-store、AIが実際に参照する文脈、LightRAGなどの派生indexを混同せず、現在の状態と不整合の兆候を日本語で把握できることが目的である。

## Center Pin

管理画面は正本ではなく投影である。Graph SSOT、candidate-store、AI context resolver、派生index、設定/healthを読み取り専用で並べ、各表示に `source_class` を付けて境界を可視化する。

## Acceptance Criteria

- OverviewでGraph SSOT、candidate-store、AI Context、LightRAG/derived index、設定/healthの状態が見える。
- Graph SSOT一覧はentity type、project、sensitivity、role_min、updated_atを持ち、読み取り専用である。
- candidate-store一覧はpromotion_status、redaction_status、cognitive_type、visibility、sensitivity、created_atを持ち、Graph正本と混ぜて表示しない。
- AI Context Previewはproject/entity type/edge/memory条件を指定でき、含まれた文脈と除外・未接続理由を区別して表示する。
- 設定/healthは存在有無と接続状態を示すが、secret値そのものは返さない。
- UIの主表示は日本語である。言語切り替えを入れる場合も日本語をdefault/fallbackにする。
- `/api/admin/*` は認証済みユーザーの `req.access` に従い、未認証では使えない。

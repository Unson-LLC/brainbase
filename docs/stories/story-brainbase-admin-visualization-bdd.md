# Brainbase管理画面で個人KGとDB接続状態を可視化する

Story ID: `story-brainbase-admin-visualization-bdd`

## User Story

Brainbaseを運用する人として、設定状態と保存されている内容をひとつの管理画面で確認したい。Graph SSOT、candidate-store、個人KG、AIが実際に参照する文脈を混同せず、現在の状態と不整合の兆候を日本語で把握できることが目的である。

## Center Pin

管理画面は正本ではなく投影である。Graph SSOT、candidate-store、Personal KG read model、AI context resolver、設定/healthを読み取り専用で並べ、各表示に `source_class` を付けて境界を可視化する。個人KGは現行の Brainbase サーバーAPIから読む read model であり、ブラウザがDB接続文字列やsecretを持たない。

## Acceptance Criteria

- OverviewでGraph SSOT、candidate-store、Personal KG、AI Context、設定/healthの状態が見える。
- Graph SSOT一覧はentity type、project、sensitivity、role_min、updated_atを持ち、読み取り専用である。
- candidate-store一覧はpromotion_status、redaction_status、cognitive_type、visibility、sensitivity、created_atを持ち、Graph正本と混ぜて表示しない。
- Personal KGは現在のログイン主体に紐づく owner-visible `memory_candidates` をサーバーAPI経由で集計し、memory layer、SNS利用可否、review/redaction状態、最新候補を表示する。
- Personal KGでアクセス外ownerを指定した場合は、別ownerへ黙ってフォールバックせず、表示対象外の状態と理由を日本語で表示する。
- AI Context Previewはproject/entity type/edge/memory条件を指定でき、含まれた文脈と除外・未接続理由を区別して表示する。
- 設定/healthはSSOTサーバーパターンのDB接続先キーの存在有無と、サーバー側の実接続チェック結果を分けて示すが、secret値そのものは返さない。
- Graph、candidate-store、Personal KG、DB接続の一部が失敗した場合でも、管理画面全体を500にせず、該当sourceを `unavailable` または `partial` として表示する。
- UIの主表示は日本語である。言語切り替えを入れる場合も日本語をdefault/fallbackにする。
- `/api/admin/*` は認証済みユーザーの `req.access` に従い、未認証では使えない。

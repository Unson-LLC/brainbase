# プロジェクト高密度ワークスペース仕様

対象Story: `story-project-dense-workspace-v1`

## 1. 状態モデル

`createProjectKnowledgeWorkspace` は次の表示状態を内部に持つ。

- `overview`: 概要。最初に表示する。
- `work-list`: 補足コンテキストの `kind=task` 項目を一覧表示する。
- `work-detail`: 選択した仕事の項目と、その項目に紐づく記録を表示する。
- `record-list`: 補足コンテキストの `section.id` で判断・知識・用語集を区分して一覧表示する。項目の `kind` は下位種別として保持する。
- `record-detail`: `kind` が記録・観測・知識・判断の項目を表示する。
- `graph`: 既存のGraph投影とSigma.jsを表示する。

項目が存在しない場合は空成功と仮定せず、セクションの `state` を `unknown`、`unavailable`、`failed` のいずれかで表示する。`state=ok` かつ項目が0件の場合だけ、取得元が確定した空を表示する。

## 2. コンテキスト項目

ホストが渡す `sections[]` と `items[]` は既存の `normalizeProjectContext` を通す。区分は `section.id` で判定し、項目の `kind` は元の下位種別を保持する。基本項目は `id`, `title`, `kind`, `status`, `summary`, `owner`, `dueAt`, `updatedAt`, `source`。追加の表示に使える項目は `body`, `description`, `assignee`, `sourceRecordId`, `relatedTaskId`, `eventAt`, `provenance`, `unknowns` とし、文字列または単純な値だけを保持する。正規化できない値は表示へ流さない。

## 3. 表示境界

- 概要の指標は項目の状態・期限・更新時点から算出する。総数が完全取得を意味しない場合は `未確認` と表示する。
- 「今日扱う仕事」は期限が今日・期限超過・確認が必要な項目を最大6件表示する。判断根拠のない項目を優先と推測しない。
- 「前回からの変化」は `updatedAt` がある項目を最大4件表示する。時刻がない項目は変化一覧へ入れない。
- 概要のタスク・判断・知識・用語集は取得状態と件数、一覧への導線を表示する。最近の記録は既存の最大4件を維持し、概要に全件を展開しない。Graph判断と関連情報の全件もGraphタブへ送る。
- 仕事一覧は検索・状態・担当・期限、記録一覧は区分内の検索・状態で絞り込める。両一覧とも初期表示を16行に制限し、17件以上ある場合は現在の表示範囲、前へ、次へを表示する。
- ページ送りは取得済み項目の範囲だけを移動し、詳細から戻ったときは検索条件とページ位置を復元する。取得元から総数が渡されない場合は「総数は未確認」、渡された総数より取得済み件数が少ない場合は「続き未取得」と表示する。最終ページを推測しない。
- 仕事詳細・記録詳細の右側文脈は選択中の項目の内容だけを表示し、概要画面には常設しない。
- 一覧の行は同じIDの詳細へ遷移する。詳細から戻る操作はプロジェクトIDと元の区分を保持する。
- セクションごとの取得中・空・未接続・取得失敗は別々に表示する。`unknown`、`unavailable`、`failed` の状態や不明な総数を、取得済みの0件として表示しない。

## 4. 遷移契約

- 概要の「仕事をすべて見る」→ `work-list`。
- 概要の各区分の「一覧を見る」→ 対応する `work-list` / `record-list`（選択した `section.id` を保持）。
- 概要または一覧の仕事行 → `work-detail`（`selectedItemId` を保持）。
- `record-list` の判断・知識・用語集の行 → `record-detail`（`selectedItemId` と `section.id` を保持）。
- `work-detail` または `record-detail` から一覧へ戻る → 対応する `work-list` / `record-list`。
- 仕事詳細の記録行、Graphの観測出典 → `record-detail`（`sourceRecordId` または項目IDを保持）。
- 記録詳細の関連仕事 → 同じ `work-detail`。
- Graphの概要タブ → `overview`、Graphノードの仕事 → `work-detail`、確定エンティティ → `graph` の選択文脈。
- すべての画面に「概要へ戻る」またはパンくずを置く。戻る操作はプロジェクトIDを失わない。

## 5. Graph・権限

Graphのノードと線は `projectKnowledgeEntities` / `projectKnowledgeEdges` の出力だけを使う。補足項目の所属や未確定観測から線を生成しない。既存の `mountGraph` と `readEntity` を利用し、選択変更や画面破棄で遅延マウントを破棄する。訂正UIは既存ホストに委ね、新規の書き込み操作は持たない。

## 6. テスト参照

- `tests/ui/project-workspace.test.mjs`: 状態表示、優先項目、同一ID遷移、未知・失敗・未接続、Graph選択。
- `tests/ui/graph-projects-view.test.mjs`: ホストから渡された detail/context の接続と画面破棄。
- `tests/ui-package-contract.test.ts`: 公開サブパスとCSS/JS配布。

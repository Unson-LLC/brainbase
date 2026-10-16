# 判断の根拠と本人の考え

Story: `story-judgment-history-frame-basis-v1`

## 記録の値の約束（`JudgmentHistoryReference`）

型は変えない。`kind` と `usage` に次の値を入れる。書き手（OSSの手元の読み取り、unson Host の公開記録）は同じ約束に従う。

| 欄 | 値 | 意味 |
|---|---|---|
| `kind` | `philosophy` / `objective` / `model` | 判断の枠組みで選んだ参照 |
| `kind` | `personal_knowledge` | この判断で使った個人KGの記録（`personal_answer` が resolved の `reference_ids`） |
| `usage` | `constraint:satisfied` / `constraint:violated` / `constraint:tension` | 哲学を制約として使い、その判定 |
| `usage` | `criterion` / `criterion:<verdict>` | 目的を基準として使った（判定は任意） |
| `usage` | `prediction:held` / `prediction:failed` / `prediction:unchecked` | 世界モデルで予測し、データで確かめた結果 |
| `usage` | `applied` | 個人KGの記録を判断に使った |

- 使い方は、採用した案（`chosen_option`）の `uses` から取る。不採用の案の使い方は運ばない。
- `kind` が無い古い記録は、IDの接頭辞（`phi_`・`fnd_unson_philosophy_` → 哲学、`obj_`・`fnd_objective_`・`fnd_unson_objective_` → 目的、`fnd_model_`・`fnd_unson_model_` → 世界モデル）で種類だけを推定する。使い方は推定しない。
- 上の表に無い `usage`（Company OS の `problem_snapshot` など）は、従来どおり記録の詳細に出す。

## 本人の考えの判定（UI）

1. `kind=personal_knowledge` の参照がある → 「個人KGの材料を使った（N件）」
2. 1でなく、判断の枠組みの参照に上の表の `usage` が1つ以上ある → 「使っていない」。この書き手は、使った場合に必ず個人KGの参照を残すため
3. どちらでもない → 「記録なし」

## 名前

- `createJudgmentHistoryUI` に任意の `resolveReferenceLabels(references)` を足す。引数は `{ ref, kind }` の配列。戻り値は `ref` から名前への対応（Map または object）。ホストは閲覧者の今の権限で名前を引く。
- 関数が無い、失敗した、名前が見つからない場合は「名前を確かめられません」と出す。IDを名前の代わりにしない。
- 個人KGの記録の名前は引かない（本文を出さないため）。
- OSSのWebホストは、手元のGraph（`/api/graph/entities/<id>`）の名前でつなぐ。

## 画面

- 詳細の先頭に区画「判断の根拠」を置く。種類ごとに、名前、使い方、判定を並べる。各参照の内部ID・版・digest・理由は「記録の詳細」の折りたたみに入れる。
- 次に区画「本人の考え」を置く。
- 一覧の判断の欄に、本人の考えの印を付ける。

## 検証

- 読み取り: 判断の枠組みの事象と `personal_answer` から、`kind`・`usage`・個人KGの参照ができる。採用していない案の使い方は混ざらない。resolved でない回答は参照にしない。
- UI: 3つの状態、使い方の言葉、名前の取得の成功・失敗・関数なし、内部IDが折りたたみの中にあること。
- 実ブラウザで、本番と同じ形の記録（参照IDだけの記録・新しい形の記録）で表示を確かめる。

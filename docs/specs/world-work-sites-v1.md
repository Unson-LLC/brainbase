# 世界の現場と把握の状態 v1（Spec）

Story: `docs/stories/story-world-work-sites-and-gaps-v1.md`

## 境界

- 世界は正本の投影。タスクはTask API（Canonical Task）、事業・人物・決定・関係は組織Graph。世界のための保存先や状態の二重管理を作らない。
- 純粋な投影は `@unson/brainbase-mcp/world` の `projectWorldWork` と `summarizeWorldWork`。読み出しと権限の絞り込みはホスト（組織版サーバー）の責任。
- ホストAPI（組織版が答える。OSS Personalは「未接続」を答える）
  - `GET /api/extensions/world/work-summary` → `{ version, status: 'ok', as_of, businesses: Record<code, WorldWorkSummary> }`、または `{ status: 'not_connected' | 'unavailable', reason }`。
  - `GET /api/extensions/world/businesses/:code/work` → `WorldWorkResponse`。

## 入力（ホストが正規化して渡す）

```ts
projectWorldWork({
  business: { id, code, name, summary, purpose, aliases, engagement_codes, other_business_codes },
  tasks: { state: 'complete' | 'partial' | 'failed' | 'forbidden' | 'not_connected', read_at, reason?, items: unknown[] },
  persons: { state, items: unknown[] },          // Graphの人物記録（id・name・aliases）
  decisions: { state, items: unknown[] },        // Graphの決定記録（id・title・decided_at・project_code）
  relations: { state, items: unknown[] },        // 事業の記録に入る/出る辺（relation・direction・counterpart）
  project: { owner, people, members_state, source_decision_ids, term_aliases },
}, { now })
```

## 業務の状態（A）

`status` を「記録上」の語で返す。`open` は pending・in_progress・waiting。`waiting_on` は原文。`due_at` を過ぎた未完了は `past_due: true`（記録上の期限超過。止まっているとは言わない）。

## 把握の状態（B）— 構造化された欄だけから出す

| kind | 条件 | 事実の例 |
|---|---|---|
| `assignee_unlinked_mentioned` | 担当欄が空、本文に組織Graphの人物ID（`per_…`）か氏名（空白を除いて3文字以上）がある | 本文に「山田 太郎」（per_…）がある。担当欄は空 |
| `assignee_unrecorded` | 担当欄が空、本文にも人物が見つからない（人物を読めなかったときは照合できないと書く） | 担当欄が空。本文に登録済みの人物は見つからない |
| `source_unlinked` | 出典リンク（`source_refs`）が0件 | 出典・関連記録へのリンクが0件 |
| `outcome_unlinked` | 本文に「完了条件」があり、出典リンクが0件 | 完了条件は本文にある。成果物・提示の記録は未接続 |
| `review_overdue` | 未完了で `review_at` を過ぎている | 見直し予定 9/25 を過ぎ、最終更新は 9/18 |

各項目は `fact`（分かっている事実）・`unknown`（未接続・未確認の対象と範囲）・`next_check`（次に確認すること）・`check_with`（分かるときだけ人物。分からなければ null）・`source`（system・record_id・fields）・`checked_at`（本文の確認メモの日付、無ければ記録の更新日時）・`read_at` を持つ。

## 関係

`link` は `recorded`（Graphの辺・担当欄・統合記録の `source_decision_ids`・決定の範囲コード）、`inferred`（本文中の人物、決定の題名に事業名・別名・事業に属す用語の別名を含む）、`unreadable`（読めなかった範囲）のいずれか。画面は線の種類を分ける（記録＝実線、推定＝破線、読めない＝灰色の点線）。

## 要約（世界の上位表示）

`summarizeWorldWork` は事業ごとに `{ state, read_at, reason, open, by_status, gaps: Record<kind, task_id[]>, partial }` を返す。件数を生んだタスクIDを必ず添える。総合点は作らない。読めない事業は `state` が complete 以外になり、0件とは別に描く。

## 置き場所

現場はタスクIDのハッシュで都市の外周のマスを選び、衝突は次のマスへ進める。マスの数は件数の段（24・48・80…）で決まるので、件数が段を越えない限り既存の現場は動かない。状態が変わっても動かない。

## 何のための仕事か（通り）

現場は `purpose_label`（タスクの正本の欄。前後の空白を除いた文字列、空なら null）をそのまま持つ。投影は言葉を補わない・言い換えない。

区画の中の配置（`districtStreetLots`）は言葉ごとの街区に分ける。

- 街区は言葉ごとに1つ。並び順は、その言葉の仕事の最も古い `created_at`（同じならタスクID）の順で、庁舎側から門側へ。言葉の無い仕事は最後（門の近く）の「未分類」街区。
- 街区の行数は `ceil(件数 / 4)`（最少1）。区画は作成順に、行ごとに左手前・右手前・左奥・右奥の順で埋める。新しい仕事は空いている次の区画に入り、古い仕事は動かない。街区の行が満ちたときだけ、その先の街区が1行ぶん門側へずれる。
- 街区の間には横道を1本入れ、街区の庁舎側の端に看板（言葉・件数）を立てる。
- 戻り値 `{ lots: { [taskId]: { x, z, facing, street } }, streets: [{ key, label, count, z_from, z_to }], rows, length }`。`label` は言葉、未分類は null。

## 不変条件

- 取得失敗・権限外・未接続・一部だけ読めた、を0件や問題なしにしない。
- 本文から推定した人物を担当として記録しない（推定の関係として出すだけ）。
- 世界から正本へは書かない。直す入口はホストのタスク画面・プロジェクト画面。

---
spec_id: round4-project-certainty-v1
title: 関係者の状態と不在確認の表示契約
status: implemented_pending_full_round_acceptance
maturity: implementation_ready_focused_logic
story_id: story-round4-project-certainty-v1
owner_repository: brainbase
design_reference: docs/ux-research/round4-project-certainty/design-references.md
---

# 関係者の状態と不在確認の表示契約

この仕様は、プロジェクト詳細の関係者欄で「未取得」「部分取得」「正本が空」を分けるための、表示側の小さな契約である。現行OSSのサーバーAPIを置き換えず、状態を返せるアダプターに対して任意に適用する。組織版のオーバーレイをOSSの正本へ混ぜない。

## 契約の現状と拡張

| 項目 | 現行OSSの意味 | この仕様で受ける入力 | 互換性 |
| --- | --- | --- | --- |
| `participants` | `GraphProjectDetail` の関係エッジ。読み取れた関係者 | 同じ配列 | 必須形を変更しない |
| `absenceConfirmed` | Graph一覧で、読み切った正本にプロジェクトが無いことを示す | 詳細の関係者不在の根拠には使わない | 一覧の既存意味を変更しない |
| `absence_confirmed` | 汎用コレクションの不在確認 | 詳細の関係者不在の根拠には使わない | サーバーの命名を変更しない |
| `participants_status` | 組織版の保存応答に現れた状態名 | `available`, `partial`, `unavailable`, `unknown`, `empty`。既存ホストの `ready` は `available` へ正規化 | 未指定でも既存レスポンスを読める |
| `participantsStatus` | JavaScript側の任意のキャメルケース別名 | `participants_status` と同じ値 | 両方があり不一致なら不正応答 |
| `participants_absence_confirmed` / `participantsAbsenceConfirmed` | **関係者専用**に、同じGraph読み取りを厳格検証したうえで関係エッジが空だと正本が確認したことを示す | `true` はサーバーが同一Graphの完全読取・厳格検証後だけ返す | 汎用 `absenceConfirmed` を流用しない |
| `participants_unavailable_reason` / `warnings` | 取得不能・部分取得の説明 | 任意の表示用文字列。新しい意味を推測しない | 既存の警告を捨てない |

`participants_status` と関係者専用の不在確認フィールドは、現行の `GraphProjectDetail` にはまだ存在しない。既存レスポンスを壊さないため、表示側では任意入力として受ける。ただし `participants_absence_confirmed=true` を返すサーバーは、同じGraphを完全に読み、重複ID・重複エッジ・端点などの厳格な正本検証を通した場合だけ返す。`absenceConfirmed` はプロジェクト一覧の不在であり、`issues=[]` や `local_graph`／Graph v2 だけでは関係者不在の証拠にならない。既存ホストが専用フィールドを返さない空詳細は `unknown` として扱い、ネイティブOSS側は専用フィールドを追加して健全な空Graphを維持する。

## 状態の意味

| 正規化状態 | `participants` が空 | `participants` が非空 | 表示の意味 |
| --- | --- | --- | --- |
| `available`（`ready` からの別名を含む） | 関係者専用の不在確認がある場合だけ空の確定。無ければ確認不能 | 読み取れた関係者を表示 | 状態の説明は不要 |
| `empty` | 専用の不在確認がある場合だけ空の確定。`empty` という状態名だけでは確定しない | 状態とデータの不整合。確認不能 | 「登録なし」または不整合 |
| `partial` | 未取得を含むため確認不能 | 既知の関係者を表示し、部分取得の理由を併記 | 未取得分を0件にしない |
| `unavailable` | 確認不能。登録なしと表示しない | 既知の関係者を表示し、全件未提供の理由を併記 | 再試行を提供 |
| `unknown` | 確認不能。登録なしと表示しない | 既知の関係者を表示し、未確認の理由を併記 | 再試行を提供 |
| 不明な値・両別名の衝突 | 不正応答 | 不正応答 | 空成功にしない |

## 表示状態と操作

| 入力 | 表示 | 操作 |
| --- | --- | --- |
| 読み込み中 | 関係者欄の読み込み中 | 既存の画面状態を維持 |
| `available` + 非空 | 関係者行 | 既存の役割訂正・関係終了を維持 |
| `partial` + 非空 | 関係者行 + 部分取得の理由 | 再試行。未取得分の追加・削除を推測しない |
| `unavailable`/`unknown` + 非空 | 関係者行 + 確認不能の理由 | 再試行。既知行だけ訂正可能 |
| 専用の不在確認＋空 | 「まだ関係者の登録がありません。」 | 既存の始め方を維持 |
| 空 + 状態無し・不在未確認（外部host） | 「関係者の有無を確認できません。登録なしとは判断できません。」 | 再試行 |
| 件数1以上 + 関係エッジ空、専用フラグ＋非空、または応答不正 | 確認済み件数を併記した不整合／応答の形式が不正の理由 | 再試行。0件・登録なしにはしない。非空の既知行は残す |
| HTTP/Graph読み取り失敗 | 失敗理由 + 再試行 | 再試行前に空成功へ遷移しない |

`project.people` の名前配列は、関係エッジの証拠と同じとは限らない。`participants=[]` と `project.people.length>0` が同時に来たときは、既知の件数を表示して不整合を知らせるが、名前配列を関係エッジとして自動採用しない。

## 正規化の擬似手順

1. `participants_status` と `participantsStatus` を読み、片方だけなら採用する。両方があれば同値を要求する。
2. `ready` は `available` へ写像し、許可されない文字列は不正応答にする。
3. `participants` が配列でない、または既存の関係エッジ形でない場合は不正応答にする。
4. `participants_absence_confirmed` の別名を読み、両方があれば同値を要求する。これはサーバー側で同一Graphの完全読取・厳格検証後にだけ付与された関係者専用フラグとして扱う。
5. 状態が `unavailable`、`unknown`、`partial` で空なら未確認表示へ進む。専用フラグがあっても取得不能・部分取得の状態を先に表示し、理由を捨てない。
6. 専用フラグがあり空なら空確認表示へ進む。ただし `unavailable`、`unknown`、`partial` は常に先に表示し、専用フラグがあっても空確認へ進めない。`empty` だけ、一覧の `absenceConfirmed`、`issues=[]`、`local_graph`／Graph v2 だけでは空を確定しない。
7. 件数・`people`・関係エッジの意味が衝突したら、確認済み件数を併記した不整合表示へ進み、0件に丸めない。専用フラグがtrueなのに関係エッジが非空の場合も同じ扱いとし、非空の既知行は不整合時も残す。
8. 読み取り失敗と不整合では、既存の読み込み関数と再試行ボタンを使う。新しい訂正APIは作らない。

## 検証契約

- `tests/ui/graph-projects-view.test.mjs` に、状態別の正規化と表示（非空＋unavailable、空＋unknown、空＋empty、件数不整合、別名衝突、未知状態、再試行）を追加する。
- 既存の未確認一覧テスト（同 `:732-768`）、Graph v1移行、確認済み空一覧、訂正理由のテストを回帰として実行する。
- `src/graph-web.ts` の既存項目は削除・意味変更しない。ネイティブOSSが健全な空Graphを確認できるよう、`projectDetailOf` の同一Graphスナップショットに対する厳格なGraph検証（重複ID・重複エッジ・端点）後に、`participantsAbsenceConfirmed` の専用フィールドを返す。検証範囲は関係者詳細の経路に限定し、`issues=[]` を完全性の代替にしない。
- 組織版統合では、保存fixtureだけでなく、新しいGETレスポンス、実画面のDOM、リビジョンまたはデータ時点を記録する。取得できない場合は未確認のままにする。
- 見た目の参照と採用原則は `docs/ux-research/round4-project-certainty/design-references.md` に記録する。デザイン参照は状態欄の理由表示に限り、画面全体の刷新を意味しない。

## 完了条件

この仕様の作成は実装完了を意味しない。採用候補を実装し、テストと独立レビューで受入条件を確認し、組織版の未接続部分を別の未確認として報告したときにこの候補を完了とする。

## 適用前パッチ

具体的な実装案と fail-before テスト案は、研究証拠rootの `implementation-proposals/` に保存している。これはレビュー用の適用前成果物であり、製品UIにはまだ適用していない。

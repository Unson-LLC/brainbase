---
round: round4
decision_set: round4-project-certainty
status: focused_candidate_decisions
date: 2026-10-10
---

# Round4 関係者状態候補の採否

現行の実装状態: 採用候補の製品コードと回帰テストは適用済み。以下の現行コード・次の操作・未適用記載は採否時点の履歴として保持する。独立した実装レビューと限定テストは、修復後の実UI検証やRound4全体の受入を代替しない。

この判断表は、関係者が未提供なのに「登録なし」と表示される候補だけを対象にする。保存fixtureで再現した意味上のリスクと、現行OSSの実API契約を分ける。採用判断は候補ごとに行い、全体145件の未確認を解消したとは扱わない。

## F-R4-PARTICIPANTS-OSS — 採用

**関連所見**: `P001:finding[4]`、`P017:finding[4]`、`P027:finding[4]`（Graph情報が unavailable なのに未登録へ遷移する候補）。

- **優先度**: P0相当。確認不能を不在と断定する状態・行動の不一致であり、利用者が価値判断に使う関係者情報を誤る。
- **根拠**: Round4の生保存 `observations/overlay-readback/detail.json` と独立GET `reviews/overlay-readback/response-1.json` は、`participants_status="unavailable"` と `participants=[]` を返しながら、ネストされた `project.participantCount=2`、`project.accountableCount=1`、`project.people.length=2` を持つ。独立レビュー `reviews/overlay-independent-review.md:16-24` は、現行表示が空配列を「まだ関係者の登録がありません。」へ直結し、状態・理由・警告を無視していると記録する。
- **現行OSSの確認**: `ui/graph-projects-view.js:95-122` は一覧の `absenceConfirmed` を扱うが、詳細正規化は状態を持たない。`ui/graph-projects-view.js:682-692` は詳細の空配列を空文言へ直結する。`src/graph-web.ts:210-221,391-418` は詳細に `participants_status` を返さない。既存の一覧テスト `tests/ui/graph-projects-view.test.mjs:732-768` は未確認一覧を0件扱いしないため、詳細に限定した硬化が必要である。
- **根本原因**: 状態／理由を受ける任意の正規化が無く、`participants=[]` が「正本で不在を確認した」と同一視される表示分岐になっている。保存された組織版fixtureのエンドポイントが現行OSSの契約へ接続されている証拠はまだない。
- **体験変更**: 非空の既知関係者は表示し、部分・未提供・未確認の理由を同じ欄の近くに出す。空かつ不在未確認は「登録なし」とせず、理由と再試行を出す。同一Graphの完全読取と厳格検証を通した関係者専用の不在フラグがあるときだけ空表示にする。
- **実装担当**: 親エージェントが割り当てるOSS UI担当。
- **対象**: `ui/graph-projects-view.js`、`tests/ui/graph-projects-view.test.mjs`。表示側は既存必須項目を変えず、`participants_absence_confirmed` / `participantsAbsenceConfirmed` を任意入力として受ける。ネイティブOSSで健全な空Graphを返す場合だけ、`src/graph-web.ts` に専用フィールドを狭く追加し、同一Graphの完全読取後に厳格Graph検証を通す。
- **次の操作**: `docs/stories/story-round4-project-certainty-v1.md` と `docs/specs/round4-project-certainty-v1.md` のACに沿って状態正規化、表示分岐、回帰テストを実装する。専用フラグ無しの既存空詳細は未確認のままにし、`absenceConfirmed`、`empty`、`issues=[]`、`local_graph`／Graph v2だけを不在根拠にしない。`unavailable`、`unknown`、`partial` は専用フラグがあっても常に先に理由を表示する。実装後に独立レビューを依頼する。
- **Before受入**: 現行の空配列が不在確認なしでも「まだ関係者の登録がありません。」になることを、保存レスポンスとUIテストで示す。
- **After受入**: (1) unavailable/unknown/partial＋空は未確認表示、(2) 非空＋partial/unavailableは既知行＋理由、(3) 関係者専用フラグ＋完全読取・厳格検証済みの空だけ空表示、(4) 件数不整合・`empty`／専用フラグtrue＋既知行は確認済み件数を併記した不整合表示にし既知行を保持、(5) 再試行と既知行の訂正導線が残る、(6) trueフラグの型不正は不正応答、をテストと独立レビューで確認する。
- **デザイン参照**: 状態欄の近くに理由を置き、既存の行・CTA・文脈を保つ原則は `design-references.md` に記録した。全面赤強調や無関係な画面の模倣は採用しない。

## F-R4-PARTICIPANTS-ORG-BOUNDARY — 保留

- **判断**: 組織オーバーレイへの接続と本番修正は保留。
- **理由**: 生保存は `fixture=true`、`scope=round4_local_overlay`、`authority=local_preview` で、独立レビューでも新鮮なDOMと本番GETの結合は未確認である（`reviews/overlay-independent-review.md:18,22-24`、`reports/round4-workflow-addendum.md:99-101`）。OSSの詳細APIにも `participants_status` はない。
- **次の操作／担当**: 組織ホスト担当が、実際に利用者が開くURLでGETのstatus、revision/data時点、DOMの関係者欄、再試行結果を採取し、どのアダプターが `participants_status` を供給するかを契約として記録する。その後、OSS候補との結合を独立レビューする。
- **未確認のまま残すもの**: オーバーレイv2サーバーの稼働とGET、UX04の実操作、productionでの体験改善。

## F-R4-145-GLOBAL — 保留（候補外の未確認境界）

- **判断**: Round4全体145件の未確認を、この候補の採用で解消したとはしない。
- **理由**: この作業は関係者状態の1候補に限定され、原資料の全参加者・全アクションセルを再実行していない。1件の不整合を直す準備や、OSSテストの成功は、全体の利用価値到達・本番反映・独立受入を意味しない。
- **次の操作／担当**: Round4統括担当が、未確認分母、実装済み候補、独立受入、実ユーザー価値の証拠を分離して再集計する。完了条件を満たさない項目は未確認として残す。

## 完了の扱い

この文書は採否を決めたものであり、実装・本番反映・Round4全体の完了報告ではない。採用候補は実装とテストと独立レビューが済むまで「実装待ち」と記録する。

## 実装ゲートの証跡

製品UIへ適用していない具体パッチ、fail-beforeテスト案、適用前チェックは、研究証拠rootの `implementation-proposals/design-gate.md`、`implementation-proposals/fail-before-tests.md`、`implementation-proposals/graph-project-certainty.patch`、`implementation-proposals/apply-graph-project-certainty-proposal.sh` に保存した。デフォルトのスクリプト実行は `git apply --check` のみで、`APPLY_PRODUCT_PATCH=1` を明示しない限り製品ファイルを変更しない。

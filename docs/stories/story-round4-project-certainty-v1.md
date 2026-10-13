---
story_id: story-round4-project-certainty-v1
title: 関係者の不在を「登録なし」と誤認せず、確認できる状態を保つ
status: implemented_pending_full_round_acceptance
created_at: 2026-10-10
controller: SIMPLIFICATION
owner_repository: brainbase
depends_on: ["story-local-web-graph-screens-v1", "story-project-dense-workspace-v1"]
evidence_scope: targeted_remediation_pass
design_reference_status: collected (focused_state_error_reference)
related_round4_findings: [P001:finding[4], P017:finding[4], P027:finding[4]]
---

# 関係者の不在を「登録なし」と誤認せず、確認できる状態を保つ

## 利用者成果

利用者がプロジェクトの関係者を開いたとき、データが未提供・部分取得・読み取り不能な状態を、関係者が登録されていない状態と取り違えずに判断できる。確認できた関係者はそのまま読み、確認できない理由と再試行の導線を近くで確認できる。正本が空だと確認できたときだけ「登録なし」と表示する。

## 対象と権限の境界

- 対象候補は、共有OSSの Graph プロジェクト詳細表示における関係者状態の正規化と表示である。
- 現在のOSSの正本は `src/graph-web.ts` のローカルGraphであり、プロジェクト詳細は `participants` の関係エッジを返す。詳細レスポンスには `participants_status` と関係者専用の不在確認はまだ定義されていない。
- Round4の組織版オーバーレイは別のアダプター境界であり、現行OSSのAPI証拠とは分ける。組織版の本番レスポンスをこのStoryだけで修正済みとは扱わない。
- 個人・組織・承認の新しい権限モデルや、新しい正本を追加しない。既存の読み取り、再試行、訂正導線を使う。

## Before（生証拠と現行コード）

Round4のオーバーレイ応答（`/Volumes/UNSON-DRIVE/codex-runtime-staging/worktrees/manual/brainbase-organization/organization-global-ux-20261007/docs/ux-research/cycle-global-01/round4/observations/overlay-readback/detail.json`）と独立GET保存（同 `reviews/overlay-readback/response-1.json`）では、トップレベルに `participants_status: "unavailable"`、`participants: []`、未提供理由と警告がある。一方で、この応答の `project.participantCount` は2、`project.accountableCount` は1、`project.people` は2件である。これは「登録なし」と断定できない状態である。ただし、`source.authority: "local_preview"`、`fixture: true`、`scope: "round4_local_overlay"` の保存なので、現在のOSS本番APIの実証ではない。

独立レビューは、現行オーバーレイUIが空配列を `ui/graph-projects-view.js:682-692` の「このプロジェクトには、まだ関係者の登録がありません。」へ直結し、`participants_status` と警告を無視していると記録している（`reviews/overlay-independent-review.md:16-24`）。同じレビューは、ネストされた件数と「未登録」が同時に出ることを不整合として扱い、取得元の推測や新鮮なDOMの採取は未確認としている（同 `:18`）。

現行OSSはすでにプロジェクト一覧で `absenceConfirmed` を使い、未確認の空一覧を0件として扱わないテストを持つ（`tests/ui/graph-projects-view.test.mjs:732-768`）。一方、詳細の型 `GraphProjectDetail`（`src/graph-web.ts:210-221`）には関係者の状態・不在確認がなく、`projectDetailOf` は関係エッジから `participants` を作るだけである（同 `:391-418`）。したがって、オーバーレイの候補とOSSの現状は同一視せず、下位互換のある表示硬化として扱う。

## After（採用候補の挙動）

- 関係者が1件以上あるときは、確認できた行を表示する。`partial`、`unavailable`、`unknown` の状態なら、関係者欄の近くに「一部または全件を確認できない」理由を表示し、未取得分を空として数えない。
- 関係者が空で、状態が `unavailable`、`unknown`、`partial`、または不在確認が無いときは、「登録なし」を表示せず、確認不能の理由と再試行を表示する。
- 関係者が空で、ホストが同一Graphの完全読取と厳格なGraph検証を通した関係者専用の不在確認フラグを返したときだけ「まだ関係者の登録がありません。」を表示する。ネイティブOSSはこの専用フラグを返し、既存の健全な空Graphを維持する。
- 件数が1以上なのに関係者配列が空、または `people` と関係エッジの意味が衝突するときは、件数を0へ丸めず不整合として確認不能表示にする。
- 既知の関係者行の役割訂正など、既存の訂正導線は維持する。確認不能を理由に未確認の関係を自動追加・削除しない。

## 受入条件

- [ ] **AC-01（不在と未確認の分離）**: `participants_status=unavailable|unknown` で `participants=[]` のとき、UIは「登録なし」を出さず、確認不能の状態・提供された理由・再試行を出す。
- [ ] **AC-02（部分取得）**: `participants_status=partial` のとき、空なら未確認とし、非空なら確認できた関係者を表示したうえで部分取得を知らせる。未取得分を0件や全件として表示しない。
- [ ] **AC-03（正本が空の確認）**: `participants_absence_confirmed=true`（またはキャメルケース別名）が同一Graphの完全読取・厳格検証後に返され、`participants=[]` のときだけ、空状態を「登録なし」と表示する。`unavailable`、`unknown`、`partial` は専用フラグがあっても常に未確認表示を優先する。`participants_status=empty`、一覧の `absenceConfirmed=true`、`issues=[]`、`local_graph`／Graph v2だけでは不在確認としない。ネイティブOSSの健全な空Graphはサーバーが専用フラグを返す。
- [ ] **AC-04（非空と状態の矛盾）**: 件数または `people` が1以上なのに関係エッジが空のとき、既知の件数を併記し、不整合・確認不能として表示する。「登録なし」にはしない。`participants_status=empty`、または専用不在フラグがtrueなのに既知行がある場合も、理由と確認済み件数を表示し、既知行を残す。
- [ ] **AC-05（状態名と下位互換）**: `participants_status`（生データ）と `participantsStatus`（JSアダプター）のどちらも受けられる。既存OSSの `participants`、一覧の `absenceConfirmed`、汎用コレクションの `absence_confirmed` を必須化・変更しない。未指定の詳細状態は新しい「不在確認済み」と推測しない。
- [ ] **AC-06（再試行）**: 読み取り失敗・不整合・確認不能の各状態から、既存の読み込み／「再試行」経路を使って再取得できる。再試行前に空の成功へ遷移しない。
- [ ] **AC-07（訂正の境界）**: 確認不能な空状態から、関係者がいないという理由で自動訂正や追加を提案しない。既知の関係者の既存訂正は、表示された関係エッジのダイジェストと理由入力を使って維持する。
- [ ] **AC-08（壊れた応答）**: 状態名の衝突、型不正、専用フラグの型不正、必須項目欠落は不正応答として理由と再試行を表示する。壊れた応答を空成功として扱わない。
- [ ] **AC-09（証拠の境界）**: OSSのテストと実ブラウザ確認、組織版の新鮮なGET・DOM確認を分けて記録する。保存済みfixtureだけで組織版の本番修正完了、または全体145件の解消を主張しない。
- [ ] **AC-10（見た目の適用範囲）**: 表示文言・理由・再試行を対象欄の近くに置き、既存の画面階層と訂正導線を保つ。全面的な赤強調、無関係なフォームや広告の模倣、レイアウト刷新はこのStoryの対象外とする。

## 実装担当と次の操作

- **実装担当**: 親エージェントが割り当てるOSS UI担当。
- **対象**: `ui/graph-projects-view.js` と `tests/ui/graph-projects-view.test.mjs`。ネイティブOSSが専用フラグを返す場合は、`src/graph-web.ts` の任意フィールドとGraph検証ゲートを狭く追加する。汎用の一覧不在フラグは流用しない。
- **次の操作**: 状態名の正規化、関係者表示の状態分岐、空・部分・不整合・再試行のテストを実装し、既存Graph UI契約テストを実行する。組織版は別途、実際のhost GETと新鮮なDOMを取得してから接続する。
- **実装前の確認**: `docs/ux-research/round4-project-certainty/graphify-impact-context.json` を参照し、影響グラフが `missing_graph` であることを踏まえて、実装後に対象ファイルと既存テストの影響を再確認する。

## 対象外と完了条件

組織専用UI、サーバー契約の強制変更、Graphのデータ補正、別の正本、全体145件の未確認の解消は対象外である。このStoryは候補の判断と実装準備だけでは完了しない。採用したOSS表示硬化を実装し、対象テストと独立レビューでACを確認してから完了とする。

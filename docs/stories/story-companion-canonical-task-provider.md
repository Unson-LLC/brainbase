---
story_id: story-companion-canonical-task-provider
title: Mac Companion向け正本Task APIと承認時の一度だけ作成
status: active
created_at: 2026-07-14
updated_at: 2026-07-14
period: 2026-W29
view: product
responsibility_authority_docs:
  - path: docs/responsibility-authority/companion-canonical-task-provider.json
architecture_docs:
  - docs/architecture/story-companion-canonical-task-provider.md
  - docs/architecture/ADR-016-canonical-task-single-writer.md
spec_docs:
  - docs/specs/story-companion-canonical-task-provider-spec.md
---

# Mac Companion向け正本Task APIと承認時の一度だけ作成

## 背景

BrainbaseはNocoDBのTask表をTaskの正本として既に利用している。一方、既存の
`/api/nocodb/tasks` は担当者を自由入力の表示名として扱い、Mac Companionが必要とする
版管理、発生元、待ち状態、冪等作成を契約として提供していない。

Mac Companion側に別のTask正本を作るのではなく、Brainbaseが既存Task表を正規化した
Companion APIを提供する。また、会議のTask候補を承認したときも同じ正本へ一度だけ
Taskを作成し、承認済みなのにTaskがない状態と、再試行による重複を防ぐ。

## 誰のため

Brainbaseを個人の知識と実行の正本として使い、Mac Companionで日常的にTaskを確認、
着手、待ち、完了へ進めるownerのため。会議から生まれたTaskも手入力Taskも、発生元に
関係なく同じ一覧と状態遷移で扱えることを狙う。

## 利用ジャーニー

1. 会議や受信情報からTask候補が生まれる。
2. ownerが要対応画面で候補の内容と担当者を確認する。
3. 承認するとBrainbaseのTask正本へ一度だけ作成される。
4. Mac CompanionのTask画面に同じTaskが現れる。
5. ownerが着手、待ち、完了へ更新し、変更はBrainbase正本へ戻る。

このStoryは3の正本化と5のAPI境界を実装する。候補抽出は上流、Macの画面構成は下流の
Storyであり、Taskの永続化正本を増やさない。

## 成功指標

- 同じ承認や作成要求を再試行しても、正本Taskの重複作成数が0件である。
- 承認成功後に正本Task IDがない状態を0件にする。
- 担当者の更新要求で自由入力名を権威値として受理する経路を0件にする。
- Mac Companionの実クライアント契約テストがBrainbaseの実API経路に対して通る。

## ユーザーストーリー

佐藤として、Mac Companionで自分のTaskを確認・登録・進行・待ち・完了に変更したい。
どの操作もBrainbaseのTask正本へ反映され、担当者はGraph PeopleのIDで一意に決まり、
会議から承認したTask候補は同じTaskとして一度だけ現れてほしい。

## 受け入れ基準

- [ ] **ac:1 canonical-read**: 認証済みownerが `GET /api/companion/tasks` で正本Taskを状態、担当者、優先度、期限条件付きで取得でき、cursorで続きを取得できる。応答はMac契約の `items`, `total_count`, `count_status`, `next_cursor`, `read_status`, `warnings`, `as_of` を必須とする。
- [ ] **ac:13 canonical-get**: `GET /api/companion/tasks/:taskId` は固定正本storeのTaskをMac契約で返し、別storeまたは不存在IDは `task_not_found` にする。
- [ ] **ac:2 canonical-create**: `POST /api/companion/tasks` は必須の冪等キーを受け、同じ要求の再送では同じTaskを返し、内容が異なる再利用は409にする。
- [ ] **ac:3 canonical-update**: `PATCH /api/companion/tasks/:taskId` と状態遷移APIは期待版を必須にし、不一致を409で返す。
- [ ] **ac:4 person-id-boundary**: 担当者はGraph SSOTの `person_id` だけを入力権限とし、表示名は投影として保存する。存在しないIDは拒否し、旧自由入力値を推測でID化しない。
- [ ] **ac:5 lifecycle**: Taskは `pending`, `in_progress`, `waiting`, `completed` を持ち、待ち対象、再確認日時、完了日時を正本へ保存する。
- [ ] **ac:6 source-and-audit**: 発生元参照と変更者を保存し、作成・更新・状態遷移をBrainbase監査ログへ残す。
- [ ] **ac:7 fail-closed**: NocoDBまたはGraphが利用不能な場合、空一覧や未担当として成功扱いせず、構造化503を返す。
- [ ] **ac:8 approval-materialization**: `task_store` を書き戻し先に持つ会議Task候補の承認は、Task作成が全件成功した後だけhuman stepをapprovedにし、応答消失後の再試行でも同じTask ID群を返す。
- [ ] **ac:9 compatibility**: 既存 `/api/nocodb/tasks` とTask以外の承認フローは挙動を変えない。
- [ ] **ac:10 auth**: Companion Task APIは既存Companion APIと同じnative/service/internal認証およびowner境界を通る。
- [ ] **ac:11 concurrent-once**: 同じ冪等キーの並行POSTと同じhuman stepの並行承認を単一writer process内で実行してもTaskは一度だけ作られる。別processは永続writer tokenを取得できず503になり、自動takeoverしない。
- [ ] **ac:12 visible-approval-result**: 承認応答は作成済みTask ID、除外候補、警告、再生有無を返し、部分失敗を成功または空へ変換しない。
- [ ] **ac:14 wire-contract**: 状態遷移はMacが送る `to_status` を受け、版競合は `version_conflict`、承認成功はトップレベルの `materialized_task_ids` を必ず返す。
- [ ] **ac:15 destination-fencing**: 作成行の冪等キーは正本Task表で一意にし、更新・遷移は版と最終操作key/fingerprintを同一row patchで保存する。writer tokenは自動takeoverせず、旧process停止を運用確認した明示回復時だけ移譲する。
- [ ] **ac:16 durable-recovery**: workflow承認の全Task ID、human step/runの目標状態、監査checkpoint、後処理phaseをPostgres調停台帳へ保存し、起動時と読取・再試行前にWorkflow JSONへ決定的に再投影する。
- [ ] **ac:17 task-store-approval-auth**: `task_store` 承認は既存human-step解決権限を先に検証し、承認済み候補をactor付きservice-internal commandとして固定storeへ書く。Graph確認済みの別担当者を選べるが、承認者の直接Task API権限は拡張しない。
- [ ] **ac:18 owner-scope**: ownerの作成で担当者省略時はconfigured ownerを補完し、ownerの一覧・単体取得・更新はconfigured owner担当Taskだけに限定する。未担当または別personのTaskは読取時404、担当解除・別person指定は403にする。
- [ ] **ac:19 lifecycle-and-query**: completedを終端とする許可遷移表と `invalid_transition` を提供し、Macが送る反復status/priority、due_after/due_before、cursor、limitを公開契約として検証する。
- [ ] **ac:20 review-authority**: Brainbaseが安定候補IDを投影し、Macの `response_ref.review_items` を候補IDで元outputへ結合する。承認・拒否・修正依頼の全体判定、`decision_mode`/`resolution`対応、`edited_fields`だけの上書き、選択担当者のGraph再確認を適用する。
- [ ] **ac:21 writer-lifecycle**: HTTP listen前のwriter claim/reconcile、graceful shutdown release、expected token付き明示回復CLIを提供し、自動takeoverしない。
- [ ] **ac:22 idempotent-workflow-audit**: 起動・読取・retryによる同じworkflow再投影は決定的監査IDをupsertし、監査行を重複させない。

## Done Evidence

- Unit: field mapping、People検証、冪等作成、版競合、状態遷移をservice/repository単位で検証する。
- Integration: Companion認証guardからTask APIまでと、Workflow承認から正本化までを検証する。
- E2E: Mac Companionのconsumer branch `codex/canonical-task-lifecycle-integration`
  （基準commit `cb9c293`）が使うHTTP schemaで一覧、作成、更新、待ち、完了、競合、障害を再生する。
- Runtime: 正本Task表の列検査、Brainbase実プロセスのAPI応答、Mac実クライアントからの接続を記録する。

## Failure Modes

- FM-001: NocoDBが利用不能なら503を返し、空一覧や作成成功へ変換しない。
- FM-002: Graph Peopleが利用不能、またはperson IDが存在しない場合は担当者付き書き込みを拒否する。
- FM-003: 同じ冪等キーに異なる内容が来た場合は409にし、既存Taskを上書きしない。
- FM-004: 期待版が現行版と異なる場合は409と現行Taskを返し、変更を適用しない。
- FM-005: 承認由来のTaskが1件でも正本化できない場合、human stepをpendingのまま残す。
- FM-006: 旧行に自由入力担当者だけがある場合、person IDを推測せず警告付き未解決として返す。
- FM-007: 担当者未解決、曖昧、ignored、またはlegacy文字列だけの候補は、Macのreview itemでGraph確認可能な担当者へ解決されない限りpendingのまま409にし、候補別理由を返す。
- FM-008: 同時実行の永続調停台帳が利用不能なら503にし、プロセス内lockだけで処理を続けない。
- FM-009: NocoDB正本表で冪等キー一意制約または最終操作列を確認できなければ、書き込み経路を503で停止する。
- FM-010: writer token保持processが異常終了した場合は自動takeoverせず503を維持する。運用者が旧process停止を確認して明示回復した後だけ、新writerが正本Taskの一意キーまたは同一操作マーカーから再開する。
- FM-011: ownerが未担当・別person Taskのopaque IDを指定した場合は存在を開示せず404にする。担当解除・別personへの変更要求は403にする。
- FM-012: 許可表にない状態遷移は409 `invalid_transition` とcurrent Taskを返し、変更しない。

## Release / Rollback / Observability

- Release: Postgres調停schemaと単一writer tokenをapply/checkし、次にTask表の追加列と冪等キー一意制約をapply/checkする。旧writerのgraceful releaseを確認してBrainbase APIを再起動し、実API契約を確認してからMacを反映する。
- Rollback: Macを先に旧版へ戻し、BrainbaseのPRをrevertする。追加列は後方互換のため即時削除しない。
- Observability: Task APIの構造化error code、workflow outputのmaterialized task IDs、監査ログのactor/sourceを確認する。
- Support: migration checkで列不足を確認し、Graph/NocoDBの障害とデータ0件を区別して復旧する。
- Release gate: 正本store ID、NocoDB列、永続調停台帳、単一owner scopeを`--check`で確認し、不一致なら起動後の書き込みをfail-closedにする。

## 実装タスク

1. `[DB]` Postgres調停schemaと、既存Brainbase Task表の正規化列・冪等キー一意制約をcheck/applyする移行スクリプトを作る。
2. `[BE]` NocoDB Task repositoryとGraph People検証を組み合わせた正本Task serviceを作る。
3. `[BE]` `/api/companion/tasks` の一覧、単体取得、作成、更新、状態遷移を既存認証境界へ登録する。
4. `[BE]` Workflow `task_store` 承認を同じ作成serviceへ接続し、冪等な再試行を保証する。
5. `[QA]` BDD、route integration、repository unit、既存承認回帰を実行し、VibeProへ証跡を記録する。
6. `[QA]` Mac `cb9c293` の固定wire fixtureで一覧完全性、単体取得、`to_status`、トップレベルTask ID、競合codeを検証する。
7. `[QA]` 同一冪等keyの並行POST、同一版の異内容変更、同一stepの並行承認、別process拒否、明示writer回復、各保存境界での停止と前進回復をfixtureで検証する。
8. `[BE]` server起動・終了・明示回復へwriter lifecycleを接続し、Workflow再投影監査を決定的IDでupsertする。

ブランチ: `codex/canonical-task-provider`

## スコープ外

- Mac Companion UIの実装。
- 旧自由入力担当者の自動名寄せ。
- 全プロジェクトの既存Task表を一括統合する移行。
- NocoDBを置き換える新しいTaskデータベースの導入。

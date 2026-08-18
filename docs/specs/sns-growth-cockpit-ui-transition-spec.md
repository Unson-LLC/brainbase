---
spec_id: SPEC-sns-growth-cockpit-ui-transition
title: SNS Growth Cockpit UI Transition
status: draft
date: 2026-05-12
story_id: story-sns-posting-cockpit
related_adrs:
  - ADR-011
  - ADR-012
  - ADR-013
related_specs:
  - SPEC-sns-persona-brain-gate
  - SPEC-personal-kg-sns-seed-mvp
  - SPEC-sns-growth-cockpit-wireframe-v0
  - SPEC-sns-mobile-review-flow
implementation_files:
  - public/modules/app/plugin-registration-mixin.js
  - public/modules/pages/sns-growth-page.js
  - public/modules/ui/views/sns-growth-cockpit-view.js
  - public/sns-growth.html
  - server/routes/sns-growth.js
  - server/services/sns/sns-ledger-publish-service.js
  - server/services/sns/posting-ledger-repository.js
  - server/sql/sns-posting-ledger-schema.sql
  - scripts/import-sns-review-pack-to-ledger.js
test_files:
  - tests/ui/views/sns-growth-cockpit-view.test.js
  - tests/server/routes/sns-growth.test.js
  - tests/sns/publishing/sns-ledger-publish-service.test.js
  - tests/sns/ops/import-sns-review-pack-to-ledger.test.js
  - tests/sns/posting-ledger/posting-ledger-repository.test.js
  - tests/e2e/sns-growth-cockpit.spec.js
---

# SPEC: SNS Growth Cockpit UI Transition

## 目的

SNS Growth Cockpit は予約投稿カレンダーだけではない。

Brainbase が、今日なにを見て、なにを考え、なにを出し、なにを学ぶかを回すための operations cockpit とする。

初期画面の主役は `Today｜今日の運用判断` である。Ship Calendar は「いつ何が出るか」「どの状態か」を見る実務画面として成立させるが、SNS Growth の入口そのものにはしない。

2026-05-13 時点の Ship Calendar image は、`Ship Calendar` 画面の layout direction として扱う。左 navigation、週カレンダー、右 detail panel、status summary は採用する。ただし visual treatment は Brainbase 本体の dark command surface に合わせる。`Today` 初期画面の visual direction ではない。

## Invariants

- **INV-0**: 初期表示は 1 つの判断に集中する。`Today｜今日の運用判断` では、詳細表示する投稿候補を 1 件に限定し、複数候補・調査一覧・metrics は drawer / secondary view に逃がす。
  - 検証: UI test で initial screen の detailed post body が 1 件だけであること。
- **INV-1**: SNS Growth Cockpit は Brainbase 内の tool として表示され、Brainbase 本体へ戻る導線を常に持つ。
  - 検証: E2E で `Back to Brainbase` または equivalent navigation が全主要画面から利用できること。
- **INV-2**: 初期表示の中心は `Overview｜今日の運用判断` であり、calendar grid を初期表示の主役にしない。
  - 検証: UI test で Overview の primary heading と判断カードが表示され、Ship Calendar は補助 entry として表示されること。
- **INV-3**: 主な遷移軸は `Direct AI -> Research Board -> Review Desk -> Ship Calendar -> Learning Loop` である。
  - 検証: E2E で各画面 / tab / route へ順に遷移できること。
- **INV-4**: Ship Calendar は `Review Desk` と `Overview` の両方から到達できる。
  - 検証: E2E で Review 中の投稿を schedule した後、Ship Calendar で同じ投稿が status badge 付きで確認できること。
- **INV-5**: 投稿状態は `review_needed`, `approved`, `scheduled`, `posted`, `skipped`, `learning_ready`, `deleted` のいずれかとして表示される。
  - 検証: Unit / UI test で全 status が badge としてレンダリングされること。
- **INV-6**: Persona Brain / Graph Check / Quality Gate は投稿レビュー時に見えるが、初期表示では詳細を畳む。
  - 検証: UI test で accordion collapsed 初期状態と展開状態を確認する。
- **INV-7**: raw metrics や投稿状態は Graph へ直接書き込まない。Learning Loop は candidate-store への learning candidate 化を入口にする。
  - 検証: API / repository test で Learning action が Graph writer を呼ばないこと。
- **INV-8**: Brainbase sidebar は `今日 / 脳 / 作る / 動かす / 学ぶ / システム` の operating loop を表現し、SNS Growth は `作る` に属する。
  - 検証: E2E で sidebar group labels と `SNS Growth` active state が表示されること。
- **INV-9**: SNS Growth の色・タイポ・border・surface density は Brainbase 本体の design tokens (`--bg-*`, `--surface-*`, `--text-*`, `--accent-color`, `--font-sans`) を使い、白い standalone admin app に見せない。
  - 検証: CSS review で SNS Growth 固有 palette が Brainbase token を参照し、body が dark command surface と同じ背景/文字体系を使うこと。

## Contracts

### Contract-1: Brainbase Entry Contract

- **input**: Brainbase navigation context
  - current workspace / session
  - authenticated actor
  - active tool id `sns-growth`
- **output**: SNS Growth Cockpit shell
  - breadcrumb: `Brainbase / SNS Growth`
  - back action: Brainbase の直前 context または Home
  - account display: `@AIBizNavigator` など現在の SNS account
  - sidebar groups:
    - `今日`: Ohayo / 今日の判断 / Inbox
    - `脳`: Knowledge Graph / Personal KG / People / Orgs / Philosophy / Memories
    - `作る`: SNS Growth / Content Studio / Research Board / Drafts
    - `動かす`: Tasks / Calendar / Automations / Integrations
    - `学ぶ`: Feedback / Learning Candidates / Reports
    - `システム`: Settings / Members
- **preconditions**:
  - actor は SNS Growth tool を閲覧できる
- **postconditions**:
  - Brainbase global navigation を失わない
  - SNS Growth 内の tab / route 遷移で Brainbase sidebar が消えない
  - `SNS Growth` は `作る` group の active item として見える
  - activity bar の `SNS Growth` entry は追加導線であり、既存の Sessions / Portal / Tasks / Terminal / File Viewer の分岐を変更しない
  - Brainbase Home の `SNS Growth` entry は `window.location.href` ではなく `panel-layout-manager` の workspace overlay を開く
  - `abSessionsBtn` または `Back to Terminal` で SNS Growth overlay を閉じ、Terminal / Sessions context に戻れる
  - `abSessionsBtn` は既存どおり panel layout の全 panel を閉じ、session list / terminal context を primary surface に戻す
  - mobile bottom navigation の `SNS` entry は `panel-layout-manager` 経由で同じ `sns-growth-overlay` を開き、`/sns-growth.html` へ遷移しない
  - mobile viewport では初期surfaceを `今日のSNS判断` inbox とし、weekly calendar grid は主表示にしない
  - `abPortalBtn`, `workspaceModeTerminalBtn`, `workspaceModePortalBtn`, `portalBackTerminalBtn` は既存どおり Portal overlay と Terminal surface を切り替える
  - file viewer close flow の `targetSessionId` は既存どおり closed session または current session の active file/root override を消し、必要な場合だけ対象 session に戻す
- **error cases**:
  - account 未接続: account setup empty state を表示し、他画面を壊さない

### Contract-2: Today Overview Contract

- **input**:
  - today date
  - current review pack summary
  - pending research summary
  - ship status summary
  - learning summary
- **output**:
  - 今日の問い:
    - 誰の脳に入るか
    - 何を調査するか
    - 何を出すか
    - 何を学ぶか
  - next action cards:
    - Direct AI
    - Research Board
    - Review Desk
    - Ship Calendar
    - Learning Loop
  - current review decision:
    - 今日レビューする 1 件
    - 読者の気持ち
    - 引用元 / KG source
    - status action
- **preconditions**:
  - `/ohayo` 未実行でも empty state が出る
- **postconditions**:
  - calendar は compact week strip または Ship Calendar への entry として見える
  - full weekly calendar grid は Overview では表示しない
- **error cases**:
  - data source unavailable: 操作を止めず、該当 panel のみ unavailable 表示にする

### Contract-3: Direct AI Contract

- **input**:
  - previous learning notes
  - persona assumptions
  - content focus
  - avoid phrasing
- **output**:
  - 今日の AI 指示
  - research run request
  - optional `/ohayo` generation trigger
- **preconditions**:
  - Graph Check / Persona Brain の前提が表示される
- **postconditions**:
  - AI 指示は Research Board の search/query context に渡る
- **error cases**:
  - Graph unavailable: 投稿本文生成ではなく、調査指示の保留として表示する

### Contract-4: Research Board Contract

- **input**:
  - X search results
  - bookmarks
  - news candidates
  - KG source candidates
- **output**:
  - candidate list grouped by `Peer`, `Overseas`, `Bookmark`, `KG`
  - Use / Hold decision
  - source URL and source metadata
- **preconditions**:
  - source URL がある candidate は外部 source を開ける
- **postconditions**:
  - `Use` candidate は Review Desk の draft source として参照できる
  - `Hold` candidate は hold reason を保持する
- **error cases**:
  - X API read budget exceeded: existing candidates は見えるが追加調査を止める

### Contract-5: Review Desk Contract

- **input**:
  - ledger post record
  - draft body
  - source references
  - Persona Brain snapshot
  - Graph Check snapshot
  - Quality Gate snapshot
- **output**:
  - editable post body
  - status transition controls
  - source confirmation
  - evidence accordions
- **preconditions**:
  - post record は SNS Posting Ledger に存在する
- **postconditions**:
  - body edit は revision として保存される
  - approve / schedule / skip は status transition として保存される
  - successful status transition は `SNS Growth Cockpit` 内の success feedback として見える
  - `approved` になった投稿では `approve` action を残さず、次に実行できる `schedule` / `publish dry-run` / `publish` を表示する
- **error cases**:
  - invalid status transition: UI で不可操作にするか API が 409 を返す

### Contract-6: Ship Calendar Contract

- **input**:
  - ledger posts in date range
  - status
  - scheduled datetime
  - posted URL
  - learning_ready flag
  - deleted timestamp/source/reason
- **output**:
  - full weekly calendar grid
  - date range controls
  - account / filter controls
  - status summary cards
  - right post detail panel
  - status badge
  - daily post count
  - selected post entry to Review Desk
  - collapsed evidence rows: Persona Brain / Graph Check / Quality Gate / Reader affect
- **preconditions**:
  - date range は必ず明示される
- **postconditions**:
  - scheduled / posted / skipped / learning_ready / deleted が一目で分かる
  - selected post の body / source URL / schedule datetime / status transition controls が右 panel で編集できる
  - deleted record は投稿URLを履歴として表示し、削除理由を確認できる
  - Ship Calendar 上の insight banner は topic balance warning を表示してよい
- **error cases**:
  - 0件: empty week と action to Direct AI / Review Desk を出す

### Contract-6b: SNS Posting Ledger Live Backend Contract

- **input**:
  - `/ohayo` review pack JSON
  - `date`, `slot_index`, `lane`, `body`, `source_url`, `persona_brain`, `graph_check`, `quality_gate`
- **output**:
  - `GET /api/sns-growth/posts` returns posts and status summary for a date range
  - `POST /api/sns-growth/review-pack` idempotently creates or updates posts by account/date/slot
  - `PATCH /api/sns-growth/posts/:id` stores body edits, memo, status transitions, posted URL, metrics snapshot, deletion metadata
- **preconditions**:
  - production durable store uses PostgreSQL when `SNS_POSTING_LEDGER_DATABASE_URL` is configured
  - if the dedicated SNS URL is not configured, production runtime uses `INFO_SSOT_DATABASE_URL` / `INFO_SSOT_DB_URL` for the shared Lightsail PostgreSQL database
  - generic `DATABASE_URL` must not override the dedicated SNS URL or Info SSOT URL for this ledger
  - JSON file persistence is permitted only when `BRAINBASE_TEST_MODE=true` and `SNS_POSTING_LEDGER_MODE=json_test`; production without PostgreSQL fails closed
- **postconditions**:
  - Peer Circle and News posts preserve source type and source URL
  - `posted -> deleted` preserves `posted_url` and records `deleted_at`, `deletion_source`, `deletion_reason`
  - `deleted` records are operational history and are not candidates for feedback learning handoff
  - invalid status transitions return an error before mutation
  - Graph SSOT is not mutated by Ledger writes
- **error cases**:
  - invalid draft payload returns 400
  - invalid status transition returns 409
  - missing post id returns 404

### Contract-6c: SNS Publish Execution Bridge Contract

- **input**:
  - SNS Posting Ledger post id
  - interactive publish mode: `dry_run=true` only
  - reviewed Ledger body and title
- **output**:
  - `POST /api/sns-growth/posts/:id/publish`
  - dry-run result from the SNS post executor
  - actual publish result with `posted_url`, `posted_at`, and `status=posted` is produced only by the scheduled runner after tenant authorization and PostgreSQL claim
- **preconditions**:
  - `/api/sns-growth` requires authentication and the `admin_api` tenant guard
  - direct non-dry-run publish returns HTTP 409 `sns_direct_public_publish_disabled`
  - scheduled public posting requires `confirm_public_post=true` and a claimed `publishing` row
  - dry-run statuses are `approved`, `scheduled`, or `publishing`; public publish status is `publishing` only
  - `review_needed`, `skipped`, `learning_ready`, and already `posted` records are not publishable
  - dry-run may execute against the same body/title but must not mutate the Ledger
  - the runtime executor may call `/Users/ksato/workspace/common/ops/scripts/sns_post.py`; UI/tests must inject a fake executor
- **postconditions**:
  - the scheduled runner claims `scheduled -> publishing` transactionally before provider work
  - only `publishing -> posted` is allowed after provider success
  - posted records preserve the returned X URL in `posted_url`
  - Ledger write remains operational state; Graph SSOT is not mutated by publish execution
- **error cases**:
  - missing publish service returns 503
  - missing explicit public confirmation returns 400
  - invalid status returns 400
  - executor result without posted URL returns 400

### Contract-6d: Deleted X Post Contract

- **input**:
  - posted SNS Posting Ledger record
  - operator confirmation that the X post was deleted outside Brainbase
  - optional deletion reason from the detail memo
- **output**:
  - `PATCH /api/sns-growth/posts/:id`
  - status `deleted`
  - `deleted_at`
  - `deletion_source=manual_x_delete`
  - `deletion_reason`
- **preconditions**:
  - only `posted` and `learning_ready` records can be marked deleted
  - `posted_url` must not be cleared by deletion marking
- **postconditions**:
  - Ship Calendar shows a deleted badge and the historical X URL
  - feedback / learning handoff does not treat `deleted` records as `learning_ready`
  - Graph SSOT is not mutated by deletion marking
- **error cases**:
  - invalid status transition returns 409
  - missing post id returns 404

### Contract-6a: Ship Calendar Visual Slice Contract

- **input**:
  - static fixture post records
  - accepted Ship Calendar visual direction
  - Brainbase activity bar entry
- **output**:
  - Brainbase Home renders SNS Growth as an in-shell workspace overlay
  - `/sns-growth.html` remains available as a standalone development/review page
  - Brainbase loop navigation is visible
  - selected post detail panel shows body, source URL, schedule datetime, status action controls, and collapsed evidence rows
- **preconditions**:
  - ledger API is not required for this slice
- **postconditions**:
  - actions are local/no-op and do not mutate Graph or Ledger
  - the panel can be reached from the existing Brainbase activity bar without altering terminal/session navigation
  - `ab-sns-growth-btn` is the only new activity bar branch in `plugin-registration-mixin.js`
  - clicking `ab-sns-growth-btn` keeps the browser URL on Brainbase Home
  - clicking `ab-sessions-btn` closes `sns-growth-overlay` and restores terminal stage display
  - existing `abSessionsBtn` and `targetSessionId` branches keep their previous behavior and are only in scope as regression-sensitive context
  - final `Today` entry remains a separate later route
- **error cases**:
  - fixture data missing: page still renders the Brainbase loop shell and empty calendar state

### Contract-7: Learning Loop Contract

- **input**:
  - posted records
  - posted URLs
  - metrics snapshots
  - reaction notes
  - original hypothesis / Persona Brain
- **output**:
  - hypothesis result
  - Persona Brain update proposal
  - candidate-store learning candidate request
  - next Direct AI instruction seed
- **preconditions**:
  - learning_ready post または posted post がある
- **postconditions**:
  - learning は Graph へ直書きされず candidate-store に送られる
  - SNS Posting Ledger の `learning_candidate_id` に作成済み candidate id が戻される
  - candidate-store draft の `source_system` は `sns-feedback`、`source_event_ids` は `sns-post:<ledger_post_id>` で重複防止される
- **error cases**:
  - metrics unavailable: manual observation note で candidate 化できる
  - posted URL または metrics snapshot がない投稿は candidate-store handoff しない

## Scenarios

### S-1: Brainbase から SNS Growth に入る

- **given**: actor が Brainbase Home を開いている
- **when**: `作る > SNS Growth` を選択する
- **then**: `Today｜今日の運用判断` が表示され、Brainbase sidebar と `Back to Brainbase` が見える
- **検証**: `tests/e2e/sns-growth-cockpit.spec.js`

### S-2: 今日の AI 指示から調査へ進む

- **given**: Overview に前回 learning summary が表示されている
- **when**: Direct AI で focus / persona / research target / avoid phrasing を保存し、調査開始する
- **then**: Research Board に候補が追加され、各候補に Use / Hold 判定が表示される
- **検証**: `tests/sns/cockpit/direct-ai-flow.test.js`

### S-3: 調査候補を投稿レビューに送る

- **given**: Research Board に Peer candidate が表示されている
- **when**: candidate を `Use` にする
- **then**: Review Desk に draft source として source URL / source metadata が表示される
- **検証**: `tests/sns/cockpit/research-to-review.test.js`

### S-4: 投稿案を schedule して Ship Calendar で見る

- **given**: Review Desk に `review_needed` の post が表示されている
- **when**: body を編集し、approve して scheduled datetime を設定する
- **then**: status は `scheduled` になり、Ship Calendar の該当日へ status badge 付きで表示される
- **検証**: `tests/e2e/sns-growth-cockpit.spec.js`

### S-5: 投稿後の学習を次回 AI 指示へ戻す

- **given**: posted URL と metrics snapshot を持つ post がある
- **when**: Learning Loop で hypothesis result と learning note を保存する
- **then**: candidate-store learning candidate が作られ、次回 Direct AI の instruction seed に反映される
- **検証**: `tests/sns/cockpit/learning-loop.test.js`

### S-6: Calendar から Review Desk へ戻る

- **given**: Ship Calendar に scheduled post が表示されている
- **when**: post entry を選択する
- **then**: Review Desk が開き、同じ post の body / source / status が表示される
- **検証**: `tests/e2e/sns-growth-cockpit.spec.js`

## Anti-patterns

- **AP-1**: 初期画面を大きな予約投稿カレンダーにする。
  - **理由**: SNS Growth Cockpit が単なる scheduling tool に見え、Direct AI / Research / Learning が埋もれる。
  - **検証**: UI snapshot / accessibility landmark で Overview が primary であることを確認する。
- **補足**: Ship Calendar route では、大きな週次カレンダーと右 detail panel を表示してよい。禁止対象は初期画面である。
- **AP-1b**: 初期画面に workflow panel、research list、review list、calendar、learning metrics を同じ重みで並べる。
  - **理由**: 佐藤さんが朝に必要なのは「今日の次の1手」であり、機能一覧ではない。
  - **検証**: initial screen の主領域は current review item 1 件と week strip のみにする。
- **AP-2**: Persona Brain / Graph Check / Quality Gate を常時展開して情報密度を上げる。
  - **理由**: review 時の判断材料だが、一覧画面の主情報ではない。
  - **検証**: Review Desk 初期表示で evidence section が collapsed であること。
- **AP-3**: posted metrics を Graph に直接保存する。
  - **理由**: ADR-011 に反し、Graph が operational ledger になる。
  - **検証**: repository test で Graph writer が呼ばれないこと。
- **AP-4**: X API auto-posting を MVP の必須動作にする。
  - **理由**: MVP は AI drafts / human review / brainbase manages を中心にする。
  - **検証**: post execution adapter がなくても status / schedule / posted URL 記録が動くこと。
- **AP-5**: Brainbase global navigation を消して standalone app のようにする。
  - **理由**: Brainbase からすぐアクセスし、すぐ戻れる tool である必要がある。
  - **検証**: E2E で Brainbase sidebar と Back action が残ること。

## UI Transition Map

```text
Brainbase Home
  ├─ 今日 > Ohayo
  ├─ 今日 > 今日の判断
  ├─ 脳 > Personal KG
  ├─ 作る > SNS Growth
  └─ /ohayo Report > SNS Growth

SNS Growth
  └─ Today｜今日の運用判断
      ├─ Direct AI｜AIに指示する
      │   └─ Research Board｜調査結果を見る
      │       └─ Review Desk｜投稿案をレビューする
      │           ├─ Ship Calendar｜出す状態を管理
      │           └─ Learning Loop｜反応から学ぶ
      ├─ Ship Calendar｜出す状態を管理
      │   └─ Review Desk｜投稿を開く
      └─ Learning Loop｜反応から学ぶ
          ├─ Direct AI｜次回のAI指示へ
          └─ candidate-store｜KG promotion候補へ

Any screen
  └─ Back to Brainbase
```

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-0 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| INV-1 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| INV-2 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| INV-3 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| INV-4 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| INV-5 | tests/sns/cockpit/status-badges.test.js | planned |
| INV-6 | tests/sns/cockpit/review-desk.test.js | planned |
| INV-7 | tests/sns/cockpit/learning-loop.test.js | planned |
| INV-8 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| S-1 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| S-2 | tests/sns/cockpit/direct-ai-flow.test.js | planned |
| S-3 | tests/sns/cockpit/research-to-review.test.js | planned |
| S-4 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| S-5 | tests/sns/cockpit/learning-loop.test.js | planned |
| S-6 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| AP-1 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| AP-1b | tests/e2e/sns-growth-cockpit.spec.js | planned |
| AP-2 | tests/sns/cockpit/review-desk.test.js | planned |
| AP-3 | tests/sns/cockpit/learning-loop.test.js | planned |
| AP-4 | tests/sns/cockpit/status-transitions.test.js | planned |
| AP-5 | tests/e2e/sns-growth-cockpit.spec.js | planned |

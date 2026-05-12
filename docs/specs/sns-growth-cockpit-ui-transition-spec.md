---
spec_id: SPEC-sns-growth-cockpit-ui-transition
title: SNS Growth Cockpit UI Transition
status: draft
date: 2026-05-12
story_id: story-sns-posting-cockpit
related_adrs:
  - ADR-011
related_specs:
  - SPEC-sns-persona-brain-gate
  - SPEC-personal-kg-sns-seed-mvp
implementation_files:
  - public/modules/domain/sns/
  - public/modules/views/sns/
  - server/services/sns/
test_files:
  - tests/sns/cockpit/
  - tests/e2e/sns-growth-cockpit.spec.js
---

# SPEC: SNS Growth Cockpit UI Transition

## 目的

SNS Growth Cockpit は予約投稿カレンダーではない。

Brainbase が、今日なにを見て、なにを考え、なにを出し、なにを学ぶかを回すための operations cockpit とする。

カレンダーは必要だが主役ではない。Ship Calendar は「いつ何が出るか」「どの状態か」を見る運用地図として常時アクセス可能にし、Direct AI / Research / Review / Learning の判断を押しのけない。

## Invariants

- **INV-1**: SNS Growth Cockpit は Brainbase 内の tool として表示され、Brainbase 本体へ戻る導線を常に持つ。
  - 検証: E2E で `Back to Brainbase` または equivalent navigation が全主要画面から利用できること。
- **INV-2**: 初期表示の中心は `Overview｜今日の運用判断` であり、calendar grid を初期表示の主役にしない。
  - 検証: UI test で Overview の primary heading と判断カードが表示され、Ship Calendar は補助 entry として表示されること。
- **INV-3**: 主な遷移軸は `Direct AI -> Research Board -> Review Desk -> Ship Calendar -> Learning Loop` である。
  - 検証: E2E で各画面 / tab / route へ順に遷移できること。
- **INV-4**: Ship Calendar は `Review Desk` と `Overview` の両方から到達できる。
  - 検証: E2E で Review 中の投稿を schedule した後、Ship Calendar で同じ投稿が status badge 付きで確認できること。
- **INV-5**: 投稿状態は `review_needed`, `approved`, `scheduled`, `posted`, `skipped`, `learning_ready` のいずれかとして表示される。
  - 検証: Unit / UI test で全 status が badge としてレンダリングされること。
- **INV-6**: Persona Brain / Graph Check / Quality Gate は投稿レビュー時に見えるが、初期表示では詳細を畳む。
  - 検証: UI test で accordion collapsed 初期状態と展開状態を確認する。
- **INV-7**: raw metrics や投稿状態は Graph へ直接書き込まない。Learning Loop は candidate-store への learning candidate 化を入口にする。
  - 検証: API / repository test で Learning action が Graph writer を呼ばないこと。

## Contracts

### Contract-1: Brainbase Entry Contract

- **input**: Brainbase navigation context
  - current workspace / session
  - authenticated actor
  - active tool id `sns-growth`
- **output**: SNS Growth Cockpit shell
  - breadcrumb: `Brainbase / Tools / SNS Growth`
  - back action: Brainbase の直前 context または Home
  - account display: `@AIBizNavigator` など現在の SNS account
- **preconditions**:
  - actor は SNS Growth tool を閲覧できる
- **postconditions**:
  - Brainbase global navigation を失わない
  - SNS Growth 内の tab / route 遷移で Brainbase sidebar が消えない
- **error cases**:
  - account 未接続: account setup empty state を表示し、他画面を壊さない

### Contract-2: Overview Contract

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
- **preconditions**:
  - `/ohayo` 未実行でも empty state が出る
- **postconditions**:
  - calendar は Overview の一部として小さく見えるか、Ship Calendar への entry として見える
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
- **error cases**:
  - invalid status transition: UI で不可操作にするか API が 409 を返す

### Contract-6: Ship Calendar Contract

- **input**:
  - ledger posts in date range
  - status
  - scheduled datetime
  - posted URL
  - learning_ready flag
- **output**:
  - week view または calendar strip
  - status badge
  - daily post count
  - selected post entry to Review Desk
- **preconditions**:
  - date range は必ず明示される
- **postconditions**:
  - scheduled / posted / skipped / learning_ready が一目で分かる
- **error cases**:
  - 0件: empty week と action to Direct AI / Review Desk を出す

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
- **error cases**:
  - metrics unavailable: manual observation note で candidate 化できる

## Scenarios

### S-1: Brainbase から SNS Growth に入る

- **given**: actor が Brainbase Home を開いている
- **when**: `Tools > SNS Growth` を選択する
- **then**: `Overview｜今日の運用判断` が表示され、Brainbase sidebar と `Back to Brainbase` が見える
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
Brainbase Home / Sessions / Graph / Tasks
  ├─ Tools > SNS Growth
  └─ /ohayo Report > SNS Growth

SNS Growth
  └─ Overview｜今日の運用判断
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
| INV-1 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| INV-2 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| INV-3 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| INV-4 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| INV-5 | tests/sns/cockpit/status-badges.test.js | planned |
| INV-6 | tests/sns/cockpit/review-desk.test.js | planned |
| INV-7 | tests/sns/cockpit/learning-loop.test.js | planned |
| S-1 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| S-2 | tests/sns/cockpit/direct-ai-flow.test.js | planned |
| S-3 | tests/sns/cockpit/research-to-review.test.js | planned |
| S-4 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| S-5 | tests/sns/cockpit/learning-loop.test.js | planned |
| S-6 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| AP-1 | tests/e2e/sns-growth-cockpit.spec.js | planned |
| AP-2 | tests/sns/cockpit/review-desk.test.js | planned |
| AP-3 | tests/sns/cockpit/learning-loop.test.js | planned |
| AP-4 | tests/sns/cockpit/status-transitions.test.js | planned |
| AP-5 | tests/e2e/sns-growth-cockpit.spec.js | planned |

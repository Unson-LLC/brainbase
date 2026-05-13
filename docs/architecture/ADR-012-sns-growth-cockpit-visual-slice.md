---
adr_id: ADR-012
title: SNS Growth Cockpit Visual Slice
status: accepted
date: 2026-05-13
related_stories:
  - story-sns-posting-cockpit
related_docs:
  - docs/stories/sns-posting-cockpit-mvp-story.md
  - docs/specs/sns-growth-cockpit-ui-transition-spec.md
  - docs/specs/sns-growth-cockpit-wireframe-v0.md
  - docs/architecture/ADR-011-sns-posting-ledger-boundary.md
supersedes: []
superseded_by: []
---

# ADR-012: SNS Growth Cockpit Visual Slice

## 文脈

SNS Posting Cockpit MVP は、Ledger/API 接続より前に、人間が投稿運用の全体像を一目で見られる UI surface を必要としている。

直近の実装対象は、最終形の `Today` 初期画面ではなく、画像で確認した `Ship Calendar` layout direction である。週カレンダー、右 detail panel、status summary、Brainbase loop navigation を先に固めることで、後続の Ledger/API 接続時に画面密度と遷移の前提を崩さずに済む。

ただし visual treatment は Brainbase 本体と一貫させる。白い standalone admin app ではなく、Brainbase の dark command surface、細い border、控えめな blue accent、Geist / Noto Sans JP typography を使う。

## 決定

この slice では Brainbase Home の workspace panel と `/sns-growth.html` に static fixture ベースの SNS Growth Cockpit visual surface を追加する。

Brainbase の既存 activity bar には `SNS Growth` entry を追加する。ただし、既存の Sessions / Portal / Terminal / File Viewer の分岐は変更しない。Brainbase Home では `window.location.href` で standalone page に飛ばさず、`panel-layout-manager` が `sns-growth-overlay` を開閉する。

投稿 action は local/no-op とし、Graph、SNS Posting Ledger、X API には書き込まない。

## 境界

### 追加するもの

- Brainbase activity bar から in-shell `sns-growth-overlay` を開く導線
- `/sns-growth.html` による standalone review/development surface
- Brainbase loop navigation を持つ dark command UI
- 週次 Ship Calendar
- status summary
- 選択投稿の detail panel
- Persona Brain / Graph Check / Quality Gate / Reader affect の collapsed evidence rows
- fixture data による visual validation

### 追加しないもの

- SNS Posting Ledger schema / repository / API
- Graph write
- X API posting
- status transition persistence
- `Today` 初期画面 route
- multi-account agency cockpit

### Regression-sensitive existing behavior

この slice で触れる `plugin-registration-mixin.js` には既存分岐がある。これらは仕様上、変更対象ではない。

- `abSessionsBtn`: panel layout の全 panel を閉じ、session / terminal surface を primary に戻す。
- `abPortalBtn`, `workspaceModeTerminalBtn`, `workspaceModePortalBtn`, `portalBackTerminalBtn`: 既存の Portal overlay と Terminal surface を切り替える。
- `targetSessionId`: file viewer close flow で closed session または current session の active file/root override を消し、必要な場合だけ対象 session に戻す。

## 影響

- UI の視覚方向を Ledger/API より先に検証できる。
- 既存 Brainbase shell から SNS Growth へ到達できる。
- SNS Growth が別プロダクトの admin UI に見えず、Brainbase 内 tool として認知される。
- SNS Growth から Sessions / Terminal / Portal へ同じ activity bar 操作で戻れる。
- Graph/Ledger 境界は ADR-011 のまま維持される。
- 後続 slice で Ledger/API を接続する時は、この visual surface の fixture を repository/API response に置き換える。

## 検証

- UI test で Brainbase loop navigation、status summary、status badge、detail panel、post selection を確認する。
- regression test で panel layout manager の既存挙動を確認する。
- Browser smoke で `/sns-growth.html` が表示され、投稿カードと detail panel が見えることを確認する。
- eslint / typecheck を通す。

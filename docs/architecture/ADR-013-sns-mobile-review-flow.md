---
adr_id: ADR-013
title: SNS Growth のモバイル導線は Ship Calendar ではなく Today Review Inbox を主画面にする
status: accepted
date: 2026-05-13
related_story: story-sns-mobile-review-flow
related_specs:
  - SPEC-sns-mobile-review-flow
  - SPEC-sns-growth-cockpit-ui-transition
supersedes: []
---

# ADR-013: SNS Growth のモバイル導線は Ship Calendar ではなく Today Review Inbox を主画面にする

## Context

SNS Growth Cockpit の desktop 画面は、週カレンダー、投稿詳細、ステータス集計、証跡を同時に見る operations cockpit として成立する。

しかし mobile では、同じ情報密度を縮小表示すると「何を判断すればよいか」が見えにくい。スマホで brainbase を開く場面は、移動中・会議前後・短い空き時間に、今日止まっているSNS判断を片付ける場面が中心になる。

そのため mobile では Ship Calendar を主画面にせず、今日の投稿判断キューを主画面にする。

## Decision

SNS Growth の mobile entry は、同じ `sns-growth-overlay` を開く。ただし mobile viewport では表示の主役を `今日のSNS判断` inbox にする。

Mobile SNS Growth は以下の構造にする。

- mobile bottom navigation に `SNS` entry を置く
- tap で Brainbase 内の `sns-growth-overlay` を開き、URLは変えない
- 初期表示は `今日のSNS判断` inbox
- 投稿カードには time / status / source type / rationale / Persona / Graph の最低限を表示する
- 投稿カード tap で同じ selected post detail を表示する
- Brainbase terminal chrome / mobile tab bar / input dock / outer right drawer は SNS mode 中に隠す
- SNS内の投稿詳細 panel は隠さない
- desktop の Ship Calendar + right detail panel は維持する

## Consequences

### Positive

- mobile の初回表示で「今日なにを判断するか」が分かる
- 週カレンダーの横スクロールを最初に強要しない
- desktop と同じ selected post / detail model を使える
- Brainbase から外部ページへ遷移せず、session context を維持できる

### Trade-offs

- mobile と desktop で初期視点が異なる
- mobile 専用CSSとmobile-only markupが増える
- 将来、投稿詳細を bottom sheet / route として分離する余地が残る

## Non-goals

- SNS Posting Ledger の永続化はこのADRの対象外
- X API投稿・予約投稿の本番実行はこのADRの対象外
- mobile で週次キャンペーン編集を完結させることは目標にしない

## Verification

- Unit: `tests/ui/views/sns-growth-cockpit-view.test.js`
- Unit: `tests/ui/panel-layout-manager.test.js`
- Browser smoke: 390px viewport で mobile `SNS` entry から overlay を開き、inbox first / calendar hidden / detail visible / URL unchanged を確認する

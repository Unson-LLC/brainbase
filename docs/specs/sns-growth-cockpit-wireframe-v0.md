---
spec_id: SPEC-sns-growth-cockpit-wireframe-v0
title: SNS Growth Cockpit Wireframe v0
status: draft
date: 2026-05-12
story_id: story-sns-posting-cockpit
related_specs:
  - SPEC-sns-growth-cockpit-ui-transition
related_adrs:
  - ADR-011
---

# SPEC: SNS Growth Cockpit Wireframe v0

## 目的

SNS Growth Cockpit は、多機能な投稿管理画面ではなく、佐藤圭吾が毎朝「今日は誰の脳に入り、何を見て、何を出すか」を迷わず決めるための Brainbase tool とする。

前回の UI image は、Research / Review / Calendar / Learning を同時に見せすぎていた。v0 wireframe では、初期画面の情報量を落とし、1 つの判断に集中できる形にする。

一方で、2026-05-13 に生成した light admin UI の週次カレンダー画面は、`Ship Calendar` の visual direction として採用する。入口の `Today` ではなく、運用状態を管理する dedicated route として扱う。

## 佐藤さんの脳での判断順

1. 今日、SNS をやる意味は何か。
2. 誰の脳に入るべきか。
3. どの投稿・ニュース・KG memory を材料にするか。
4. その人が読んだとき、気持ちがプラスになるか。
5. 投稿するか、直すか、保留するか。
6. 週全体で偏っていないか。
7. 反応から何を学習候補にするか。

UI はこの順番を崩さない。

## Design Principle

- **One decision per screen**: 1 画面で同時に判断させる対象は 1 つにする。
- **Calendar is a map, not the workbench**: カレンダーは週の見取り図であり、初期画面の主役にしない。
- **Full calendar is a route**: 週次カレンダーを大きく表示するのは `Ship Calendar` route に限定する。
- **Evidence is pull, not push**: Persona Brain / Graph Check / Quality Gate は必要なときに開く。常時展開しない。
- **Research is a drawer**: 調査候補一覧は補助面。初期画面に大量表示しない。
- **Brainbase shell remains visible**: Brainbase の左 navigation と context bar を維持し、別アプリ感を出さない。
- **Brainbase loop navigation**: 左 navigation は `今日 / 脳 / 作る / 動かす / 学ぶ / システム` の順で、Brainbase の循環を表す。

## Jobs To Be Done

### JTBD-1: 朝、今日の運用判断を始める

- **状況**: Brainbase を開き、今日の SNS 運用を確認する。
- **欲しいこと**: 今日レビューすべき 1 件と、その背景だけを見たい。
- **避けたいこと**: カレンダー、調査一覧、metrics が同時に出てきて、何から見ればよいか分からなくなる。

### JTBD-2: 投稿案を 1 件だけレビューする

- **状況**: `/ohayo` が投稿案を出している。
- **欲しいこと**: 読者の気持ち、佐藤さんの思想、引用元の妥当性を短時間で確認したい。
- **避けたいこと**: 「AI が作りました」「少し上の人と絡みます」のような内輪の作戦が本文や主 UI に出る。

### JTBD-3: Peer Quote の材料を確認する

- **状況**: 自分と近い界隈で、少し人気のある人の投稿を引用したい。
- **欲しいこと**: なぜこの人・この投稿なのか、引用したとき相手が仲間だと思いやすいかを確認したい。
- **避けたいこと**: follower 数やバズ度だけで機械的に候補が並ぶ。

### JTBD-4: 週の偏りを見る

- **状況**: 1 週間分の投稿配分を見たい。
- **欲しいこと**: テーマと状態の偏りが分かれば十分。
- **避けたいこと**: Google Calendar のような細かい時間割が主役になる。

### JTBD-5: 夜、反応を学びに戻す

- **状況**: 投稿後に反応を見て、次回に活かしたい。
- **欲しいこと**: 何が仮説通りで、何を candidate-store に送るかを決めたい。
- **避けたいこと**: raw metrics dashboard になり、Graph に何でも入れてしまう。

## Information Architecture

```text
SNS Growth Cockpit
  ├─ Today
  │   ├─ 今日の作戦
  │   ├─ 今レビューする1件
  │   └─ 週の見取り図
  ├─ Review Focus
  │   ├─ 本文
  │   ├─ 読者の気持ち
  │   ├─ 引用元 / KG source
  │   └─ action: 投稿する / 直す / 保留 / 予約
  ├─ Research Drawer
  │   ├─ Peer Circle
  │   ├─ Overseas / News
  │   ├─ Bookmarks
  │   └─ Personal KG
  ├─ Ship Calendar
  │   ├─ full week grid
  │   ├─ right post detail panel
  │   └─ theme balance warning
  └─ Learning
      ├─ reaction note
      ├─ hypothesis result
      └─ candidate-store handoff
```

## Wireframe W0: Brainbase Shell

Brainbase の shell は固定する。SNS Growth は main workspace の中に入る。

```text
┌────┬────────────────────────┬──────────────────────────────────────────────┐
│icon│ Brainbase              │ Brainbase / SNS Growth             @ksato X │
│bar │                        ├──────────────────────────────────────────────┤
│    │ 今日                   │                                              │
│    │ - Ohayo                │              SNS Growth Cockpit              │
│    │ - 今日の判断           │                                              │
│    │ - Inbox                │                                              │
│    │ 脳                     │                                              │
│    │ - Knowledge Graph      │                                              │
│    │ - Personal KG          │                                              │
│    │ 作る                   │                                              │
│    │ - SNS Growth ●         │                                              │
│    │ - Research Board       │                                              │
│    │ 動かす / 学ぶ          │                                              │
└────┴────────────────────────┴──────────────────────────────────────────────┘
```

## Wireframe W1: Today Overview

初期画面。ここでは一覧を増やさず、「今日の作戦」と「今見る 1 件」に集中する。

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Today｜今日の運用判断                                      [更新] [設定]   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 今日の作戦                                                                  │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 誰の脳に入るか: Claude Codeを業務導入したいPM / 経営者                 │ │
│ │ 今日の狙い: 「AIに任せる」ではなく「AIが文脈を持って動く」を伝える      │ │
│ │ 避ける: API投稿っぽさ / 宣言臭さ / ルー大柴化                           │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ 今レビューする1件                                                           │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 要レビュー  Peer Quote                                                   │ │
│ │                                                                         │ │
│ │ いいPMほど、AIに「作業」を渡す前に「判断の前提」を渡している。           │ │
│ │ Claude Codeも同じで、コードを書く前に何を正とするかを持たせないと、      │ │
│ │ 速く間違えるだけになる。                                                 │ │
│ │                                                                         │ │
│ │ 引用元: tetumemo / Claude Code運用の投稿              [引用元を見る]    │ │
│ │ 読者の気持ち: 具体的で学びになる / 上から目線ではない        [詳細]      │ │
│ │                                                                         │ │
│ │ [投稿する]  [直す]  [保留]  [予約する]                                   │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ 週の見取り図                                                                 │
│ Mon  Tue  Wed  Thu  Fri  Sat  Sun                                            │
│  ●    ○    ●    -    ○    -    -        review 2 / scheduled 3 / posted 1    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### W1 の削るもの

- Research candidate の大量リスト
- Metrics chart
- 大きい月間カレンダー
- Persona Brain / Graph Check / Quality Gate の常時展開
- AI の内部作戦を説明するテキスト

## Wireframe W2: Review Focus

投稿本文を直すときだけ focus view に入る。ここでも主役は本文と読者の気持ち。

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Review｜投稿案を整える                         [Todayへ戻る] [履歴]       │
├───────────────────────────────────────┬─────────────────────────────────────┤
│ 本文                                  │ 判断メモ                            │
│ ┌───────────────────────────────────┐ │ ┌─────────────────────────────────┐ │
│ │ いいPMほど、AIに「作業」を渡す前に │ │ │ 読者の気持ち                    │ │
│ │ 「判断の前提」を渡している。       │ │ │ + 自分の現場に置き換えやすい     │ │
│ │ Claude Codeも同じで...             │ │ │ + 佐藤さんの経験が見える         │ │
│ │                                   │ │ │ - 少し抽象的なら具体例を足す     │ │
│ └───────────────────────────────────┘ │ └─────────────────────────────────┘ │
│ 文字数 132 / 280                      │                                     │
│                                       │ ┌─────────────────────────────────┐ │
│ [保存] [投稿する] [予約する]          │ │ 引用元 / KG source               │ │
│                                       │ │ tetumemo post                    │ │
│                                       │ │ Personal KG: AI PM / 経営OS      │ │
│                                       │ └─────────────────────────────────┘ │
│                                       │ [Persona Brain] [Graph] [Gate]      │
└───────────────────────────────────────┴─────────────────────────────────────┘
```

## Wireframe W3: Research Drawer

Research は drawer で開く。Today の主画面を壊さず、材料を選んだら Review に戻る。

```text
┌────────────────────────────────────────────┬───────────────────────────────┐
│ Today Overview                              │ Research Drawer               │
│                                            │ ┌───────────────────────────┐ │
│ 今レビューする1件                           │ │ Peer Circle               │ │
│                                            │ │ @near_peer  引用向き       │ │
│                                            │ │ 理由: 同じ界隈/少し上      │ │
│                                            │ │ [使う] [保留] [開く]       │ │
│                                            │ └───────────────────────────┘ │
│                                            │ ┌───────────────────────────┐ │
│                                            │ │ Personal KG                │ │
│                                            │ │ AI PM / Claude Code運用    │ │
│                                            │ │ [使う] [保留]              │ │
│                                            │ └───────────────────────────┘ │
└────────────────────────────────────────────┴───────────────────────────────┘
```

## Wireframe W4: Ship Calendar

Ship Calendar は「いつ何が出るか」と「どの状態か」を管理する dedicated route。ここでは大きな週次カレンダーと右 detail panel を主役にしてよい。

ただし、これは初期画面ではない。`Today` から `Ship Calendar` に入った後の画面である。

```text
┌───────────────────────────────┬─────────────────────────────────────────────┐
│ SNS Growth Cockpit             │ ポストの詳細                                │
│ [Calendar] Research Review     │ X @brainbase_inc                            │
│ Learning                       │ status: review_needed                       │
│                                │ post id: bb_x_20250522_0900                 │
│ Review Needed 3  Scheduled 8   │                                             │
│ Posted 12       Learning 2     │ ポスト本文                                  │
│                                │ ┌─────────────────────────────────────────┐ │
│ 今週はX運用の話に寄りすぎ。    │ │ チームの生産性を最大化するために...      │ │
│ Personal KG由来を1件追加候補。 │ └─────────────────────────────────────────┘ │
│                                │ Source URL                                  │
│ ┌────┬────┬────┬────┬────┐     │ Schedule: 2025/05/22 09:00 JST             │
│ │Mon │Tue │Wed │Thu │Fri │     │                                             │
│ │9:00 posted ...        │     │ [承認する] [スケジュール] [投稿済みにする] │
│ │12:00 scheduled ...    │     │ [スキップする]                             │
│ │15:00 review ...       │     │                                             │
│ │18:00 scheduled ...    │     │ Persona Brain  一致                        │
│ │21:00 learning ...     │     │ Graph Check    異常なし                    │
│ └────┴────┴────┴────┴────┘     │ Quality Gate   合格                        │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

### W4 の採用要素

- Brainbase の light admin UI として成立する密度。
- 左 navigation は Brainbase loop を維持する。
- status summary cards は Calendar route では表示してよい。
- full weekly calendar grid は Calendar route では表示してよい。
- 右 detail panel は selected post の編集・承認・schedule を担う。
- Persona Brain / Graph Check / Quality Gate / Reader affect は collapsed rows にする。
- topic balance warning は Calendar route に表示してよい。

## Wireframe W5: Learning

夜の画面は metrics dashboard ではない。次の Direct AI に戻す学習候補を決める。

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Learning｜今日の反応を次へ戻す                            [candidate化]    │
├─────────────────────────────────────────────────────────────────────────────┤
│ 投稿: Claude Codeは「作業」より先に「判断の前提」を渡す                     │
│ 反応: 保存が多い / 引用は少ない / PM層からの反応あり                        │
│ 仮説: PMは「AIに任せる」より「AIに前提を渡す」に反応する                     │
│ 次回の指示: 実務のワークフロー例を1つ入れる                                  │
│                                                                             │
│ [Direct AIへ反映]  [candidate-storeへ送る]  [保留]                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Rules

- Overview の中心は `currentReviewItem` 1 件だけ。
- 複数件は `next queue` として小さく数だけ見せる。
- Detail evidence は accordion / drawer に閉じる。
- Today では `week strip` を標準表示、full calendar は `Ship Calendar` route。
- Research Board は right drawer または separate tab。初期画面に常時表示しない。
- Status は文字より短い chip で表す。
- CTA は最大 4 つ: `投稿する`, `直す`, `保留`, `予約する`。
- 画面内説明文は最小にし、操作名で意味が分かるようにする。

## Acceptance Criteria

- [ ] 初期表示で、投稿候補の詳細表示は 1 件だけである。
- [ ] 初期表示で、週カレンダーは strip または compact map として表示され、画面の主役にならない。
- [ ] Ship Calendar route では、週次 calendar grid と右 detail panel が主役になる。
- [ ] 左 navigation は `今日 / 脳 / 作る / 動かす / 学ぶ / システム` の group を持つ。
- [ ] Persona Brain / Graph Check / Quality Gate は初期状態で畳まれている。
- [ ] Research candidates は drawer / tab から開き、Today Overview を情報過多にしない。
- [ ] 投稿本文・引用元・読者の気持ち・主要 action が 1 画面で見える。
- [ ] `Xの話に寄りすぎ` のようなテーマ偏りは Week Map の warning として出せる。
- [ ] Learning は raw metrics ではなく、次回 Direct AI と candidate-store への handoff を主役にする。

## Anti-patterns

- 大きな月間カレンダーを初期画面に置く。
- Ship Calendar route の full weekly calendar を、Today 初期画面と混同する。
- 5 つの workflow panel を同じ強さで並べる。
- Research candidate を初期画面に 10 件以上並べる。
- Persona Brain / Graph Check / Quality Gate を常時展開する。
- AI の内部作戦を本文やメイン画面に露出する。
- Metrics を主役にして、学習仮説を脇に置く。

---
story_id: str.brainbase.sns-mobile-pwa-terminal-guard
title: SNS mobile PWA safe back and terminal guard
status: proposed
date: 2026-05-24
reason: "既存ADR-013とSNS mobile review terminal guard architecture内の補正であり、新しい画面構造・永続化境界・terminal transport方式を決めないため新規ADRは不要。"
related_specs:
  - SPEC-sns-mobile-pwa-terminal-guard
related_evidence:
  - docs/stories/sns-mobile-pwa-terminal-guard-evidence.md
---

# Story: SNSモバイルPWAの戻る導線とターミナル誤表示を防ぐ

## User Story

BrainbaseをiPhone PWAで開いてSNS投稿をレビューするさとけいとして、
SNS画面からBrainbaseに戻るボタンを確実に押せて、投稿カードをタップした時にTerminalが開かないでほしい。
そうすれば、移動中でもSNS投稿の確認・承認・編集をBrainbase内で完結できる。

## Problem

SNS Growth overlayはBrainbaseの`console-area`内に表示される。mobile snapshot modeでは`console-area`のtap/touchがlive terminalを開く導線でもあるため、SNS overlay上の投稿レビュー操作がterminal操作として扱われる余地がある。

またPWA表示ではiOSの時刻・ステータスバー領域が通常ブラウザより画面上部を占有する。SNS overlay headerが`safe-area-inset-top`を考慮していないため、戻るボタンがステータス領域に重なり、タップできない。

## Architecture Decision

ADR-unnecessary decision: approved.

この変更は既存ADR-013のmobile SNS overlay方針と、既存のSNS mobile review terminal guard architectureに沿った修正である。新しい画面構造、永続化境界、terminal transport方式は導入しない。変更範囲は、既存SNS overlay headerのsafe-area対応と、既存terminal touch guardの可視判定補強に限定する。

## Scenarios

### S-1: PWAでSNS画面から戻る

- given: iPhone PWA相当のmobile viewportでSNS overlayを開いている。
- when: ユーザーが上部のBack to Brainbaseをタップする。
- then: 戻るボタンはステータスバー領域と重ならず、BrainbaseのTerminal modeへ戻る。

### S-2: SNS投稿カードを確認する

- given: mobile SNS overlayが開いている。
- when: ユーザーが投稿カードをtapする。
- then: SNS詳細ペインが表示され、mobile live terminal modalは開かない。

### S-3: Terminal面を直接tapする

- given: SNS overlayが閉じており、terminal snapshot surfaceが表示されている。
- when: ユーザーがterminal surfaceをtapする。
- then: 既存通りmobile live terminalを開ける。

### S-4: Current sessionのUI state更新は維持する

- given: Brainbaseでcurrent sessionが選択されている。
- when: SNS overlayを開閉し、mobile terminal reveal guardが可視判定で抑止される。
- then: `state.currentSessionId`に基づくsession UI summary refreshやsession switch後のdeferred workは既存通り維持される。

## Acceptance Criteria

- AC-1: PWA/mobile viewportでSNS overlayを開いた時、戻るボタンは`safe-area-inset-top`の下に配置され、44px以上のタップ領域を持つ。
- AC-2: SNS overlay表示中、投稿カード・詳細領域のtap/clickはTerminal live viewを開かない。
- AC-3: Terminal live viewを開くtouch/click guardは、`#terminal-stage`が非表示の時は発火しない。
- AC-4: SNS投稿カードをタップすると、SNS詳細ペインが表示され、SNS overlayは開いたまま残る。
- AC-5: 既存の実terminal surfaceをタップした時のmobile live terminal導線は維持する。
- AC-6: `state.currentSessionId`を使うsession UI state更新・summary refresh・session switch guardの挙動は変更しない。

## Non-goals

- SNS Growthのdesktop layoutは変更しない。
- Terminal runtimeの接続・再接続・session switch guardは変更しない。
- SNS posting ledgerや投稿本文生成の挙動は変更しない。

## Evidence

- Gate/PRレビュー用の証跡マップは`docs/stories/sns-mobile-pwa-terminal-guard-evidence.md`を正本とする。

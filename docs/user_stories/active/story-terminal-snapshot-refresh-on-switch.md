---
story_id: story-terminal-snapshot-refresh-on-switch
title: Refresh terminal snapshot after session switch
source_requirement:
  type: user_report
  description: The temporary terminal snapshot shown during session switches should keep switch latency low while replacing stale cached content with a fresh tmux capture.
architecture_docs:
  - path: docs/brainbase-capabilities/capabilities/terminal.transport.yml
    status: referenced
    reason: Terminal snapshot refresh is a client-side cache/presentation policy inside the existing terminal transport capability; no runtime API or architecture boundary changes.
related_tasks:
  - task_source: VibePro
    task_ids: [story-terminal-snapshot-refresh-on-switch]
status: active
created_at: 2026-05-19
updated_at: 2026-05-19
---

# story-terminal-snapshot-refresh-on-switch: Refresh terminal snapshot after session switch

## 背景

Brainbase はセッション切替時の体感待ち時間を減らすため、xterm が準備できるまでターミナル snapshot を一時表示する。

現状はブラウザ内の `_terminalSnapshotCache` にTTLがなく、過去に取得した snapshot が残っていると、次回切替時にその古い内容だけを表示し続けることがある。

## 変更内容

### 誰が

- Brainbaseで複数セッションを切り替えながらターミナル出力を確認するユーザー

### 何を

- セッション切替時は既存のcached snapshotを即表示して体感速度を維持する。
- cached snapshotを表示した場合でも、裏で必ずfresh snapshotを取得し、切替対象がまだ現在のセッションなら表示を差し替える。
- cold cacheでも同じfresh snapshot取得経路を使う。
- `force: true` の snapshot取得は既存in-flight requestを再利用せず、新しいcapture requestとして扱う。

### なぜ

- セッション切替直後に真っ黒な画面を避けつつ、古いsnapshotがいつまでも残る状態を避けるため。
- snapshotは「現在のターミナル状態へ到達するまでの橋渡し」であり、古い状態を正として固定表示するものではないため。

## 方針

- 既存のarchived session除外は維持し、`session.intendedState === 'archived'` の場合はsnapshot refreshやactive化を行わない。
- 遅れて返ったsnapshot responseは、`state.currentSessionId` / `appStore.getState().currentSessionId` が対象sessionと一致する場合だけ表示へ反映する。
- この変更は `docs/brainbase-capabilities/capabilities/terminal.transport.yml` の既存terminal transport能力内の表示補助であり、tmux capture API、xterm接続契約、session lifecycleの境界は変更しない。

## 受け入れ基準

- [ ] desktop xterm切替ではcached snapshotを即表示した後、`_loadTerminalSnapshot(sessionId, { force: true, mode: 'fast' })` を呼ぶ。
- [ ] desktop xterm切替のcold cacheでも `force: true, mode: 'fast'` でsnapshot取得を開始する。
- [ ] mobile snapshot切替ではcached snapshotを即表示した後、fresh snapshotで表示を差し替える。
- [ ] `force: true` のsnapshot取得は既存in-flight snapshot requestを再利用しない。

## スコープ外

- tmux capture APIの形式変更。
- xterm transport接続完了条件の変更。
- terminal scrollback保存仕様の変更。

## 検証

```bash
npm run test:run -- tests/ui/integration/app-switch-session-runtime.test.js
npm run typecheck
PLAYWRIGHT_HTML_OPEN=never npx playwright test tests/e2e/story-terminal-snapshot-refresh-on-switch-session-switch.spec.ts --project=chromium
```

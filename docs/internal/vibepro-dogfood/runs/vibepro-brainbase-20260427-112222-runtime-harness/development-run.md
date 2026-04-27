# VibePro Autonomous Development Run: Runtime Integration Harness

## Request

Brainbase 上で VibePro の自走開発ループを継続する。前回 run で残った `app-switch-session-runtime.test.js` の integration 失敗を閉じる。

## Loop

```text
前回 run の residual risk
-> production app.start 経路に沿った原因分類
-> settings / fetch / httpClient mock の API surface 修正
-> runtime integration 単体検証
-> active indicator 関連スイートとの同時検証
-> jj change closure
-> run 証跡化
```

## Implementation

- jj change: `ympstzwzsmplznwmknpnmrznxmkpktzv`
- commit: `f30bd9d72896a537210fecb62177dd2b82922af0`
- description: `test(runtime): stabilize app switch integration harness`

Changed files:

- `tests/setup/test-setup.js`
- `tests/ui/integration/app-switch-session-runtime.test.js`

## Behavior Fixed

- `SettingsExtensions` mock が `setupSettingsExtensions()` を持つようにした。
- `/api/config` mock を `projects.root` / `projects.projects` / `plugins` を持つ production shape に寄せた。
- JSDOM / Node test environment の global `fetch` に、startup が読む相対 URL endpoint を追加した。
- `httpClient.get` を endpoint 別 mock にし、startup data と runtime lookup の型を分離した。
- `sessionDataCache.clear()` を `beforeEach` に入れ、test 間の startup data 汚染を防いだ。
- desktop xterm 切替待機中は xterm host を fit 計算のため維持し、snapshot panel を重ねる assertion に更新した。

## Verification

Passed:

- `node --check tests/ui/integration/app-switch-session-runtime.test.js && node --check tests/setup/test-setup.js`
- `npm -s exec vitest run tests/ui/integration/app-switch-session-runtime.test.js` -> 34 passed
- `npm -s exec vitest run tests/server/session-manager.test.js tests/unit/session-indicators.test.js tests/unit/session-indicators-ws.test.js tests/unit/session-activity-ws-service.test.js tests/unit/session-ui-state.test.js tests/ui/views/session-view.test.js tests/ui/integration/app-switch-session-runtime.test.js` -> 115 passed
- `npx eslint tests/setup/test-setup.js tests/ui/integration/app-switch-session-runtime.test.js`
- `npm run typecheck`

## Judgment

自立開発ループとしては `go_for_next_dogfood`。

前回 run で機械的に残った risk を、AI が次の実装対象へ変換し、修正・検証・jj change・run 証跡まで閉じた。これは VibePro が単なる診断ログではなく、自立開発の進行制御として使える兆候。

次は実ブラウザ / Playwright で active indicator の cold start と session switch を確認し、その結果を Story-to-Ship closure に接続する。

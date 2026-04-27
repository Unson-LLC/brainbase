# VibePro Autonomous Development Run: Active Indicator Stability

## Request

Brainbase で VibePro を試す。実用上不安定なアクティブインジケータを安定化する。

## Loop

```text
要求
-> 既存 skill / 実装調査
-> 不安定条件の特定
-> server / client の活動状態遷移を修正
-> targeted tests / lint / typecheck
-> jj change closure
-> run 証跡化
```

## Implementation

- jj change: `uswxullonwzykkumnvmqlylxrpuwznpr`
- commit: `bf67aa69549d08d195485550ef2f06606801d817`
- description: `fix(activity): stabilize active indicator transitions`

Changed files:

- `public/modules/session-indicators.js`
- `server/services/session-core/activity-service-methods.js`
- `tests/unit/session-indicators-ws.test.js`

## Behavior Fixed

- `markDoneAsRead` 後の抑制中でも、新しい `working` / `waiting` status は即反映する。
- 非Claude形式の既知 `turnId` は、その turn だけを閉じる。
- `turnId` なし `turn_completed` は active turn が1つなら閉じ、複数なら premature done を避けて保持する。
- legacy `working` 報告では古い `lastDoneAt` をリセットし、done 表示の残留を防ぐ。

## Verification

Passed:

- `node --check public/modules/session-indicators.js && node --check server/services/session-core/activity-service-methods.js && node --check tests/unit/session-indicators-ws.test.js`
- `npm -s exec vitest run tests/server/session-manager.test.js tests/unit/session-indicators.test.js tests/unit/session-indicators-ws.test.js tests/unit/session-activity-ws-service.test.js`
- `npx eslint public/modules/session-indicators.js server/services/session-core/activity-service-methods.js tests/unit/session-indicators-ws.test.js`
- `npm run typecheck`

Residual risk:

- `tests/ui/integration/app-switch-session-runtime.test.js` は `settingsExtensions` mock と相対 URL fetch の既存問題で失敗した。今回の activity indicator 修正とは別 fact として扱う。
- 実ブラウザでの indicator 遷移確認は未実施。

## Judgment

自立開発ループとしては `partial_go`。

要求から修正、targeted verification、jj change closure までは成立した。一方で、事前 story/spec 生成と実 UI 動的確認はまだ VibePro run の標準工程に入っていない。

次の改善は、`development-run.json` を scorer の正式入力にし、要求解釈率・実装完遂率・自己修正率・Ship閉鎖率・人間介入率を機械採点すること。

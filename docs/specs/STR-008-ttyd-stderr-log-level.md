# Spec: STR-008 ttyd stderr ログレベル分類

Story: STR-008 / 受け入れ基準を検証可能な仕様句に落とす。

## 対象

`server/services/session-runtime/ttyd-log-level.js` の純粋関数
`classifyTtydStderrLevel(data) -> 'info' | 'warn' | 'error'` と、
`server/services/session-runtime/runtime-lifecycle-methods.js` の ttyd stderr ハンドラ配線。

## 契約 (Spec Clauses)

- SPEC-1 (ac:1): ttyd の `N:`(notice) / `D:`(debug) 行を渡すと、戻り値は `info`（error ではない）。
- SPEC-2 (ac:2): ttyd の `W:`(warning) 行を渡すと、戻り値は `warn`。
- SPEC-3 (ac:3): ttyd の `E:`(error) 行を渡すと、戻り値は `error`。
- SPEC-4 (ac:4): notice と `E:` が混在する複数行チャンクは、最高シビリティの `error` を返す（本物の error が降格されない）。
- SPEC-5 (ac:5): stderr ハンドラは戻り値レベルで `logger[level]` を呼び、ttyd のログ自体は出力され続ける（レベルだけが変わる）。
- SPEC-6 (ac:6): 本 Story は VibePro dogfood として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる。

## 入力分類規則

| 入力 | 期待レベル |
|---|---|
| `[ts] N: ...` / `[ts] D: ...` | info |
| `[ts] W: ...` | warn |
| `[ts] E: ...` | error |
| 複数行（最高シビリティ採用） | max(N/D=info, W=warn, E=error) |
| トークン無しの想定外 stderr | warn |
| 空 / null / undefined | info |

## 非目標

- ttyd stdout 側のレベル変更なし。
- libwebsockets のトークン語彙（N/W/E/D）以外への対応は行わない。

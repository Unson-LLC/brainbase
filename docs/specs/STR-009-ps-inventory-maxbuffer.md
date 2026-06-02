# Spec: STR-009 ps inventory maxBuffer

Story: STR-009 / 受け入れ基準を検証可能な仕様句に落とす。

## 対象

- `server/services/session-runtime/ps-inventory-config.js` の共有定数 `PS_INVENTORY_MAX_BUFFER`
- `server/services/session-runtime/runtime-query-methods.js` の `getRuntimeInventory`（execPromise / execSync 両経路の ps 呼び出し）
- `server/services/terminal-runtime-reconciler.js` の `_listProcesses`（execSync の ps 呼び出し）

## 契約 (Spec Clauses)

- SPEC-1 (ac:1): `getRuntimeInventory` の `ps -axo` 呼び出しオプションに `maxBuffer >= 16MB`（実装値 64MB）が渡される。
- SPEC-2 (ac:2): `_listProcesses` の `ps -axo` 呼び出しオプションに同じ `maxBuffer` が渡される。
- SPEC-3 (ac:3): maxBuffer 付与後も `_listProcesses` は ps stdout を行単位でパースし、各行を pid/ppid/pgid/command のプロセスオブジェクト配列にして返す（既存挙動維持）。
- SPEC-4 (ac:4): 本 Story は VibePro dogfood として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる。

## 不変条件

- `PS_INVENTORY_MAX_BUFFER` は 1MB（Node デフォルト）より十分大きい単一の共有定数で、両モジュールが同じ値を使う。
- ps 呼び出し失敗時の既存 catch 挙動（空配列/空文字フォールバック）は本変更では変えない。

## 非目標

- ps 出力カラムの最適化、reconciler の blind-observation recovery 抑止、watchdog の 36 issues 慢性化は対象外。

# develop CI 再検証 2026-11-11

セッション `codex-work326` は origin/develop `21c9e1f3210b75127662b870b3f5428e20cb9020` から検証した。
依頼時の zod audit と local-web-shell 3件の失敗は、この base では再現しなかった。
この記録はローカル検証結果であり、PR #842 の CI 成功を示すものではない。

## 既存修正

- zod 3→4 は [85798bd](https://github.com/Unson-LLC/brainbase/commit/85798bd8db756d0ff319c37d2b00bda3804e02e8) で対応済み。package.json、package-lock.json、src/server.ts を変更し、z.record をキーと値の2引数にした。最新 base では zod@4.6.7 が SDK と共有され、src/ssot.ts を含む build が通る。
- UI は [2c1685c](https://github.com/Unson-LLC/brainbase/commit/2c1685ca66a45cfe32ce61303be8c601e2091d73) で対応済み。9月の固定 fixture が既定の過去30日から外れ、行と詳細がなくなっていた。対象3件の Date を 2026-09-26 に固定し、afterEach で実時計へ戻す。期待文字列や行選択のアサーションは維持している。

原因確認として、作業コピーで時計だけを 2026-11-11 に進めると、指定の3件が同じ文字列不足・行不在で失敗した。直後にファイルを元のバイト列へ戻した。期間フィルターは仕様どおりであり、本体の変更は不要だった。

## 検証結果

Node 24.22.1、npm 11.21.1。テストは各コマンド maxWorkers=1。全体スイートは実行していない。

| コマンド | 結果 |
| --- | --- |
| npm ci --ignore-scripts | 成功 |
| npm run build | 成功 |
| npm ls zod --omit=dev | zod@4.6.7、SDK 配下も deduped |
| npx vitest run tests/ui/local-web-shell.test.mjs --maxWorkers=1 | 24件成功 |
| npx vitest run tests/ui/judgment-history.test.mjs --maxWorkers=1 | 56件成功 |
| npx vitest run tests/ssot.test.ts tests/ssot-atomic.test.ts tests/mcp-contract.test.ts tests/public-contract-fixture.test.ts tests/server-support.test.ts tests/server-support-errors.test.ts --maxWorkers=1 | 91件成功 |
| npm audit --omit=dev --json | exit 0、脆弱性0件 |

SSOT atomic テストの注入された cleanup failure 警告は期待する失敗経路で、テストは成功した。
依存・本体・テストには追加変更を加えていない。runner 終了処理の ci-cleanup.sh ENOENT は別の基盤問題で、この検証の対象外。

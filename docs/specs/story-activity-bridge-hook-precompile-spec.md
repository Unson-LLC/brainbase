---
spec_id: spec-activity-bridge-hook-precompile
story_id: story-activity-bridge-hook-precompile
status: accepted
---

# Spec: activity-bridge フック事前バンドル + CSRF ディスクキャッシュ

## Invariants

- `run-hook.sh` は `<hook>.ts` 要求に対し `<hook>.mjs` が存在し `node` が PATH にあれば
  `node <hook>.mjs` を exec する。無ければ従来の tsx 解決(tool_root の node_modules/.bin/tsx
  → PATH の tsx)に fallback する。
- `build-activity-bridge-hooks.mjs` は 3 entrypoint を固定 esbuild config(bundle, platform=node,
  format=esm, target=node22, packages=bundle, legalComments=none, sourcemap=false, minify=false)
  でバンドルする。build と test は同一 config を共有し決定的出力にする。
- committed `.mjs` は現行 .ts ソースを上記 config で再ビルドした結果と byte 一致する。
- CSRF token は `csrf-cache.json` に `{ [port]: { token, fetchedAt } }` で保存され、
  `now - fetchedAt < CSRF_TTL(50分)` の間はサーバへ再取得しない。
- `postActivity` は report_activity の応答が 403 のとき `invalidateCsrfToken(port)` →
  `getCsrfToken(port, sid, forceRefresh=true)` → 1 回だけ再 POST する。
- ディスクキャッシュ読み書き失敗は best-effort(throw せずメモリのみで継続)。

## Scenarios

### S1. バンドル優先実行 flow

1. run-hook.sh が `.../post-tool-use/activity-bridge.ts` を要求される
2. 同階層に `.mjs` が存在し node が使える
3. `exec node .../activity-bridge.mjs` の process に transition(tsx コンパイルを経由しない)
4. 実測 65-150ms で完了し 3 秒 timeout 内に収まる

### S2. fallback flow (.mjs 不在 / 旧 worktree)

1. `.mjs` が存在しない、または node 不在
2. 従来の tsx 解決経路へ transition
3. tsx で .ts を実行(挙動は従来と同一)

### S3. CSRF ディスクキャッシュの state transition

1. cold(キャッシュ無し): GET /api/csrf-token → token を memory + disk に保存 → POST
2. warm(TTL 内): disk から token を読み memory に load → GET を省略して POST
3. 403(サーバ再起動で token 失効): invalidate → forceRefresh fetch → 再 POST の retry process

### S4. バンドル鮮度ガード

1. .ts を編集して .mjs を再ビルドし忘れる
2. テストが現行 config で再ビルドし committed .mjs と byte 比較
3. 不一致なら fail(`npm run build:hooks` で再生成を要求)

## Contracts

- `run-hook.sh <hook>.ts` の実行結果(POST する report_activity payload・出力 JSON)は
  .mjs 経路でも tsx 経路でも同一。
- report_activity への POST は production では X-CSRF-Token を要求(csrfMiddleware)。
  ディスクキャッシュした token で POST し、403 なら fresh token で再 POST する。

## Anti-patterns (this fix avoids)

- フックを毎回 tsx でその場コンパイルし、CPU 飽和時に 3 秒 timeout で kill されて heartbeat を失う
- 一発プロセスで in-memory cache に頼り毎回 CSRF を再取得してネットワーク往復を増やす
- production で CSRF 必須なのに token を付けずに POST して 403 で落とす(→ ディスクキャッシュ + 403 retry)
- 古いバンドルを本番フックとして走らせソースと挙動が乖離する(→ 鮮度テスト)

## Verification

- `tests/unit/activity-bridge-hook-bundles.test.js`
  - committed .mjs == 再ビルド結果(S4)
  - 各 .mjs が self-contained(未解決 import なし)
- 手動実測: tsx 414-911ms → node bundle 65-150ms / csrf-cache.json 書き込み / POST 200

## Out Of Scope

- explicit heartbeat の cadence(長時間ツール/思考のギャップ)。pane-title fallback がカバー
- フック以外の事前バンドル化

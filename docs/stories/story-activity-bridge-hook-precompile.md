---
story_id: story-activity-bridge-hook-precompile
title: activity-bridge フックを事前バンドル + CSRF ディスクキャッシュで 3 秒 timeout 内に収める
status: implemented
horizon: M1
view: runtime
period: 2026-05
reason: フック実行を tsx(毎回コンパイル)から事前バンドル .mjs(node) へ切替 + CSRF をディスクキャッシュする軽量化。責務分担・公開境界・サーバ契約を変えない。.mjs 不在時は tsx に fallback。
architecture_docs:
  - path: docs/session-activity-indicator-lifecycle.md
    status: accepted
spec_docs:
  - path: docs/specs/story-activity-bridge-hook-precompile-spec.md
    status: accepted
source_requirement:
  requirement_title: Claude 稼働インジケータの explicit heartbeat が CPU 飽和時に欠落する根本(フック実行が遅すぎる)を解消する
---

# activity-bridge フックの事前バンドル + CSRF ディスクキャッシュ

## Background

ユーザー報告「Claude 稼働インジケータが消える」の**最深部の根本原因**。[[feedback_claude_indicator_toolless_staleness]]
で staleness(#888) と pane-title fallback(#889) は直したが、そもそも explicit heartbeat が
間欠的にサーバへ届かない原因が残っていた。

実証:
- PostToolUse hook の matcher は `.*`(全ツール対象)、timeout は **3000ms**。
- フックは `.claude/scripts/run-hook.sh` 経由で `tsx`(毎回 esbuild で TypeScript を
  その場コンパイル)で実行。実測 cold start **414〜911ms**(tsx 単体 381ms)。
- フック内訳: tsx コンパイル + CSRF GET(最大1s)+ report_activity POST(最大1s)。
- 並列サブエージェント等で **CPU/ネットワークが飽和すると 3 秒を超え、Claude Code が
  フックを kill** → POST 到達前に殺されて heartbeat 消失。
- 動かぬ証拠: 当日の heartbeat ログに **122 分のギャップが「ログ行ゼロ」で存在**
  (10 並列サブエージェントの VibePro レビューを回した時間帯と一致)。フックは発火したが
  postActivity 直後の logHookExecution 到達前に kill された＝飽和下で殺された証拠。
  通常時は 985 本/日 heartbeat が出ており平常は機能している。

## Change

1. **フック事前バンドル**: 3 つの entrypoint(post-tool-use / user-prompt-submit / stop の
   activity-bridge.ts)を esbuild で self-contained な `.mjs` にバンドル(`npm run build:hooks`
   / `.claude/scripts/build-activity-bridge-hooks.mjs`)。`run-hook.sh` は `.mjs` があれば
   `node`(コンパイル無し、実測 **65〜150ms**)で実行し、無ければ従来どおり tsx に fallback。
   `.mjs` は git にコミットしてセッション worktree へ配布する。
2. **CSRF ディスクキャッシュ**: 一発フックプロセスでは in-memory cache が効かず毎回
   GET /api/csrf-token していた。token を `.claude/hooks/data/activity-bridge/csrf-cache.json`
   に保存し、TTL 内はディスクから読んで 1 往復削減。サーバ再起動で token が 403 になる
   staleness は postActivity が 403 を検知して invalidate + fresh fetch + 1 回リトライする。

合計でフックは飽和下でも 3 秒予算に確実に収まり、heartbeat 欠落を構造的に解消する。

## Acceptance Criteria

- [x] `run-hook.sh` は `.mjs` バンドルがあれば `node` で実行し、無ければ tsx に fallback する
- [x] 3 つのフック .mjs が .ts ソースと byte 一致する(古いバンドル混入をテストで防ぐ)
- [x] CSRF token はディスクにキャッシュされ、TTL 内はサーバへ再取得しない
- [x] POST が 403(再起動で token 失効)なら token を破棄して fresh fetch + リトライする
- [x] バンドル .mjs は `node` 単体で実行でき report_activity を POST できる(未解決 import なし)

## Implementation Evidence

- `.claude/scripts/core/monitoring/brainbase-activity-bridge.ts`: CSRF ディスクキャッシュ
  (readCsrfDiskCache/writeCsrfDiskCache/invalidateCsrfToken)+ postActivity の 403 リトライ
- `.claude/scripts/build-activity-bridge-hooks.mjs`: esbuild バンドルスクリプト(config 共有)
- `.claude/scripts/hooks/*/activity-bridge.mjs`: コミット済みバンドル(3 本)
- `.claude/scripts/run-hook.sh`: `.mjs` 優先 + tsx fallback
- `package.json`: `build:hooks` script
- `tests/unit/activity-bridge-hook-bundles.test.js`: 再ビルド byte 一致 + self-contained 検証
- 実測: tsx 414-911ms → node bundle 65-150ms。csrf-cache.json 書き込み・report_activity POST 200 を確認

## Out Of Scope

- explicit heartbeat の cadence そのもの(長い単一ツール呼び出し/思考区間のギャップ)。
  これは pane-title fallback(#889)が時間非依存の安全網としてカバーする
- Stop hook 未発火時の done 解決(別 Story)
- フック以外(SessionStart 等)の事前バンドル化(将来候補)

---
story_id: story-csrf-exempt-report-activity
title: CSRF-exempt /api/sessions/report_activity (hook telemetry — dev log spam + prod activity drop)
status: active
source_requirement:
  type: user_report
  detail: >
    Loki に `[CSRF] Missing token for POST /api/sessions/report_activity` が ~60秒おきに延々出る。
    調査の結果、活動報告フック(activity-bridge.mjs 等)が CSRF トークン無しで POST しており、dev では
    warn+通過(ログノイズ)、本番では 403 でドロップ(セッション活動インジケータが stale になる潜在バグ)。
architecture_docs:
  - path: docs/specs/story-csrf-exempt-report-activity-spec.md
    status: referenced
    reason: CSRF middleware に既存の path 除外(/api/auth/device/)と同じ仕組みで report_activity を1つ追加するだけの局所修正。新規モジュール境界・依存・データフロー・公開API・イベント契約の変更なし。
---

## Background

`/api/sessions/report_activity` は**ブラウザではなく信頼されたローカルのフック/CLI**が POST する:
`.claude/scripts/hooks/{notification,user-prompt-submit,stop,post-tool-use}/activity-bridge.mjs`、
`scripts/lib/brainbase-common.sh`、`scripts/codex-pty-shim.py`、`codex-app-repl.mjs` など。これらは
curl/fetch でブラウザ CSRF トークンを持たない。

`server/middleware/csrf.js` は dev(NODE_ENV≠production)で missing-token を `warnOncePerInterval` し
`next()` で通すため local では動くが**毎間隔ログをスパム**。本番では 403 を返すため、**フック由来の
活動報告が全てドロップ**＝セッションの working/done インジケータが本番で更新されない潜在バグ。

CSRF はクロスサイトのブラウザフォージェリ対策で、localhost フック→localhost サーバの非破壊な
テレメトリ POST には脅威モデル上適用外。既存の `/api/auth/device/`（CLI で token 無し）と同様に除外する。

## Scope

- `csrf.js` の path 除外に `/api/sessions/report_activity` を1つ追加（GET/HEAD/OPTIONS と
  `/api/auth/device/` の既存除外と同じ早期 `return next()`）。
- out of scope: 他テレメトリ endpoint の見直し、フック側に CSRF トークンを持たせる方式（複雑・session
  キー管理が必要）、dev の warn 仕組み自体。

## Acceptance Criteria

- [x] In production a POST to the session activity report endpoint without a CSRF token is allowed through so trusted local hook activity telemetry is not dropped with a 403.
- [x] In production any other mutating endpoint without a CSRF token is still rejected with 403 so the exemption is scoped only to the activity telemetry endpoint.

## Verification

- `tests/unit/csrf-report-activity-exempt.test.js`: production-mode middleware allows report_activity
  without a token (next called, no 403) and still 403s another POST endpoint without a token.
- `tests/e2e/story-csrf-exempt-report-activity.spec.ts`: in-process Playwright driving the real
  `csrfMiddleware`, same two ACs.
- Existing CSRF tests (s-1-csrf-header, inv-1-http-client-csrf) stay green.

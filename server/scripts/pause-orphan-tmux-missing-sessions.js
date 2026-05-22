#!/usr/bin/env node
/**
 * pause-orphan-tmux-missing-sessions.js
 *
 * One-shot cleanup for sessions stuck in `intendedState='active'` whose tmux
 * runtime has been missing for ages (incident 2026-05-21).
 *
 * Story: story-tmux-missing-runtime-pause
 *
 * Why this exists:
 *   Before the runtime fix in `runtime-lifecycle-methods.js`, the periodic
 *   `ensureTtydForActiveSession` tick logged "tmux is not running" and skipped
 *   without updating state. Sessions accumulated as `active`+tmux_missing for
 *   days (17 in last 7d per Loki). This script flips them to `paused` with
 *   reason `tmux_missing_runtime` so the UI degraded indicator clears
 *   immediately, without waiting for the new periodic logic to converge.
 *
 * Usage:
 *   node server/scripts/pause-orphan-tmux-missing-sessions.js --dry-run
 *   node server/scripts/pause-orphan-tmux-missing-sessions.js --apply
 *   node server/scripts/pause-orphan-tmux-missing-sessions.js --apply --session session-1778025113158
 *
 * The script talks to a running brainbase-ui via its terminal-health endpoint
 * to discover tmux_missing sessions, then PATCHes their state to `paused` via
 * `/api/state/sessions/:id`. We can't use `/api/sessions/:id/stop` because
 * tmux_missing sessions are already absent from the runtime activeSessions map
 * (so /stop returns 404 without updating persisted state).
 */

import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const HEALTH_URL = process.env.BRAINBASE_UI_URL || 'http://localhost:31013';

export function buildBrainbaseUrl(pathname, baseUrl = HEALTH_URL) {
  return new URL(pathname, `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

export function buildSessionStateUrl(sessionId, baseUrl = HEALTH_URL) {
  const url = new URL('api/state/sessions/', `${baseUrl.replace(/\/+$/, '')}/`);
  url.pathname = `${url.pathname}${encodeURIComponent(sessionId)}`;
  return url.toString();
}

export function parseArgs(args = argv.slice(2)) {
  const out = { dryRun: true, sessions: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--apply') out.dryRun = false;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--session') {
      out.sessions = out.sessions || new Set();
      out.sessions.add(args[++i]);
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: node server/scripts/pause-orphan-tmux-missing-sessions.js [--dry-run|--apply] [--session <id> ...]');
      exit(0);
    }
  }
  return out;
}

export async function fetchTerminalHealth({ fetchImpl = fetch, baseUrl = HEALTH_URL } = {}) {
  const res = await fetchImpl(buildBrainbaseUrl('api/health/terminal', baseUrl));
  if (!res.ok) throw new Error(`GET /api/health/terminal -> ${res.status}`);
  return res.json();
}

export function collectTmuxMissingSessionIds(health, filter) {
  const ids = new Set();
  for (const issue of health.issues || []) {
    if (issue.type === 'tmux_missing' && issue.sessionId) {
      if (!filter || filter.has(issue.sessionId)) ids.add(issue.sessionId);
    }
  }
  return [...ids];
}

export async function pauseSession(sessionId, { fetchImpl = fetch, baseUrl = HEALTH_URL, now = new Date().toISOString() } = {}) {
  // PATCH /api/state/sessions/:id で intendedState を直接 paused に更新する。
  // 2026-05-21 incident: /api/sessions/:id/stop は activeSessions map に対象
  // が存在しないと 404 を返して state を更新しない。 tmux_missing sessions は
  // すでに activeSessions から外れているので /stop は使えない。 直接 state
  // を mutate するこの経路を採用する。 _pauseSessionsForMissingTmux helper
  // と同じ field set を書き込んで挙動を揃える。
  const body = JSON.stringify({
    intendedState: 'paused',
    pausedReason: 'tmux_missing_runtime',
    pausedAt: now,
    tmuxMissingAt: now,
    ttydProcess: null,
  });
  const res = await fetchImpl(buildSessionStateUrl(sessionId, baseUrl), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`PATCH /api/state/sessions/${sessionId} -> ${res.status} ${errBody.slice(0, 200)}`);
  }
  const patched = await res.json().catch(() => ({}));
  return { status: res.status, intendedState: patched.intendedState, pausedReason: patched.pausedReason };
}

export async function runPauseOrphanCleanup({
  dryRun,
  sessions,
  fetchImpl = fetch,
  baseUrl = HEALTH_URL,
  now = new Date().toISOString(),
  log = console.log,
  error = console.error,
} = {}) {
  log(`[pause-orphan] mode=${dryRun ? 'DRY-RUN' : 'APPLY'} target=${baseUrl}`);
  const health = await fetchTerminalHealth({ fetchImpl, baseUrl });
  const ids = collectTmuxMissingSessionIds(health, sessions);
  log(`[pause-orphan] tmux_missing sessions: ${ids.length}`);
  for (const id of ids) log(`  - ${id}`);

  if (ids.length === 0) {
    log('[pause-orphan] nothing to do');
    return { ids, ok: 0, fail: 0 };
  }

  if (dryRun) {
    log('[pause-orphan] dry-run: not patching. re-run with --apply');
    return { ids, ok: 0, fail: 0 };
  }

  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      const r = await pauseSession(id, { fetchImpl, baseUrl, now });
      log(`  ✓ paused ${id} (HTTP ${r.status}, intendedState=${r.intendedState}, pausedReason=${r.pausedReason})`);
      ok++;
    } catch (err) {
      error(`  ✗ ${id}: ${err.message}`);
      fail++;
    }
  }
  log(`[pause-orphan] done: ok=${ok} fail=${fail}`);
  return { ids, ok, fail };
}

async function main() {
  const { dryRun, sessions } = parseArgs();
  const { fail } = await runPauseOrphanCleanup({ dryRun, sessions });
  exit(fail > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[pause-orphan] FATAL', err);
    exit(1);
  });
}

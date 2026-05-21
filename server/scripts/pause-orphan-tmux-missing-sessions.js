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
 * to discover tmux_missing sessions, then issues a session stop request via
 * the existing internal API.
 */

import { argv, exit } from 'node:process';

const HEALTH_URL = process.env.BRAINBASE_UI_URL || 'http://localhost:31013';

function parseArgs() {
  const out = { dryRun: true, sessions: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.dryRun = false;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--session') {
      out.sessions = out.sessions || new Set();
      out.sessions.add(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: node server/scripts/pause-orphan-tmux-missing-sessions.js [--dry-run|--apply] [--session <id> ...]');
      exit(0);
    }
  }
  return out;
}

async function fetchTerminalHealth() {
  const res = await fetch(`${HEALTH_URL}/api/health/terminal`);
  if (!res.ok) throw new Error(`GET /api/health/terminal -> ${res.status}`);
  return res.json();
}

function collectTmuxMissingSessionIds(health, filter) {
  const ids = new Set();
  for (const issue of health.issues || []) {
    if (issue.type === 'tmux_missing' && issue.sessionId) {
      if (!filter || filter.has(issue.sessionId)) ids.add(issue.sessionId);
    }
  }
  return [...ids];
}

async function stopSession(sessionId) {
  // POST /api/sessions/:id/stop preserves tmux=false by default which is fine
  // (tmux is already gone — that's the whole point). The server-side stop
  // handler will mark the session paused and clear ttydProcess.
  const res = await fetch(`${HEALTH_URL}/api/sessions/${encodeURIComponent(sessionId)}/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preserveTmux: false }),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`POST /api/sessions/${sessionId}/stop -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.status;
}

async function main() {
  const { dryRun, sessions } = parseArgs();

  console.log(`[pause-orphan] mode=${dryRun ? 'DRY-RUN' : 'APPLY'} target=${HEALTH_URL}`);
  const health = await fetchTerminalHealth();
  const ids = collectTmuxMissingSessionIds(health, sessions);
  console.log(`[pause-orphan] tmux_missing sessions: ${ids.length}`);
  for (const id of ids) console.log(`  - ${id}`);

  if (ids.length === 0) {
    console.log('[pause-orphan] nothing to do');
    return;
  }

  if (dryRun) {
    console.log('[pause-orphan] dry-run: not stopping. re-run with --apply');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      const status = await stopSession(id);
      console.log(`  ✓ stopped ${id} (HTTP ${status})`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${id}: ${err.message}`);
      fail++;
    }
  }
  console.log(`[pause-orphan] done: ok=${ok} fail=${fail}`);
  exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[pause-orphan] FATAL', err);
  exit(1);
});

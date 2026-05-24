#!/usr/bin/env bash
set -euo pipefail

port="${BRAINBASE_E2E_PORT:-31014}"
log_file="${BRAINBASE_SMOKE_LOG:-/tmp/brainbase-hibernation-api-smoke-server.log}"
out_file="${BRAINBASE_SMOKE_OUT:-/tmp/brainbase-hibernation-api-smoke-output.json}"

pids="$(lsof -ti ":${port}" || true)"
if [ -n "$pids" ]; then
  kill $pids || true
fi

BRAINBASE_E2E_PORT="$port" npm run test:server >"$log_file" 2>&1 &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
  pids="$(lsof -ti ":${port}" || true)"
  if [ -n "$pids" ]; then
    kill $pids || true
  fi
}
trap cleanup EXIT

for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$log_file"
    exit 1
  fi
  if [ "$i" = "60" ]; then
    cat "$log_file"
    exit 1
  fi
done

PORT="$port" node - <<'NODE' | tee "$out_file"
const base = `http://127.0.0.1:${process.env.PORT}`;
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const stateRes = await fetch(`${base}/api/state`);
if (!stateRes.ok) fail(`state status ${stateRes.status}`);
const state = await stateRes.json();
const sessions = state.sessions;
if (!Array.isArray(sessions) || sessions.length === 0) fail('no state sessions returned');
const target = sessions[0];
const inventoryRes = await fetch(`${base}/api/sessions/runtime/inventory`);
if (!inventoryRes.ok) fail(`inventory status ${inventoryRes.status}`);
const inventory = await inventoryRes.json();
if (!Array.isArray(inventory.sessions)) fail('inventory.sessions missing');
const item = inventory.sessions.find((session) => session.sessionId === target.id) || inventory.sessions[0];
if (!item || !item.sessionId) fail('inventory session item missing');
if (typeof item.processCount !== 'number') fail('inventory session processCount missing');
if (typeof item.rssKb !== 'number') fail('inventory session rssKb missing');
if (!item.processesByCategory || typeof item.processesByCategory !== 'object') {
  fail('inventory session processesByCategory missing');
}
if (!Array.isArray(inventory.unattributed)) fail('inventory.unattributed missing');
if (!inventory.totals || typeof inventory.totals.unattributedProcessCount !== 'number') {
  fail('inventory totals.unattributedProcessCount missing');
}
const eligibilityRes = await fetch(`${base}/api/sessions/${encodeURIComponent(item.sessionId)}/hibernate/eligibility`);
if (!eligibilityRes.ok) fail(`eligibility status ${eligibilityRes.status}`);
const eligibility = await eligibilityRes.json();
if (typeof eligibility.eligible !== 'boolean') fail('eligibility.eligible missing');
if (typeof eligibility.processCount !== 'number' || typeof eligibility.ownedProcessCount !== 'number') {
  fail('eligibility process counts missing');
}
console.log(JSON.stringify({
  sessions: sessions.length,
  firstSession: item.sessionId,
  firstProcessCount: item.processCount,
  firstRssKb: item.rssKb,
  unattributed: inventory.unattributed.length,
  unattributedTotal: inventory.totals.unattributedProcessCount,
  eligible: eligibility.eligible,
  blockers: eligibility.blockers || [],
  runtimePresence: item.runtimePresence,
  ownedProcessCount: eligibility.ownedProcessCount,
}, null, 2));
NODE

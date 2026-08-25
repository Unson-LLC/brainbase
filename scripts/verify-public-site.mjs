#!/usr/bin/env node
const baseUrl = (process.env.BRAINBASE_PUBLIC_URL ?? 'https://brainbase.pages.dev').replace(/\/$/, '');
const expectedSha = process.env.EXPECTED_BUILD_SHA?.slice(0, 12);
const attempts = Number(process.env.PUBLIC_READBACK_ATTEMPTS ?? 12);
const delayMs = Number(process.env.PUBLIC_READBACK_DELAY_MS ?? 5000);

const checks = [
  { path: '/', required: ['会社の判断を、属人化させない。', 'Brainbaseを理解する'] },
  { path: '/guide/status', required: ['Released — v0.4.0', 'Planned — 未実装または未完成'] },
  { path: '/reference/mcp-tools', required: ['Ontology 2.0.0', 'resolve_entity'] }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyOnce() {
  const failures = [];
  for (const check of checks) {
    const response = await fetch(`${baseUrl}${check.path}`, {
      headers: { 'cache-control': 'no-cache' }
    });
    if (!response.ok) {
      failures.push(`${check.path}: HTTP ${response.status}`);
      continue;
    }
    const text = await response.text();
    for (const required of check.required) {
      if (!text.includes(required)) {
        failures.push(`${check.path}: missing ${required}`);
      }
    }
    if (check.path === '/' && expectedSha && !text.includes(expectedSha)) {
      failures.push(`${check.path}: missing build SHA ${expectedSha}`);
    }
  }
  return failures;
}

let lastFailures = [];
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    lastFailures = await verifyOnce();
  } catch (error) {
    lastFailures = [error instanceof Error ? error.message : String(error)];
  }
  if (lastFailures.length === 0) {
    process.stdout.write(`${JSON.stringify({
      status: 'public_readback_valid',
      base_url: baseUrl,
      expected_sha: expectedSha ?? null,
      attempt
    }, null, 2)}\n`);
    process.exit(0);
  }
  if (attempt < attempts) {
    await sleep(delayMs);
  }
}

throw new Error(`public readback failed: ${lastFailures.join('; ')}`);

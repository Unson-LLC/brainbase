#!/usr/bin/env node

const baseUrl = String(process.env.BRAINBASE_BASE_URL || 'http://127.0.0.1:55123').replace(/\/+$/, '');
const expectedSha = process.env.BRAINBASE_EXPECTED_SHA || '';
const expectedCatalogStatus = process.env.BRAINBASE_EXPECTED_CATALOG_STATUS || '';
const philosophyUrl = process.env.BRAINBASE_PHILOSOPHY_SMOKE_URL || '';

async function getJson(url, label) {
    const response = await fetch(url, {
        headers: process.env.BRAINBASE_AUTH_TOKEN
            ? { authorization: `Bearer ${process.env.BRAINBASE_AUTH_TOKEN}` }
            : {}
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`${label} did not return JSON`);
    }
}

const failures = [];
const health = await getJson(`${baseUrl}/api/health`, 'health');
const version = await getJson(`${baseUrl}/api/version`, 'version');

if (health.status !== 'healthy') {
    failures.push(`health status is ${health.status}`);
}
if (expectedCatalogStatus && health.checks?.config?.status !== expectedCatalogStatus) {
    failures.push(
        `config status is ${health.checks?.config?.status || 'missing'}, expected ${expectedCatalogStatus}`
    );
}
if (expectedSha && !String(version.runtime?.git?.sha || '').startsWith(expectedSha)) {
    failures.push(`runtime SHA is ${version.runtime?.git?.sha || 'missing'}, expected ${expectedSha}`);
}
if (version.runtime?.git?.dirty === true) {
    failures.push('runtime checkout is dirty');
}

if (philosophyUrl) {
    await getJson(philosophyUrl, 'philosophy smoke');
}

const result = {
    success: failures.length === 0,
    baseUrl,
    health: health.status,
    config: health.checks?.config?.status || null,
    runtimeSha: version.runtime?.git?.sha || null,
    runtimeDirty: version.runtime?.git?.dirty ?? null,
    philosophySmoke: philosophyUrl ? 'passed' : 'not_requested',
    failures
};

console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exitCode = 1;

#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
        args.set(arg.slice(2), process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1]);
        if (!process.argv[i + 1]?.startsWith('--')) i += 1;
    }
}

const baseUrl = String(args.get('base-url') || process.env.BRAINBASE_ADMIN_PAGE_URL || 'http://127.0.0.1:31019/admin.html');
const outDir = path.resolve(String(args.get('output-dir') || '.vibepro/qa/admin-personal-kg'));

function readToken() {
    if (process.env.BRAINBASE_AUTH_TOKEN) return { token: process.env.BRAINBASE_AUTH_TOKEN, source: 'env:BRAINBASE_AUTH_TOKEN' };
    const tokenPath = path.join(os.homedir(), '.brainbase', 'tokens.json');
    const parsed = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
    if (!parsed.access_token) throw new Error('access_token is missing from ~/.brainbase/tokens.json');
    return { token: parsed.access_token, source: '~/.brainbase/tokens.json' };
}

fs.mkdirSync(outDir, { recursive: true });
const auth = readToken();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addInitScript((authToken) => {
    window.localStorage.setItem('brainbase.auth.token', authToken);
}, auth.token);

const page = await context.newPage();
page.setDefaultTimeout(60000);
const failures = [];
const apiErrors = [];
const consoleErrors = [];

page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/admin/') && response.status() >= 400) {
        apiErrors.push({ url, status: response.status() });
    }
});
page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
});

await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.screenshot({ path: path.join(outDir, 'overview.png'), fullPage: true });

await page.getByRole('button', { name: /個人KG/ }).click();
await page.waitForLoadState('networkidle');
await page.waitForSelector('text=個人KG候補');
await page.screenshot({ path: path.join(outDir, 'personal-kg-top.png'), fullPage: false });
const personalTopText = await page.textContent('body');
if (!personalTopText.includes('レビュー:')) failures.push('personal kg review label missing');
if (!personalTopText.includes('さらに表示')) failures.push('personal kg load-more missing at initial limit');

for (let index = 0; index < 4; index += 1) {
    const button = page.locator('[data-load-more-personal-kg]');
    if (await button.count() === 0) break;
    await button.first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(250);
}
await page.screenshot({ path: path.join(outDir, 'personal-kg.png'), fullPage: true });
const personalText = await page.textContent('body');
if (!personalText.includes('最新500件の上限に達しました')) failures.push('personal kg 500 cap message missing');
const loadMoreAtCapCount = await page.locator('[data-load-more-personal-kg]').count();
if (loadMoreAtCapCount > 0) failures.push('personal kg load-more still visible at 500 cap');

await page.getByRole('button', { name: /設定\/ヘルス/ }).click();
await page.waitForLoadState('networkidle');
await page.waitForSelector('text=DB接続先');
await page.screenshot({ path: path.join(outDir, 'health.png'), fullPage: true });
const healthText = await page.textContent('body');
if (!healthText.includes('DB接続先')) failures.push('health DB label missing');
if (!healthText.includes('個人KG read path')) failures.push('personal KG read path health missing');
if (!healthText.includes('値: 非表示')) failures.push('health redaction label missing');
if (healthText.includes('postgres://')) failures.push('health leaked postgres URL');
if (healthText.includes(auth.token)) failures.push('health leaked bearer token');

await page.getByRole('button', { name: /個人KG/ }).click();
await page.locator('[data-personal-kg-filter="owner"]').fill('umeda');
await page.locator('[data-load-personal-kg]').click();
await page.waitForLoadState('networkidle');
await page.waitForSelector('text=表示対象外');
await page.screenshot({ path: path.join(outDir, 'personal-kg-denied-owner.png'), fullPage: true });
const deniedText = await page.textContent('body');
if (!deniedText.includes('表示対象外')) failures.push('denied owner state missing');
if (deniedText.includes('postgres://')) failures.push('denied owner leaked postgres URL');

const bodyText = await page.textContent('body');
const oldRagLabelVisible = /LightRAG|lightrag|derived_index|derived indexes|派生index|派生インデックス/.test(bodyText);
if (oldRagLabelVisible) failures.push('old RAG label visible');
if (apiErrors.length) failures.push(`api errors: ${JSON.stringify(apiErrors)}`);
if (consoleErrors.length) failures.push(`console errors: ${JSON.stringify(consoleErrors)}`);

const result = {
    checked_at: new Date().toISOString(),
    base_url: baseUrl,
    auth: `${auth.source}; credential value not recorded`,
    screenshots: {
        overview: path.join(outDir, 'overview.png'),
        personal_kg_top: path.join(outDir, 'personal-kg-top.png'),
        personal_kg: path.join(outDir, 'personal-kg.png'),
        health: path.join(outDir, 'health.png'),
        personal_kg_denied_owner: path.join(outDir, 'personal-kg-denied-owner.png')
    },
    personalKgReviewVisible: personalTopText.includes('レビュー:'),
    personalKgLoadMoreVisible: personalTopText.includes('さらに表示'),
    personalKgCapVisible: personalText.includes('最新500件の上限に達しました'),
    personalKgLoadMoreHiddenAtCap: loadMoreAtCapCount === 0,
    healthDbVisible: healthText.includes('DB接続先'),
    healthReadPathVisible: healthText.includes('個人KG read path'),
    healthValuesRedacted: healthText.includes('値: 非表示') && !healthText.includes('postgres://') && !healthText.includes(auth.token),
    deniedOwnerVisible: deniedText.includes('表示対象外'),
    oldRagLabelVisible,
    apiErrors,
    consoleErrors,
    failures
};

fs.writeFileSync(path.join(outDir, 'visual-smoke.json'), `${JSON.stringify(result, null, 2)}\n`);
await browser.close();

if (failures.length) {
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
}

console.log(JSON.stringify(result, null, 2));

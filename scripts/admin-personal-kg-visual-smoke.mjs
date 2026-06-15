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

function personalKgReturnedCount(text) {
    const match = String(text || '').match(/表示:\s*(\d+)\s*\/\s*(\d+)/);
    return match ? Number(match[1]) : 0;
}

async function waitForPanelSettled(page, selector, loadingText) {
    await page.waitForFunction(({ targetSelector, pendingText }) => {
        const text = document.querySelector(targetSelector)?.textContent || '';
        return text.trim().length > 0 && !text.includes(pendingText);
    }, { targetSelector: selector, pendingText: loadingText }, { timeout: 60000 });
}

async function panelText(page, selector) {
    return page.locator(selector).textContent();
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
const overviewText = await page.textContent('body');
if (!overviewText.includes('Graph正本')) failures.push('overview graph source missing');
if (!overviewText.includes('候補ストア')) failures.push('overview candidate source missing');

await page.getByRole('button', { name: /Graph正本/ }).click();
await page.waitForLoadState('networkidle');
await waitForPanelSettled(page, '[data-graph-list]', 'Graph正本を読み込みます');
await page.screenshot({ path: path.join(outDir, 'graph.png'), fullPage: true });
const graphText = await page.textContent('body');
const graphPanelText = await panelText(page, '[data-graph-list]');
if (!graphText.includes('Graph正本')) failures.push('graph tab label missing');
if (graphPanelText.includes('Graph正本を読み込みます')) failures.push('graph tab still loading');
if (graphPanelText.includes('読み込みに失敗しました')) failures.push('graph tab load failed');

await page.getByRole('button', { name: /候補ストア/ }).click();
await page.waitForLoadState('networkidle');
await waitForPanelSettled(page, '[data-candidate-list]', '候補ストアを読み込みます');
await page.screenshot({ path: path.join(outDir, 'candidates.png'), fullPage: true });
const candidateText = await page.textContent('body');
const candidatePanelText = await panelText(page, '[data-candidate-list]');
if (!candidateText.includes('候補ストア')) failures.push('candidate tab label missing');
if (candidatePanelText.includes('候補ストアを読み込みます')) failures.push('candidate tab still loading');
if (candidatePanelText.includes('読み込みに失敗しました')) failures.push('candidate tab load failed');

await page.getByRole('button', { name: /AI文脈/ }).click();
await page.getByRole('button', { name: /文脈を確認/ }).click();
await page.waitForLoadState('networkidle');
await page.waitForFunction(() => {
    const text = document.querySelector('[data-context-result]')?.textContent || '';
    return text.includes('project:');
}, null, { timeout: 60000 });
await page.screenshot({ path: path.join(outDir, 'context.png'), fullPage: true });
const contextText = await page.textContent('body');
const contextPanelText = await panelText(page, '[data-context-result]');
if (!contextText.includes('プレビュー')) failures.push('context preview label missing');
if (contextPanelText.includes('読み込みに失敗しました')) failures.push('context preview load failed');

await page.getByRole('button', { name: /データフロー/ }).click();
await page.waitForLoadState('networkidle');
await page.waitForSelector('[data-flow-list] .health-row');
await page.screenshot({ path: path.join(outDir, 'flow.png'), fullPage: true });
const flowText = await page.textContent('body');
const flowPanelText = await panelText(page, '[data-flow-list]');
if (!flowPanelText.includes('候補ID未指定')) failures.push('flow default candidate state missing');
if (!flowPanelText.includes('正本ID未指定')) failures.push('flow default graph state missing');
if (flowPanelText.includes('読み込みに失敗しました')) failures.push('flow tab load failed');

await page.getByRole('button', { name: /個人KG/ }).click();
await page.waitForLoadState('networkidle');
await page.waitForSelector('text=個人KG候補');
await page.screenshot({ path: path.join(outDir, 'personal-kg-top.png'), fullPage: false });
const personalTopText = await page.textContent('body');
if (!personalTopText.includes('レビュー:')) failures.push('personal kg review label missing');
if (!personalTopText.includes('さらに表示')) failures.push('personal kg load-more missing at initial limit');

for (let index = 0; index < 6; index += 1) {
    const button = page.locator('[data-load-more-personal-kg]');
    if (await button.count() === 0) break;
    const beforeReturned = personalKgReturnedCount(await page.textContent('body'));
    await button.first().click();
    await page.waitForFunction(({ before }) => {
        const text = document.body?.innerText || '';
        const match = text.match(/表示:\s*(\d+)\s*\/\s*(\d+)/);
        const returned = match ? Number(match[1]) : 0;
        return returned > before || text.includes('最新500件の上限に達しました') || !document.querySelector('[data-load-more-personal-kg]');
    }, { before: beforeReturned }, { timeout: 60000 });
    await page.waitForTimeout(100);
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
        graph: path.join(outDir, 'graph.png'),
        candidates: path.join(outDir, 'candidates.png'),
        context: path.join(outDir, 'context.png'),
        flow: path.join(outDir, 'flow.png'),
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
    graphVisible: graphText.includes('Graph正本') && !graphPanelText.includes('Graph正本を読み込みます') && !graphPanelText.includes('読み込みに失敗しました'),
    candidateStoreVisible: candidateText.includes('候補ストア') && !candidatePanelText.includes('候補ストアを読み込みます') && !candidatePanelText.includes('読み込みに失敗しました'),
    contextPreviewVisible: contextText.includes('プレビュー') && !contextPanelText.includes('読み込みに失敗しました'),
    dataFlowVisible: flowPanelText.includes('候補ID未指定') && flowPanelText.includes('正本ID未指定') && !flowPanelText.includes('読み込みに失敗しました'),
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

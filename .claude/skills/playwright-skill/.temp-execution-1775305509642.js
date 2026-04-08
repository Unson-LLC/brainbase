const { chromium } = require('playwright');
const TARGET_URL = 'http://127.0.0.1:31013';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const events = [];
  page.on('console', msg => events.push({ type: 'console', text: msg.text() }));
  page.on('pageerror', err => events.push({ type: 'pageerror', text: err.message }));
  page.on('requestfailed', req => events.push({ type: 'requestfailed', url: req.url(), error: req.failure()?.errorText || 'unknown' }));
  page.on('response', res => {
    const url = res.url();
    if (url.includes('/terminal/ensure') || url.includes('/terminal/snapshot') || url.includes('/runtime') || url.includes('/console/')) {
      events.push({ type: 'response', url, status: res.status() });
    }
  });
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const rows = await page.locator('.session-child-row').evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-id'), text: n.textContent?.trim() || '' })).filter(Boolean));
  console.log('ROWS', JSON.stringify(rows.slice(0,5), null, 2));
  if (rows.length < 2) {
    await browser.close();
    return;
  }
  const firstSel = '.session-child-row[data-id="' + rows[0].id + '"]';
  const secondSel = '.session-child-row[data-id="' + rows[1].id + '"]';
  await page.locator(firstSel).click();
  await page.waitForTimeout(300);
  await page.locator(secondSel).click();
  await page.waitForTimeout(1200);
  const snapshotText = await page.locator('#terminal-snapshot-content').textContent().catch(() => null);
  const statusText = await page.locator('#terminal-input-status').textContent().catch(() => null);
  const frameSrc = await page.locator('#terminal-frame').getAttribute('src').catch(() => null);
  const consoleAreaClass = await page.locator('#console-area').getAttribute('class').catch(() => null);
  await page.screenshot({ path: '/tmp/session-switch-flicker.png', fullPage: true });
  console.log('SNAPSHOT_TEXT', JSON.stringify(snapshotText));
  console.log('STATUS_TEXT', JSON.stringify(statusText));
  console.log('FRAME_SRC', JSON.stringify(frameSrc));
  console.log('CONSOLE_CLASS', JSON.stringify(consoleAreaClass));
  console.log('EVENTS', JSON.stringify(events.slice(-120), null, 2));
  await browser.close();
})();

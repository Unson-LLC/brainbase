const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });
  console.log('Page loaded');

  // Wait for the toggle button to be visible
  await page.waitForSelector('#view-toggle-btn', { state: 'visible' });
  console.log('Toggle button found');

  // Check current view state
  const currentView = await page.getAttribute('#view-toggle-btn', 'data-current-view');
  console.log('Current view:', currentView);

  // If current view is 'console', click to switch to dashboard
  if (currentView === 'console') {
    await page.click('#view-toggle-btn');
    console.log('Clicked toggle button to show dashboard');

    // Wait for dashboard panel to be visible
    await page.waitForSelector('#dashboard-panel', { state: 'visible', timeout: 5000 });
    console.log('Dashboard panel is now visible');
  }

  // Wait for Critical Alerts section to load
  await page.waitForSelector('#section-1-alerts', { state: 'visible', timeout: 5000 });
  console.log('Critical Alerts section is visible');

  // Wait for data to load (check for the header or first alert card)
  await page.waitForSelector('.critical-alerts-header, .empty-state', { timeout: 5000 });
  console.log('Critical Alerts content loaded');

  // Take full page screenshot
  await page.screenshot({
    path: '/tmp/dashboard-critical-alerts.png',
    fullPage: true
  });
  console.log('Screenshot saved to /tmp/dashboard-critical-alerts.png');

  // Get element bounding box for reference
  const section = await page.locator('#section-1-alerts');
  const box = await section.boundingBox();
  console.log('Section bounding box:', box);

  // Get number of alerts
  const alertCount = await page.locator('.critical-alert-card').count();
  console.log('Number of alerts:', alertCount);

  await browser.close();
})();

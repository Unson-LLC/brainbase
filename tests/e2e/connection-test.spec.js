/**
 * Simple connection test for LambdaTest
 * Verifies that Playwright can connect to LambdaTest cloud
 */

import { test, expect } from '@playwright/test';

test.describe('LambdaTest Connection Test', () => {
  test('should connect to LambdaTest and load page', async ({ page }) => {
    console.log('Connecting to LambdaTest...');

    await page.goto('https://brain-base.work');

    console.log('Page loaded successfully');

    const title = await page.title();
    console.log('Page title:', title);

    expect(title).toBeTruthy();
  });

  test('should interact with page elements', async ({ page }) => {
    await page.goto('https://brain-base.work');
    await page.waitForLoadState('networkidle');

    const bodyExists = await page.locator('body').count();
    expect(bodyExists).toBeGreaterThan(0);

    console.log('Page interaction successful');
  });
});

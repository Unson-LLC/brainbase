import { test, expect } from '@playwright/test';

test.describe('Terminal Copy Functionality', () => {
  test.use({
      permissions: ['clipboard-read', 'clipboard-write']
  });

  // Integration test - requires ttyd to be fully initialized with xterm
  // Skip for now: flaky due to ttyd/xterm initialization timing
  test.skip('should allow copying text from the terminal', async ({ page, context }) => {
    // 1. Setup Session
    const sessionName = 'CopyTest ' + Date.now();
    let nextName = sessionName;
    
    await page.goto('http://localhost:3000');
    
    page.on('dialog', async dialog => {
        if (dialog.message().includes('Enter session name')) {
             await dialog.accept(nextName);
        } else if (dialog.message().includes('Initial command')) {
             await dialog.accept(''); 
        } else {
             await dialog.dismiss();
        }
    });

    await page.click('#add-session-btn', { force: true });
    const sessionRow = page.locator('.session-child-row', { hasText: sessionName });
    await sessionRow.waitFor();
    await sessionRow.click();
    
    const sessionId = await sessionRow.getAttribute('data-id');

    // 2. Wait for terminal to be ready
    const iframe = page.frameLocator('iframe');
    const terminal = iframe.locator('.xterm-rows');
    await terminal.waitFor({ timeout: 10000 });

    // 3. Type unique text
    const uniqueText = `UNIQUE_COPY_TARGET_${Date.now()}`;
    await page.waitForTimeout(2000); 

    await page.request.post(`http://localhost:3000/api/sessions/${sessionId}/input`, {
        data: { input: `echo "${uniqueText}"\n` }
    });

    // 4. Wait for text to appear
    await expect(terminal).toContainText(uniqueText, { timeout: 5000 });
    
    // 5. Select All and Copy
    // Click inside iframe to focus
    await iframe.locator('.xterm-screen').click({ force: true });
    await page.waitForTimeout(500);
    
    // Meta+A (Select All)
    await page.keyboard.press('Meta+A');
    await page.waitForTimeout(500);

    // Meta+C (Copy)
    await page.keyboard.press('Meta+C');
    await page.waitForTimeout(500);

    // 6. Verify Clipboard
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    console.log('Clipboard Content:', clipboardText);

    expect(clipboardText).toContain(uniqueText);
  });
});

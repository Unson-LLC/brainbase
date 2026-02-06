import { test, expect } from '@playwright/test';

const DEFAULT_PORT = process.cwd().includes('.worktrees') ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
  || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

test.describe('Session Indicator', () => {
  // Integration test - requires ttyd, Claude Code, and proper session lifecycle
  // Skip for now: flaky due to timing dependencies on session state polling
  test.skip('should show working indicator when running a command', async ({ page }) => {
    // Capture console logs
    page.on('console', msg => console.log(`[Browser]: ${msg.text()}`));

    const sessionName = 'Test Session ' + Date.now();
    const otherSessionName = 'Other Session ' + Date.now();
    
    let nextName = sessionName;

    // 1. Open the app
    await page.goto(BASE_URL);
    
    // 2. Create a new session
    await page.reload();
    
    page.on('dialog', async dialog => {
        // console.log(`Dialog appeared: ${dialog.message()}`);
        if (dialog.message().includes('Enter session name')) {
             await dialog.accept(nextName);
        } else if (dialog.message().includes('Initial command')) {
             await dialog.accept(''); 
        } else {
             await dialog.dismiss();
        }
    });

    console.log('Clicking add-session-btn with force: true');
    await page.click('#add-session-btn', { force: true });

    const sessionRow = page.locator('.session-child-row', { hasText: sessionName });
    await sessionRow.waitFor({ timeout: 10000 });
    await sessionRow.click();
    
    const sessionId = await sessionRow.getAttribute('data-id');
    console.log('Session ID:', sessionId);

    // 3. Exit Claude to get a shell
    // Wait for session to be ready (5s buffer)
    await page.waitForTimeout(5000); 

    console.log('Sending Ctrl+C to exit Claude...');
    await page.request.post(`${BASE_URL}/api/sessions/${sessionId}/input`, {
        data: { input: '\x03' } // Ctrl+C
    });
    
    await page.waitForTimeout(1000); // Wait for shell

    // 4. Send sleep 15
    console.log('Sending sleep 15 command...');
    await page.request.post(`${BASE_URL}/api/sessions/${sessionId}/input`, {
        data: { input: 'sleep 15\n' }
    });

    // 5. Assert "Working" indicator (Orange Pulse)
    console.log('Waiting for working indicator...');
    const indicator = sessionRow.locator('.session-activity-indicator.working');
    try {
        await expect(indicator).toBeVisible({ timeout: 15000 });
        console.log('Working indicator found!');
    } catch (e) {
        console.error('Working indicator NOT found within timeout');
        throw e;
    }

    // 6. Assert "Done" indicator after command finishes
    nextName = otherSessionName;
    
    console.log('Creating second session to switch focus...');
    await page.click('#add-session-btn', { force: true });
    
    const otherSessionRow = page.locator('.session-child-row', { hasText: otherSessionName });
    await otherSessionRow.waitFor();
    await otherSessionRow.click();
    
    console.log('Waiting for Done indicator on first session...');
    const doneIndicator = sessionRow.locator('.session-activity-indicator.done');
    await expect(doneIndicator).toBeVisible({ timeout: 25000 }); // 15s sleep + buffer
    console.log('Done indicator found!');
  });
});

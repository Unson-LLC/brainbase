/**
 * ブラウザコンソールログ自動取得スクリプト
 * Usage: node debug-console.mjs
 */
import { chromium } from '@playwright/test';

async function debugBrainbaseUI() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // ネットワークリクエストをモニタリング
  page.on('request', request => {
    if (request.url().includes('/api/sessions')) {
      console.log(`[NETWORK] Request: ${request.method()} ${request.url()}`);
      try {
        console.log(`[NETWORK] Payload: ${request.postData()}`);
      } catch (e) {
        // ignore
      }
    }
  });

  page.on('response', async response => {
    if (response.url().includes('/api/sessions')) {
      console.log(`[NETWORK] Response: ${response.status()} ${response.url()}`);
      try {
        const text = await response.text();
        console.log(`[NETWORK] Response body: ${text}`);
      } catch (e) {
        console.log(`[NETWORK] Could not read response body`);
      }
    }
  });

  // コンソールログを収集
  const consoleLogs = [];
  page.on('console', msg => {
    const logEntry = {
      type: msg.type(),
      text: msg.text(),
      location: msg.location()
    };
    consoleLogs.push(logEntry);

    // リアルタイムで表示
    console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
  });

  // ページエラーをキャッチ
  page.on('pageerror', error => {
    console.error('[PAGE ERROR]', error.message);
  });

  console.log('Opening http://localhost:3000...');
  await page.goto('http://localhost:3000');

  console.log('\nWaiting 3 seconds for page to load...');
  await page.waitForTimeout(3000);

  console.log('\nLooking for brainbase project + button...');

  // brainbaseプロジェクトの+ボタンを探してクリック
  try {
    // セッショングループのヘッダーを探す
    const brainbaseGroup = await page.locator('.session-group-header:has-text("brainbase")').first();

    if (await brainbaseGroup.count() > 0) {
      console.log('Found brainbase group, hovering to show + button...');
      await brainbaseGroup.hover();

      await page.waitForTimeout(500);

      // +ボタンをクリック
      const plusButton = brainbaseGroup.locator('.add-project-session-btn');
      if (await plusButton.count() > 0) {
        console.log('Clicking + button...');
        await plusButton.click();

        console.log('\nWaiting for modal to appear...');
        await page.waitForTimeout(1000);

        // モーダルが表示されているか確認
        const modal = page.locator('#create-session-modal.active');
        if (await modal.count() > 0) {
          console.log('Modal is now visible');

          // セッション名の値を確認
          const sessionNameInput = page.locator('#session-name-input');
          const sessionName = await sessionNameInput.inputValue();
          console.log('[MODAL CHECK] Session name input value:', sessionName);

          // ここで「作成」ボタンをクリックしてログを確認
          console.log('\nClicking Create button...');
          const createBtn = page.locator('#create-session-btn');
          await createBtn.click();

          console.log('\nWaiting for session creation logs...');
          await page.waitForTimeout(2000);
        } else {
          console.log('Modal did not appear');
        }
      } else {
        console.log('+ button not found');
      }
    } else {
      console.log('brainbase group not found');
    }
  } catch (error) {
    console.error('Error during interaction:', error.message);
  }

  console.log('\n=== Console Logs Summary ===');
  const debugLogs = consoleLogs.filter(log => log.text.includes('[DEBUG]'));

  if (debugLogs.length > 0) {
    console.log('\nDEBUG logs found:');
    debugLogs.forEach(log => {
      console.log(`  ${log.text}`);
    });
  } else {
    console.log('No [DEBUG] logs found');
  }

  console.log('\nAll console logs:');
  consoleLogs.forEach(log => {
    console.log(`  [${log.type}] ${log.text}`);
  });

  console.log('\nPress Ctrl+C to close browser');
  await page.waitForTimeout(30000); // Keep browser open for 30 seconds

  await browser.close();
}

debugBrainbaseUI().catch(console.error);

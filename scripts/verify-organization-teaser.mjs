#!/usr/bin/env node
const baseUrl = (process.env.BRAINBASE_PUBLIC_URL ?? 'https://brainbase.pages.dev').replace(/\/$/, '');
const attempts = Number(process.env.PUBLIC_READBACK_ATTEMPTS ?? 12);
const delayMs = Number(process.env.PUBLIC_READBACK_DELAY_MS ?? 5000);
const required = [
  '同じ判断を、何度も経営者に戻さない。',
  '先行案内を受け取る',
  'https://formspree.io/f/xdkgavwn',
  'name="_replyto"',
  'https://www.unson.jp/privacy-policy'
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastFailure = 'not attempted';
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(`${baseUrl}/organization`, {
      headers: { 'cache-control': 'no-cache' }
    });

    if (!response.ok) {
      lastFailure = `HTTP ${response.status}`;
    } else {
      const html = await response.text();
      const missing = required.filter((value) => !html.includes(value));
      if (missing.length === 0) {
        process.stdout.write(`${JSON.stringify({
          status: 'public_organization_teaser_valid',
          base_url: baseUrl,
          attempt
        }, null, 2)}\n`);
        process.exit(0);
      }
      lastFailure = `missing ${missing.join(', ')}`;
    }
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : String(error);
  }

  if (attempt < attempts) {
    await sleep(delayMs);
  }
}

throw new Error(`organization teaser readback failed: ${lastFailure}`);

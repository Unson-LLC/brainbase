import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(path.resolve(process.cwd(), 'public/workflows.html'), 'utf8');

describe('Workflow Mission Control Agent Run Inbox integration', () => {
    it('専用client service viewとReactive Storeを接続する', () => {
        expect(html).toContain("import { appStore }");
        expect(html).toContain("run-receipt-inbox-client.js");
        expect(html).toContain("run-receipt-inbox-service.js");
        expect(html).toContain("run-receipt-inbox-view.js");
        expect(html).toContain('new RunReceiptInboxService');
        expect(html).toContain('subscribeToSelector');
    });

    it('既存workflow loadと独立してreceipt loadを起動する', () => {
        expect(html).toContain('async function loadRunReceiptInbox');
        expect(html).toMatch(/load\(\);\s*loadRunReceiptInbox\(\);/);
    });
});

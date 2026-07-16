import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const html = fs.readFileSync(path.resolve(process.cwd(), 'public/workflows.html'), 'utf8');
const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || '';

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

    it('Agent Run Inboxをプロジェクト一覧より前の主要導線に置く', () => {
        const renderWorkspace = moduleScript.match(
            /function renderWorkspace\(\)\s*\{([\s\S]*?)\n        \}\n        function renderProjectCard/
        )?.[1] || '';
        const inboxPosition = renderWorkspace.indexOf(
            'renderRunReceiptInbox(appStore.getState().runReceiptInbox, { projects: projectIds })'
        );
        const projectGridPosition = renderWorkspace.indexOf('<div class="project-grid">');

        expect(inboxPosition).toBeGreaterThan(-1);
        expect(projectGridPosition).toBeGreaterThan(-1);
        expect(inboxPosition).toBeLessThan(projectGridPosition);
    });

    it('HTML境界は専用serviceを呼びStoreを購読描画するだけで直接fetchや並行stateを持たない', () => {
        expect(moduleScript).not.toContain('/api/run-receipts');
        expect(moduleScript).not.toMatch(/runReceiptInbox\s*=/);
        expect(moduleScript).not.toMatch(/appStore\.(?:setState|update|dispatch)/);
        expect(moduleScript).toMatch(
            /async function loadRunReceiptInbox\(filters\)\s*\{\s*try\s*\{\s*await runReceiptInboxService\.load\(filters\);/
        );
        expect(moduleScript.match(/runReceiptInboxService\.load\(/g)).toHaveLength(1);
        expect(moduleScript).toMatch(
            /subscribeToSelector\(\s*\(current\) => current\.runReceiptInbox,[\s\S]*?renderRunReceiptInbox\(value, \{ projects: allProjectIds\(\) \}\)/
        );
        expect(moduleScript).toContain(
            'renderRunReceiptInbox(appStore.getState().runReceiptInbox, { projects: projectIds })'
        );
    });
});

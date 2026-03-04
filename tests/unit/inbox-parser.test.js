import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InboxParser } from '../../lib/inbox-parser.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('InboxParser', () => {
    let testFilePath;
    let parser;

    beforeEach(() => {
        testFilePath = path.join(__dirname, `test-inbox-${Date.now()}.md`);
        parser = new InboxParser(testFilePath);
    });

    afterEach(async () => {
        try {
            await fs.unlink(testFilePath);
        } catch (error) {
            // ignore missing files
        }
    });

    it('markAsDone呼び出し時_フロントマッターID一致のアイテムが削除される', async () => {
        const content = `---
id: INBOX-2026-01-1768139506
channel: hp
sender: A
timestamp: 1768139506.671219
status: pending
---
### A

message a

[Slack](https://example.com/archives/C1/p1768139506671219)

---
id: INBOX-2026-01-1768125807
channel: dev
sender: B
timestamp: 1768125807.129169
status: pending
---
### B

message b

[Slack](https://example.com/archives/C1/p1768125807129169)
`;
        await fs.writeFile(testFilePath, content, 'utf-8');

        const success = await parser.markAsDone('INBOX-2026-01-1768139506');
        const items = await parser.getPendingItems();

        expect(success).toBe(true);
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe('INBOX-2026-01-1768125807');
    });

    it('markAsDone呼び出し時_旧形式IDでもSlack URLから削除できる', async () => {
        const content = `---
channel: general
sender: C
timestamp: 1766718363.259249
status: pending
---
### C

message c

[Slack](https://example.com/archives/C1/p1766718363259249)

---
channel: general
sender: D
timestamp: 1766718363.259250
status: pending
---
### D

message d

[Slack](https://example.com/archives/C1/p1766718363259250)
`;
        await fs.writeFile(testFilePath, content, 'utf-8');

        const success = await parser.markAsDone('INBOX-1766718363259249');
        const items = await parser.getPendingItems();

        expect(success).toBe(true);
        expect(items).toHaveLength(1);
        expect(items[0].id).toBe('INBOX-1766718363259250');
    });
});

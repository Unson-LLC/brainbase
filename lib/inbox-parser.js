import fs from 'fs/promises';
import path from 'path';

export class InboxParser {
    constructor(inboxFilePath) {
        this.inboxFilePath = inboxFilePath;
        this.mutex = Promise.resolve();
    }

    async runAtomic(operation) {
        const result = this.mutex.then(() => operation().catch(err => {
            console.error('Atomic operation failed:', err);
            throw err;
        }));
        this.mutex = result.catch(() => { });
        return result;
    }

    async getAllItems() {
        return this.runAtomic(async () => {
            try {
                const markdown = await fs.readFile(this.inboxFilePath, 'utf-8');
                return this.parseMarkdown(markdown);
            } catch (error) {
                if (error.code === 'ENOENT') {
                    return [];
                }
                console.error('Error reading inbox:', error);
                return [];
            }
        });
    }

    async getPendingItems() {
        const items = await this.getAllItems();
        return items.filter(item => item.status === 'pending');
    }

    parseMarkdown(markdown) {
        // Split by '---' to get blocks
        // Format: [header, frontmatter1, content1, frontmatter2, content2, ...]
        const blocks = markdown.split(/^---$/gm);
        const items = [];

        for (let i = 1; i < blocks.length; i += 2) {
            const frontmatterBlock = blocks[i];
            const contentBlock = blocks[i + 1] || '';

            if (!frontmatterBlock.trim()) continue;

            try {
                const item = {};
                let isInboxItem = false;

                // Parse frontmatter
                const lines = frontmatterBlock.trim().split('\n');
                for (const line of lines) {
                    const kvMatch = line.match(/^(\w+):\s*(.*)$/);
                    if (kvMatch) {
                        const [_, key, value] = kvMatch;
                        if (key === 'id') {
                            item.id = value;
                            isInboxItem = value.startsWith('INBOX-');
                        } else if (key === 'channel') {
                            item.channel = value;
                        } else if (key === 'sender') {
                            item.sender = value;
                        } else if (key === 'timestamp') {
                            item.timestamp = value;
                        } else if (key === 'status') {
                            item.status = value;
                        }
                    }
                }

                // Parse content section from the next block
                if (contentBlock.trim()) {
                    const content = contentBlock.trim();

                    // Extract title from ### header
                    const titleMatch = content.match(/^###\s*(.+)$/m);
                    if (titleMatch) {
                        item.title = titleMatch[1].trim();
                    }

                    // Extract message (text between ### header and **スレッドの文脈** or [Slack])
                    // Two-step approach: first get everything after header, then split at boundary
                    const afterHeaderMatch = content.match(/^###[^\n]+\n\n([\s\S]*)$/m);
                    if (afterHeaderMatch) {
                        const afterHeader = afterHeaderMatch[1];
                        // Split on \n\n** (blank line + **) or \n[Slack] or \n\n[Slack]
                        const messagePart = afterHeader.split(/\n\n\*\*|\n\[Slack\]|\n\n\[Slack\]/)[0];
                        if (messagePart) {
                            item.message = messagePart.trim();
                        }
                    }

                    // Extract Slack link
                    const slackMatch = content.match(/\[Slack\]\((https:\/\/[^)]+)\)/);
                    if (slackMatch) {
                        item.slackUrl = slackMatch[1];
                    }
                }

                if (isInboxItem && item.id) {
                    items.push(item);
                }
            } catch (e) {
                console.warn('Failed to parse inbox block:', e);
            }
        }

        return items;
    }

    async markAsDone(itemId) {
        return this.runAtomic(async () => {
            try {
                const content = await fs.readFile(this.inboxFilePath, 'utf-8');

                // Replace status: pending with status: done for the specific item
                const regex = new RegExp(
                    `(---\\s*\\nid:\\s*${itemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n[\\s\\S]*?status:\\s*)pending`,
                    'g'
                );

                if (!regex.test(content)) {
                    console.warn(`Item ${itemId} not found or already done.`);
                    return false;
                }

                const newContent = content.replace(regex, '$1done');
                await fs.writeFile(this.inboxFilePath, newContent, 'utf-8');
                return true;
            } catch (error) {
                console.error('Error marking item as done:', error);
                return false;
            }
        });
    }

    async markAllAsDone() {
        return this.runAtomic(async () => {
            try {
                const content = await fs.readFile(this.inboxFilePath, 'utf-8');

                // Replace all status: pending with status: done
                const newContent = content.replace(/status:\s*pending/g, 'status: done');

                await fs.writeFile(this.inboxFilePath, newContent, 'utf-8');
                return true;
            } catch (error) {
                console.error('Error marking all items as done:', error);
                return false;
            }
        });
    }

    async getPendingCount() {
        const items = await this.getPendingItems();
        return items.length;
    }
}

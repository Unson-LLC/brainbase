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
        const blocks = markdown.split(/^---$/gm);
        const items = [];

        // YAML front matter形式: ---\nfront matter\n---\nbody
        // blocks配列: [header, frontmatter, body, frontmatter2, body2, ...]
        for (let i = 1; i < blocks.length; i += 2) {
            const frontmatterBlock = blocks[i];
            const bodyBlock = blocks[i + 1] || '';

            if (!frontmatterBlock.trim()) continue;

            try {
                // フロントマッターと本文を結合してパース
                const combinedBlock = frontmatterBlock + '\n' + bodyBlock;
                const item = this._parseBlock(combinedBlock);
                if (item) items.push(item);
            } catch (e) {
                console.warn('Failed to parse inbox block:', e);
            }
        }

        return items;
    }

    _parseBlock(block) {
        const item = {};
        let hasFrontmatter = false;

        // 1. フロントマッター形式を試行（既存形式との互換性）
        const lines = block.trim().split('\n');
        for (const line of lines) {
            const kvMatch = line.match(/^(\w+):\s*(.*)$/);
            if (kvMatch) {
                const [_, key, value] = kvMatch;
                hasFrontmatter = true;
                if (key === 'id') {
                    item.id = value;
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

        // 2. ヘッダーから情報抽出（### 12:06 | #channel | sender）
        const headerMatch = block.match(/^###\s*(\d{1,2}:\d{2})\s*\|\s*#([^\|]+)\s*\|\s*(.+)$/m);
        if (headerMatch) {
            const [fullMatch, time, channel, sender] = headerMatch;
            // フロントマッターがない場合、ヘッダーから情報を取得
            if (!item.channel) item.channel = channel.trim();
            if (!item.sender) item.sender = sender.trim();
            item.title = fullMatch.replace('###', '').trim();
        }

        // 3. メッセージ本文抽出
        const afterHeaderMatch = block.match(/^###[^\n]+\n\n([\s\S]*)$/m);
        if (afterHeaderMatch) {
            const afterHeader = afterHeaderMatch[1];
            // Split on \n\n** (blank line + **) or \n[Slack] or \n\n[Slack]
            const messagePart = afterHeader.split(/\n\n\*\*|\n\[Slack\]|\n\n\[Slack\]/)[0];
            if (messagePart) {
                item.message = messagePart.trim();
            }
        }

        // 4. Slackリンク抽出
        const slackMatch = block.match(/\[Slack\]\((https:\/\/[^)]+)\)/);
        if (slackMatch) {
            item.slackUrl = slackMatch[1];
        }

        // 5. ID生成（存在しない場合、SlackURLから生成）+ 日時抽出
        if (!item.id && item.slackUrl) {
            // SlackURLの末尾部分からユニークIDを生成
            const urlParts = item.slackUrl.split('/');
            const lastPart = urlParts[urlParts.length - 1];
            // p1766718363259249 or p1766716792889919?thread_ts=... 形式
            const idMatch = lastPart.match(/p(\d+)/);
            if (idMatch) {
                item.id = `INBOX-${idMatch[1]}`;
                // タイムスタンプから日時を抽出（Slackは秒+マイクロ秒の16桁）
                const timestamp = parseInt(idMatch[1].substring(0, 10), 10);
                const date = new Date(timestamp * 1000);
                item.date = date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
                item.time = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
            }
        }

        // 6. デフォルトstatus
        if (!item.status) {
            item.status = 'pending';
        }

        // 有効なアイテムのみ返す（IDとメッセージが必須）
        return (item.id && item.message) ? item : null;
    }

    async markAsDone(itemId) {
        return this.runAtomic(async () => {
            try {
                const content = await fs.readFile(this.inboxFilePath, 'utf-8');
                const blocks = content.split(/^---$/gm);
                let found = false;
                const filteredBlocks = [blocks[0] ?? ''];

                for (let i = 1; i < blocks.length; i += 2) {
                    const frontmatterBlock = blocks[i] ?? '';
                    const bodyBlock = blocks[i + 1] ?? '';
                    const matches = this._matchesItemId(itemId, frontmatterBlock, bodyBlock);
                    if (matches) {
                        found = true;
                        continue;
                    }
                    filteredBlocks.push(frontmatterBlock, bodyBlock);
                }

                if (!found) {
                    console.warn(`Item ${itemId} not found.`);
                    return false;
                }

                const newContent = filteredBlocks.join('---');
                await fs.writeFile(this.inboxFilePath, newContent, 'utf-8');
                return true;
            } catch (error) {
                console.error('Error marking item as done:', error);
                return false;
            }
        });
    }

    _matchesItemId(itemId, frontmatterBlock, bodyBlock) {
        const frontmatterId = this._extractFrontmatterValue(frontmatterBlock, 'id');
        if (frontmatterId && frontmatterId === itemId) {
            return true;
        }

        const itemTimestamp = this._extractTimestampFromItemId(itemId);
        if (!itemTimestamp) {
            return false;
        }

        const frontmatterTimestamp = this._extractFrontmatterValue(frontmatterBlock, 'timestamp');
        if (frontmatterTimestamp) {
            const frontmatterSeconds = frontmatterTimestamp.split('.')[0];
            if (frontmatterSeconds === itemTimestamp) {
                return true;
            }
        }

        const slackTimestamp = this._extractSlackTimestamp(bodyBlock);
        if (slackTimestamp && slackTimestamp.startsWith(itemTimestamp)) {
            return true;
        }

        return false;
    }

    _extractFrontmatterValue(frontmatterBlock, key) {
        const match = frontmatterBlock.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
        return match ? match[1].trim() : null;
    }

    _extractSlackTimestamp(bodyBlock) {
        const slackMatch = bodyBlock.match(/\[Slack\]\(https:\/\/[^)]*\/p(\d+)/);
        return slackMatch ? slackMatch[1] : null;
    }

    _extractTimestampFromItemId(itemId) {
        const legacyMatch = itemId.match(/INBOX-(\d{10,})$/);
        if (legacyMatch) {
            return legacyMatch[1];
        }
        const datedMatch = itemId.match(/INBOX-\d{4}-\d{2}-(\d{10})$/);
        if (datedMatch) {
            return datedMatch[1];
        }
        return null;
    }

    async markAllAsDone() {
        return this.runAtomic(async () => {
            try {
                // 全アイテムを削除 = ヘッダーのみ残す
                const header = '# Pending Inbox Items\n\n<!-- AI PMが自動更新。Claude Code起動時に確認・対応を提案 -->\n';
                await fs.writeFile(this.inboxFilePath, header, 'utf-8');
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

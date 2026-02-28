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

        for (let i = 1; i < blocks.length; i++) {
            let block = blocks[i];
            if (!block.trim()) continue;

            // フロントマッターと本文が分離されている場合は結合
            const hasFrontmatter = /^(id|channel|sender|timestamp|status):/m.test(block);
            if (hasFrontmatter && blocks[i + 1]) {
                block = `${block}\n${blocks[i + 1]}`;
                i++;
            }

            try {
                const item = this._parseBlock(block);
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

                // INBOX-2026-01-1768139506 / INBOX-1766718363259249 形式からタイムスタンプ部分を抽出
                const timestampMatch = itemId.match(/INBOX-(?:\d{4}-\d{2}-)?(\d+)/);
                const timestamp = timestampMatch ? timestampMatch[1] : null;

                // ブロックを分割して、該当するものを除外
                const blocks = content.split(/^---$/gm);
                let found = false;

                const filteredBlocks = [];
                for (let i = 0; i < blocks.length; i++) {
                    const block = blocks[i];

                    // フロントマッターを含むブロックなら次の本文ブロックとセットで扱う
                    const idMatch = block.match(/^id:\s*(.+)$/m);
                    if (idMatch) {
                        const frontmatterId = idMatch[1].trim();
                        const nextBlock = blocks[i + 1] || '';
                        const slackMatch = nextBlock.match(/\[Slack\]\(https:\/\/[^)]*\/p(\d+)/);

                        const matchedById = frontmatterId === itemId;
                        const matchedBySlack = timestamp && slackMatch && slackMatch[1] === timestamp;

                        if (matchedById || matchedBySlack) {
                            found = true;
                            i++; // 本文ブロックもスキップ
                            continue;
                        }

                        filteredBlocks.push(block);
                        if (nextBlock) {
                            filteredBlocks.push(nextBlock);
                            i++;
                        }
                        continue;
                    }

                    // 旧形式: 本文ブロック内のSlack URLから判定
                    if (timestamp) {
                        const slackMatch = block.match(/\[Slack\]\(https:\/\/[^)]*\/p(\d+)/);
                        if (slackMatch && slackMatch[1] === timestamp) {
                            found = true;
                            continue;
                        }
                    }

                    filteredBlocks.push(block);
                }

                if (!found) {
                    console.warn(`Item ${itemId} not found.`);
                    return false;
                }

                // ブロックを再結合（空ブロックを適切に処理）
                const newContent = filteredBlocks.join('---');
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

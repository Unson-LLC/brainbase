/**
 * InboxController
 * インボックス管理のHTTPリクエスト処理
 */
export class InboxController {
    constructor(inboxParser) {
        this.inboxParser = inboxParser;
    }

    /**
     * GET /api/inbox/pending
     * すべての保留中インボックスアイテムを取得
     */
    getPending = async (req, res) => {
        try {
            const items = await this.inboxParser.getPendingItems();
            res.json(items);
        } catch (error) {
            console.error('Failed to get pending items:', error);
            res.status(500).json({ error: 'Failed to get pending items' });
        }
    };

    /**
     * GET /api/inbox/count
     * 保留中アイテム数を取得
     */
    getCount = async (req, res) => {
        try {
            const count = await this.inboxParser.getPendingCount();
            res.json({ count });
        } catch (error) {
            console.error('Failed to get pending count:', error);
            res.status(500).json({ error: 'Failed to get pending count' });
        }
    };

    /**
     * POST /api/inbox/:id/done
     * 単一アイテムを完了としてマーク
     */
    markAsDone = async (req, res) => {
        try {
            const { id } = req.params;
            const success = await this.inboxParser.markAsDone(id);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Item not found or mark failed' });
            }
        } catch (error) {
            console.error('Failed to mark item as done:', error);
            res.status(500).json({ error: 'Failed to mark item as done' });
        }
    };

    /**
     * POST /api/inbox/mark-all-done
     * すべてのアイテムを完了としてマーク
     */
    markAllAsDone = async (req, res) => {
        try {
            const success = await this.inboxParser.markAllAsDone();
            res.json({ success });
        } catch (error) {
            console.error('Failed to mark all items as done:', error);
            res.status(500).json({ error: 'Failed to mark all items as done' });
        }
    };
}

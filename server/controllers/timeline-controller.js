/**
 * TimelineController
 * タイムライン関連のHTTPリクエスト処理
 */
export class TimelineController {
    constructor(timelineStorage) {
        this.storage = timelineStorage;
    }

    /**
     * GET /api/timeline/today
     * 今日のタイムラインを取得
     */
    getToday = async (req, res) => {
        try {
            const timeline = await this.storage.getTodayTimeline();
            res.json(timeline);
        } catch (error) {
            console.error('Failed to get today\'s timeline:', error);
            res.status(500).json({ error: error.message || 'Failed to get timeline' });
        }
    };

    /**
     * GET /api/timeline
     * 指定日のタイムラインを取得
     */
    getByDate = async (req, res) => {
        try {
            const { date } = req.query;
            if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
            }
            const timeline = await this.storage.loadTimeline(date);
            res.json(timeline);
        } catch (error) {
            console.error('Failed to get timeline:', error);
            res.status(500).json({ error: error.message || 'Failed to get timeline' });
        }
    };

    /**
     * GET /api/timeline/:id
     * 指定IDの項目を取得
     */
    getItem = async (req, res) => {
        try {
            const { id } = req.params;
            const item = await this.storage.getItem(id);
            if (!item) {
                return res.status(404).json({ error: 'Timeline item not found' });
            }
            res.json(item);
        } catch (error) {
            console.error('Failed to get timeline item:', error);
            res.status(500).json({ error: error.message || 'Failed to get timeline item' });
        }
    };

    /**
     * POST /api/timeline
     * タイムライン項目を作成
     */
    create = async (req, res) => {
        try {
            const item = req.body;

            // バリデーション
            if (!item.type || !item.title) {
                return res.status(400).json({ error: 'type and title are required' });
            }

            const result = await this.storage.addItem(item);
            if (!result.success) {
                if (result.reason === 'duplicate') {
                    return res.status(409).json({ error: 'Duplicate item', reason: result.reason });
                }
                return res.status(400).json({ error: 'Failed to create item', reason: result.reason });
            }

            res.status(201).json(result.item);
        } catch (error) {
            console.error('Failed to create timeline item:', error);
            res.status(500).json({ error: error.message || 'Failed to create timeline item' });
        }
    };

    /**
     * PUT /api/timeline/:id
     * タイムライン項目を更新
     */
    update = async (req, res) => {
        try {
            const { id } = req.params;
            const updates = req.body;

            const result = await this.storage.updateItem(id, updates);
            if (!result.success) {
                if (result.reason === 'not_found') {
                    return res.status(404).json({ error: 'Timeline item not found' });
                }
                if (result.reason === 'invalid_id') {
                    return res.status(400).json({ error: 'Invalid item ID' });
                }
                return res.status(400).json({ error: 'Failed to update item', reason: result.reason });
            }

            res.json(result.item);
        } catch (error) {
            console.error('Failed to update timeline item:', error);
            res.status(500).json({ error: error.message || 'Failed to update timeline item' });
        }
    };

    /**
     * DELETE /api/timeline/:id
     * タイムライン項目を削除
     */
    delete = async (req, res) => {
        try {
            const { id } = req.params;

            const result = await this.storage.deleteItem(id);
            if (!result.success) {
                if (result.reason === 'not_found') {
                    return res.status(404).json({ error: 'Timeline item not found' });
                }
                if (result.reason === 'invalid_id') {
                    return res.status(400).json({ error: 'Invalid item ID' });
                }
                return res.status(400).json({ error: 'Failed to delete item', reason: result.reason });
            }

            res.status(204).send();
        } catch (error) {
            console.error('Failed to delete timeline item:', error);
            res.status(500).json({ error: error.message || 'Failed to delete timeline item' });
        }
    };
}

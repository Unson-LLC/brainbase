/**
 * ScheduleController
 * スケジュール関連のHTTPリクエスト処理
 */
export class ScheduleController {
    constructor(scheduleParser) {
        this.scheduleParser = scheduleParser;
    }

    /**
     * GET /api/schedule/today
     * 今日のスケジュールを取得
     */
    getToday = async (req, res) => {
        try {
            const schedule = await this.scheduleParser.getTodaySchedule();
            res.json(schedule);
        } catch (error) {
            console.error('Failed to get today\'s schedule:', error);
            res.status(500).json({ error: error.message || 'Failed to get schedule' });
        }
    };

    /**
     * GET /api/schedule/:date
     * 指定日のスケジュールを取得
     */
    getByDate = async (req, res) => {
        try {
            const { date } = req.params;
            // Validate date format
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
            }
            const schedule = await this.scheduleParser.getSchedule(date);
            res.json(schedule);
        } catch (error) {
            console.error('Failed to get schedule:', error);
            res.status(500).json({ error: error.message || 'Failed to get schedule' });
        }
    };

    /**
     * POST /api/schedule/:date/events
     * イベントを追加（Kiro形式のみ）
     */
    addEvent = async (req, res) => {
        try {
            const { date } = req.params;
            const eventData = req.body;

            if (!eventData.title || !eventData.start) {
                return res.status(400).json({ error: 'title and start are required' });
            }

            const result = await this.scheduleParser.addEvent(date, eventData);

            if (result.duplicate) {
                return res.status(409).json({ error: 'Event already exists', duplicate: true });
            }

            res.status(201).json(result.event);
        } catch (error) {
            if (error.message.includes('only supported in Kiro format')) {
                return res.status(400).json({ error: 'This operation requires Kiro schedule format' });
            }
            console.error('Failed to add event:', error);
            res.status(500).json({ error: error.message || 'Failed to add event' });
        }
    };

    /**
     * PUT /api/schedule/:date/events/:id
     * イベントを更新（Kiro形式のみ）
     */
    updateEvent = async (req, res) => {
        try {
            const { date, id } = req.params;
            const updates = req.body;

            const result = await this.scheduleParser.updateEvent(date, id, updates);

            if (!result.success) {
                return res.status(404).json({ error: result.error });
            }

            res.json(result.event);
        } catch (error) {
            if (error.message.includes('only supported in Kiro format')) {
                return res.status(400).json({ error: 'This operation requires Kiro schedule format' });
            }
            console.error('Failed to update event:', error);
            res.status(500).json({ error: error.message || 'Failed to update event' });
        }
    };

    /**
     * DELETE /api/schedule/:date/events/:id
     * イベントを削除（Kiro形式のみ）
     */
    deleteEvent = async (req, res) => {
        try {
            const { date, id } = req.params;

            const result = await this.scheduleParser.deleteEvent(date, id);

            if (!result.success) {
                return res.status(404).json({ error: result.error });
            }

            res.json({ success: true, event: result.event });
        } catch (error) {
            if (error.message.includes('only supported in Kiro format')) {
                return res.status(400).json({ error: 'This operation requires Kiro schedule format' });
            }
            console.error('Failed to delete event:', error);
            res.status(500).json({ error: error.message || 'Failed to delete event' });
        }
    };
}

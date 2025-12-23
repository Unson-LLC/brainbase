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
}

import fs from 'fs/promises';
import path from 'path';

export class ScheduleParser {
    constructor(schedulesDir) {
        this.schedulesDir = schedulesDir;
    }

    async getTodaySchedule() {
        // Use JST (Asia/Tokyo) for date calculation
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD
        const filePath = path.join(this.schedulesDir, `${today}.md`);

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return this.parseSchedule(content);
        } catch (error) {
            // If file doesn't exist, return empty schedule
            if (error.code === 'ENOENT') {
                return { items: [], raw: null, message: 'No schedule for today' };
            }
            console.error('Error reading schedule file:', error);
            return { items: [], raw: null, error: 'Failed to read schedule' };
        }
    }

    parseSchedule(content) {
        const lines = content.split('\n');
        const items = [];
        let inOhayoSection = false;
        let currentSection = null;

        // Simple parsing logic - looks for time blocks like "09:00 - 10:00 Task"
        // Also prioritizes /ohayo section if present
        for (const line of lines) {
            if (line.includes('/ohayo')) {
                inOhayoSection = true;
                continue;
            }

            // Track section headers
            if (line.startsWith('### ')) {
                currentSection = line.replace('### ', '').trim();
                continue;
            }

            // Table format check: | HH:MM-HH:MM | Task | ... |
            const tableMatch = line.match(/^\|\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*\|\s*([^|]+)\s*\|/);
            if (tableMatch) {
                const [_, start, end, task] = tableMatch;
                items.push({
                    start,
                    end,
                    task: task.trim(),
                    isOhayo: inOhayoSection
                });
                continue;
            }

            // Standard list format check: HH:MM - HH:MM Task
            const timeMatch = line.match(/^(\d{2}:\d{2})\s*(?:-\s*(\d{2}:\d{2}))?\s+(.+)$/);
            if (timeMatch) {
                const [_, start, end, task] = timeMatch;
                items.push({
                    start,
                    end: end || null,
                    task: task.trim(),
                    isOhayo: inOhayoSection
                });
                continue;
            }

            // 作業可能時間 format: - 午前: 10:30 〜 12:00
            const workTimeMatch = line.match(/^-\s*(午前|午後|夜)[:：]\s*(\d{1,2}:\d{2})\s*[〜～-]\s*(\d{1,2}:\d{2})/);
            if (workTimeMatch && currentSection === '作業可能時間') {
                const [_, period, start, end] = workTimeMatch;
                items.push({
                    start: start.padStart(5, '0'),
                    end: end.padStart(5, '0'),
                    task: `${period} 作業可能`,
                    isWorkTime: true,
                    isOhayo: inOhayoSection
                });
                continue;
            }

            // Priority tasks: - [ ] タスク名
            const taskMatch = line.match(/^-\s*\[[ x]\]\s*(.+)$/);
            if (taskMatch && currentSection?.includes('タスク')) {
                const [_, taskName] = taskMatch;
                items.push({
                    start: null,
                    end: null,
                    task: taskName.trim(),
                    isTask: true,
                    isOhayo: inOhayoSection
                });
            }
        }

        return {
            items,
            raw: content
        };
    }
}

import fs from 'fs/promises';
import path from 'path';
import { KiroScheduleParser } from './kiro-schedule-parser.js';

export class ScheduleParser {
    constructor(schedulesDir, options = {}) {
        this.schedulesDir = schedulesDir;
        this.useKiroFormat = options.useKiroFormat || false;

        if (this.useKiroFormat) {
            this.kiroParser = new KiroScheduleParser();
        }
    }

    /**
     * Get today's date in YYYY-MM-DD format (JST)
     * @returns {string}
     */
    _getToday() {
        return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    }

    /**
     * Get schedule file path for a date
     * @param {string} date - Date in YYYY-MM-DD format
     * @returns {string}
     */
    _getSchedulePath(date) {
        if (this.useKiroFormat) {
            return path.join(this.schedulesDir, date, 'schedule.md');
        }
        return path.join(this.schedulesDir, `${date}.md`);
    }

    async getTodaySchedule() {
        const today = this._getToday();
        return this.getSchedule(today);
    }

    /**
     * Get schedule for a specific date
     * @param {string} date - Date in YYYY-MM-DD format
     * @returns {Object}
     */
    async getSchedule(date) {
        const filePath = this._getSchedulePath(date);

        try {
            const content = await fs.readFile(filePath, 'utf-8');

            if (this.useKiroFormat) {
                const events = this.kiroParser.parseFile(content);
                return {
                    date,
                    events,
                    items: this._eventsToItems(events), // backward compat
                    raw: content
                };
            }

            return this.parseSchedule(content);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    date,
                    events: [],
                    items: [],
                    raw: null,
                    message: 'No schedule for this date'
                };
            }
            console.error('Error reading schedule file:', error);
            return { date, events: [], items: [], raw: null, error: 'Failed to read schedule' };
        }
    }

    /**
     * Convert Kiro events to legacy items format
     * @param {Array} events
     * @returns {Array}
     */
    _eventsToItems(events) {
        return events.map(e => ({
            start: e.start,
            end: e.end,
            task: e.title,
            isOhayo: e.source === 'google-calendar',
            completed: e.completed
        }));
    }

    /**
     * Add an event to schedule (Kiro format only)
     * @param {string} date - Date in YYYY-MM-DD format
     * @param {Object} eventData - Event data
     * @returns {Object} - Created event
     */
    async addEvent(date, eventData) {
        if (!this.useKiroFormat) {
            throw new Error('addEvent is only supported in Kiro format');
        }

        const filePath = this._getSchedulePath(date);
        const dir = path.dirname(filePath);

        // Ensure directory exists
        await fs.mkdir(dir, { recursive: true });

        // Read existing content
        let content = '';
        try {
            content = await fs.readFile(filePath, 'utf-8');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        // Check for duplicates
        const existingEvents = this.kiroParser.parseFile(content);
        if (this.kiroParser.isDuplicate(existingEvents, eventData)) {
            return { duplicate: true, event: null };
        }

        // Create new event
        const event = {
            id: eventData.id || this.kiroParser.generateId(),
            start: eventData.start,
            end: eventData.end || null,
            title: eventData.title,
            source: eventData.source || 'manual',
            calendarId: eventData.calendarId || null,
            completed: eventData.completed || false
        };

        // Append and save
        const newContent = this.kiroParser.appendEvent(content, event);
        await fs.writeFile(filePath, newContent, 'utf-8');

        return { duplicate: false, event };
    }

    /**
     * Update an event (Kiro format only)
     * @param {string} date
     * @param {string} eventId
     * @param {Object} updates
     * @returns {Object}
     */
    async updateEvent(date, eventId, updates) {
        if (!this.useKiroFormat) {
            throw new Error('updateEvent is only supported in Kiro format');
        }

        const filePath = this._getSchedulePath(date);
        const content = await fs.readFile(filePath, 'utf-8');

        const found = this.kiroParser.findEventById(content, eventId);
        if (!found) {
            return { success: false, error: 'Event not found' };
        }

        // Remove old and add updated
        const { content: withoutEvent } = this.kiroParser.removeEvent(content, eventId);
        const updatedEvent = { ...found.event, ...updates };
        const newContent = this.kiroParser.appendEvent(withoutEvent, updatedEvent);

        await fs.writeFile(filePath, newContent, 'utf-8');

        return { success: true, event: updatedEvent };
    }

    /**
     * Delete an event (Kiro format only)
     * @param {string} date
     * @param {string} eventId
     * @returns {Object}
     */
    async deleteEvent(date, eventId) {
        if (!this.useKiroFormat) {
            throw new Error('deleteEvent is only supported in Kiro format');
        }

        const filePath = this._getSchedulePath(date);
        const content = await fs.readFile(filePath, 'utf-8');

        const { content: newContent, removedEvent } = this.kiroParser.removeEvent(content, eventId);
        if (!removedEvent) {
            return { success: false, error: 'Event not found' };
        }

        await fs.writeFile(filePath, newContent, 'utf-8');

        return { success: true, event: removedEvent };
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

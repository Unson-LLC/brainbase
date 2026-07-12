// @ts-check
import { isGoogleCalendarDuplicate } from './google-calendar-utils.js';
import { logger } from '../server/utils/logger.js';

/** @typedef {{ googleCalendarService?: { isConfigured?: () => boolean, listEventsForDate: (date: string) => Promise<ScheduleEvent[]> } | null }} ScheduleParserOptions */
/** @typedef {{ email?: string, displayName?: string, responseStatus?: string, self?: boolean, organizer?: boolean, optional?: boolean, resource?: boolean }} ScheduleAttendee */
/** @typedef {{ id?: string, start?: string | null, end?: string | null, title?: string, task?: string, source?: string | null, calendarId?: string | null, completed?: boolean, allDay?: boolean, attendees?: ScheduleAttendee[] }} ScheduleEvent */
/** @typedef {{ start: string | null, end: string | null, task: string, isOhayo?: boolean, completed?: boolean, allDay?: boolean, source?: string | null, calendarId?: string | null, attendees?: ScheduleAttendee[] }} LegacyScheduleItem */
/** @typedef {{ date: string, events: ScheduleEvent[], items: LegacyScheduleItem[], raw: string | null, message?: string, error?: string }} ScheduleResult */

/**
 * Google Calendar backed schedule reader.
 * ローカル `_schedules/*.md` の読み書きは廃止済み（予定の正本は Google Calendar）。
 */
export class ScheduleParser {
    /**
     * @param {ScheduleParserOptions} [options]
     */
    constructor(options = {}) {
        this.googleCalendarService = options.googleCalendarService || null;
    }

    /**
     * Get today's date in YYYY-MM-DD format (JST)
     * @returns {string}
     */
    _getToday() {
        return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    }

    async getTodaySchedule() {
        const today = this._getToday();
        return this.getSchedule(today);
    }

    /**
     * Get schedule for a specific date (Google Calendar only)
     * @param {string} date - Date in YYYY-MM-DD format
     * @returns {Promise<ScheduleResult>}
     */
    async getSchedule(date) {
        const googleEvents = await this._loadGoogleCalendarEvents(date);
        const events = this._sortEvents(this._dedupeEvents(googleEvents));
        return {
            date,
            events,
            items: this._eventsToItems(events), // backward compat
            raw: null,
            ...(events.length === 0 ? { message: 'No schedule for this date' } : {})
        };
    }

    async _loadGoogleCalendarEvents(date) {
        if (!this.googleCalendarService?.isConfigured?.()) {
            return [];
        }

        try {
            return await this.googleCalendarService.listEventsForDate(date);
        } catch (error) {
            logger.warn('[ScheduleParser] Failed to load Google Calendar events:', error instanceof Error ? error.message : String(error));
            return [];
        }
    }

    /**
     * @param {ScheduleEvent[]} [events]
     * @returns {ScheduleEvent[]}
     */
    _dedupeEvents(events = []) {
        /** @type {ScheduleEvent[]} */
        const deduped = [];
        for (const event of events) {
            if (!isGoogleCalendarDuplicate(deduped, event)) {
                deduped.push(event);
            }
        }
        return deduped;
    }

    /**
     * @param {ScheduleEvent[]} events
     * @returns {ScheduleEvent[]}
     */
    _sortEvents(events) {
        return [...events].sort((a, b) => {
            if (a.allDay && !b.allDay) return -1;
            if (!a.allDay && b.allDay) return 1;
            return (a.start || '').localeCompare(b.start || '');
        });
    }

    /**
     * Convert events to legacy items format
     * @param {ScheduleEvent[]} events
     * @returns {LegacyScheduleItem[]}
     */
    _eventsToItems(events) {
        return events.map(e => ({
            start: e.start ?? null,
            end: e.end ?? null,
            task: e.title || e.task,
            isOhayo: e.source === 'google-calendar',
            completed: e.completed,
            allDay: Boolean(e.allDay),
            source: e.source || null,
            calendarId: e.calendarId || null,
            ...(Array.isArray(e.attendees) && e.attendees.length > 0 ? { attendees: e.attendees } : {})
        }));
    }
}
